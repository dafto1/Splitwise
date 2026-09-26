import cors from "cors";
import express from "express";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import type { Db } from "mongodb";

type User = { id: string; name: string; email: string; passwordHash: string; createdAt: string };
type Member = { id: string; name: string };
type Share = { userId: string; amount: number };
type Expense = { id: string; description: string; amount: number; paidBy: string; createdAt: string; shares: Share[] };
type Settlement = { id: string; fromUserId: string; toUserId: string; amount: number; createdAt: string };
type Message = { id: string; userId: string; content: string; createdAt: string; type?: "system" | "message" };
type Group = { id: string; ownerId: string; name: string; createdAt: string; members: Member[]; expenses: Expense[]; settlements: Settlement[]; messages: Message[] };
type Session = { token: string; userId: string; createdAt: string };
type AuthRequest = express.Request & { user?: User };

function cents(value: number) { return Math.round(value * 100) / 100; }
function publicUser(user: User) { return { id: user.id, name: user.name, email: user.email }; }
function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
function validPassword(password: string, stored: string) { const [salt, hash] = stored.split(":"); return Boolean(salt && hash) && timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex")); }
function balances(group: Group) {
  const totals = new Map(group.members.map(member => [member.id, 0]));
  group.expenses.forEach(expense => {
    totals.set(expense.paidBy, cents((totals.get(expense.paidBy) || 0) + expense.amount));
    expense.shares.forEach(share => totals.set(share.userId, cents((totals.get(share.userId) || 0) - share.amount)));
  });
  group.settlements.forEach(item => {
    totals.set(item.fromUserId, cents((totals.get(item.fromUserId) || 0) + item.amount));
    totals.set(item.toUserId, cents((totals.get(item.toUserId) || 0) - item.amount));
  });
  return [...totals].map(([userId, amount]) => ({ userId, amount }));
}
export function createApp(db: Db) {
const users = db.collection<User>("users");
const groups = db.collection<Group>("groups");
const sessions = db.collection<Session>("sessions");
const app = express();
app.use(cors());
app.use(express.json());

async function groupFor(id: string | string[], userId: string, res: express.Response) {
  const groupId = Array.isArray(id) ? id[0] : id;
  const group = await groups.findOne({ id: groupId, "members.id": userId });
  if (!group) res.status(404).json({ error: "Group not found." });
  return group;
}

async function requireAuth(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const session = token && await sessions.findOne({ token });
    const user = session && await users.findOne({ id: session.userId });
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = user;
    next();
  } catch {
    res.status(503).json({ error: "Unable to reach the database. Please try again." });
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/signup", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
    return res.status(400).json({ error: "Enter your name, a valid email, and a password of at least 6 characters." });
  }
  if (await users.findOne({ email })) return res.status(409).json({ error: "An account with this email already exists." });
  const user: User = { id: randomUUID(), name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  const token = randomBytes(32).toString("hex");
  await users.insertOne(user);
  await sessions.insertOne({ token, userId: user.id, createdAt: new Date().toISOString() });
  res.status(201).json({ user: publicUser(user), token });
});

app.post("/api/auth/signin", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await users.findOne({ email });
  if (!user || !validPassword(password, user.passwordHash)) return res.status(401).json({ error: "Incorrect email or password." });
  const token = randomBytes(32).toString("hex");
  await sessions.insertOne({ token, userId: user.id, createdAt: new Date().toISOString() });
  res.json({ user: publicUser(user), token });
});

app.get("/api/auth/me", requireAuth, (req: AuthRequest, res) => res.json(publicUser(req.user!)));
app.post("/api/auth/signout", requireAuth, async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token) await sessions.deleteOne({ token });
  res.status(204).end();
});

app.get("/api/users/search", requireAuth, async (req: AuthRequest, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) return res.json([]);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const matches = await users.find({
    id: { $ne: req.user!.id },
    $or: [{ name: { $regex: pattern } }, { email: { $regex: pattern } }]
  }).limit(10).toArray();
  res.json(matches.map(publicUser));
});

app.get("/api/groups", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const found = await groups.find({ "members.id": userId }).toArray();
  res.json(found.map(group => ({
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    memberCount: group.members.length,
    totalSpent: cents(group.expenses.reduce((sum, expense) => sum + expense.amount, 0)),
    myBalance: balances(group).find(balance => balance.userId === userId)?.amount || 0
  })));
});

