import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createApp } from "../server/index.ts";

function valueAt(document, path) {
  return path.split(".").reduce((value, key) => {
    if (Array.isArray(value)) return value.map(item => item?.[key]).flat();
    return value?.[key];
  }, document);
}

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some(clause => matches(document, clause));
    const actual = valueAt(document, key);
    if (expected instanceof RegExp) return expected.test(actual);
    if (expected && typeof expected === "object") {
      if ("$ne" in expected) return actual !== expected.$ne;
      if ("$in" in expected) return expected.$in.includes(actual);
      if ("$regex" in expected) return expected.$regex.test(actual);
    }
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
  });
}

class MemoryCollection {
  documents = [];

  async findOne(filter) {
    return this.documents.find(document => matches(document, filter)) ?? null;
  }

  find(filter) {
    let results = this.documents.filter(document => matches(document, filter));
    const cursor = {
      limit(count) {
        results = results.slice(0, count);
        return cursor;
      },
      toArray: async () => results
    };
    return cursor;
  }

  async insertOne(document) {
    this.documents.push(document);
    return { acknowledged: true };
  }

  async replaceOne(filter, replacement) {
    const index = this.documents.findIndex(document => matches(document, filter));
    if (index >= 0) this.documents[index] = replacement;
    return { acknowledged: true, matchedCount: index >= 0 ? 1 : 0 };
  }
}

class MemoryDatabase {
  collections = new Map();

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new MemoryCollection());
    return this.collections.get(name);
  }
}

const owner = { id: "owner-id", name: "Jordan", email: "jordan@example.test", passwordHash: "unused", createdAt: "2026-01-01T00:00:00.000Z" };
const member = { id: "member-id", name: "Casey", email: "casey@example.test", passwordHash: "unused", createdAt: "2026-01-01T00:00:00.000Z" };
const group = {
  id: "group-id",
  ownerId: owner.id,
  name: "Weekend trip",
  createdAt: "2026-01-01T00:00:00.000Z",
  members: [{ id: owner.id, name: owner.name }, { id: member.id, name: member.name }],
  expenses: [],
  settlements: [],
  messages: []
};

let server;
let baseUrl;
let database;

beforeEach(async () => {
  database = new MemoryDatabase();
  database.collection("users").documents.push(owner, member);
  database.collection("sessions").documents.push({ token: "owner-token", userId: owner.id });
  database.collection("groups").documents.push(structuredClone(group));

  server = createApp(database).listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, { method = "GET", body, token = "owner-token" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { response, body: response.status === 204 ? null : await response.json() };
}

test("GET /health reports that the app is running", async () => {
  const { response, body } = await request("/health", { token: null });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: "ok" });
});

test("POST expense adds valid data to the group", async () => {
  const { response, body } = await request(`/api/groups/${group.id}/expenses`, {
    method: "POST",
    body: {
      description: "Dinner",
      amount: 100,
      paidBy: owner.id,
      shares: [{ userId: owner.id, amount: 50 }, { userId: member.id, amount: 50 }]
    }
  });

  assert.equal(response.status, 201);
  assert.equal(body.description, "Dinner");
  assert.equal(body.amount, 100);
  assert.equal(database.collection("groups").documents[0].expenses.length, 1);
});

test("POST expense rejects shares that do not add up to the total", async () => {
  const { response, body } = await request(`/api/groups/${group.id}/expenses`, {
    method: "POST",
    body: {
      description: "Dinner",
      amount: 100,
      paidBy: owner.id,
      shares: [{ userId: owner.id, amount: 40 }, { userId: member.id, amount: 40 }]
    }
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /Shares must exactly equal/);
  assert.equal(database.collection("groups").documents[0].expenses.length, 0);
});

test("POST group rejects a member ID that is not registered", async () => {
  const { response, body } = await request("/api/groups", {
    method: "POST",
    body: { name: "New group", memberIds: ["missing-user"] }
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /existing Splitly accounts/);
  assert.equal(database.collection("groups").documents.length, 1);
});