app.post("/api/groups", requireAuth, async (req: AuthRequest, res) => {
  const name = String(req.body.name || "").trim();
  const memberIds: string[] = Array.isArray(req.body.memberIds) ? [...new Set<string>(req.body.memberIds.map((id: unknown) => String(id)))] : [];
  const user = req.user!;
  if (!name) return res.status(400).json({ error: "A group name is required." });
  const invitedUsers = await users.find({ id: { $in: memberIds } }).toArray();
  if (invitedUsers.length !== memberIds.length) return res.status(400).json({ error: "Choose members with existing Splitly accounts." });
  const members = [
    { id: user.id, name: user.name },
    ...invitedUsers.filter(invited => invited.id !== user.id).map(invited => ({ id: invited.id, name: invited.name }))
  ];
  const group: Group = { id: randomUUID(), ownerId: user.id, name, createdAt: new Date().toISOString(), members, expenses: [], settlements: [], messages: [] };
  await groups.insertOne(group);
  res.status(201).json(group);
});

app.get("/api/groups/:groupId", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (group) res.json(group);
});

app.post("/api/groups/:groupId/members", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (!group) return;
  const userId = String(req.body.userId || "");
  const user = await users.findOne({ id: userId });
  if (!user) return res.status(404).json({ error: "Choose a user with an existing Splitly account." });
  if (group.members.some(member => member.id === user.id)) return res.status(409).json({ error: "This user is already in the group." });
  const member = { id: user.id, name: user.name };
  group.members.push(member);
  await groups.replaceOne({ id: group.id }, group);
  res.status(201).json(member);
});

app.get("/api/groups/:groupId/expenses", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (group) res.json(group.expenses);
});

app.post("/api/groups/:groupId/expenses", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (!group) return;
  const description = String(req.body.description || "").trim();
  const amount = Number(req.body.amount);
  const paidBy = String(req.body.paidBy || "");
  const shares = req.body.shares as Share[];
  if (!description || !Number.isFinite(amount) || amount <= 0 || !group.members.some(member => member.id === paidBy) || !Array.isArray(shares) || !shares.length) {
    return res.status(400).json({ error: "Enter a description, valid amount, payer, and shares." });
  }
  if (shares.some(share => !group.members.some(member => member.id === share.userId) || !Number.isFinite(Number(share.amount)) || Number(share.amount) < 0)
    || Math.abs(cents(shares.reduce((sum, share) => sum + Number(share.amount), 0)) - cents(amount)) > .001) {
    return res.status(400).json({ error: "Shares must exactly equal the expense amount." });
  }
  const expense: Expense = {
    id: randomUUID(), description, amount: cents(amount), paidBy, createdAt: new Date().toISOString(),
    shares: shares.map(share => ({ userId: share.userId, amount: cents(Number(share.amount)) }))
  };
  group.expenses.unshift(expense);
  group.messages.push({ id: randomUUID(), userId: paidBy, content: `added “${description}” — ₹${expense.amount.toLocaleString("en-IN")}`, createdAt: expense.createdAt, type: "system" });
  await groups.replaceOne({ id: group.id }, group);
  res.status(201).json(expense);
});

app.get("/api/groups/:groupId/balances", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (group) res.json(balances(group));
});

app.get("/api/groups/:groupId/settlements", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (group) res.json(group.settlements);
});

app.post("/api/groups/:groupId/settlements", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (!group) return;
  const { fromUserId, toUserId } = req.body;
  const amount = Number(req.body.amount);
  if (!group.members.some(member => member.id === fromUserId) || !group.members.some(member => member.id === toUserId)
    || fromUserId === toUserId || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid settlement." });
  }
  const settlement: Settlement = { id: randomUUID(), fromUserId, toUserId, amount: cents(amount), createdAt: new Date().toISOString() };
  group.settlements.push(settlement);
  await groups.replaceOne({ id: group.id }, group);
  res.status(201).json(settlement);
});

app.get("/api/groups/:groupId/messages", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (group) res.json(group.messages);
});

app.post("/api/groups/:groupId/messages", requireAuth, async (req: AuthRequest, res) => {
  const group = await groupFor(req.params.groupId, req.user!.id, res);
  if (!group) return;
  const userId = String(req.body.userId || "");
  const content = String(req.body.content || "").trim();
  if (!group.members.some(member => member.id === userId) || !content) {
    return res.status(400).json({ error: "Choose a sender and enter a message." });
  }
  const message: Message = { id: randomUUID(), userId, content, createdAt: new Date().toISOString(), type: "message" };
  group.messages.push(message);
  await groups.replaceOne({ id: group.id }, group);
  res.status(201).json(message);
});
  return app;
}
