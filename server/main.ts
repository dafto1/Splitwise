import "dotenv/config";
import { MongoClient } from "mongodb";
import { createApp } from "./index";

const port = Number(process.env.PORT) || 3000;
const uri = process.env.MONGODB_URI;

if (!uri) throw new Error("MONGODB_URI is required. Add it to your .env file.");

const client = new MongoClient(uri);
const db = client.db(process.env.MONGODB_DB || "splitly");

async function start() {
  await client.connect();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("groups").createIndex({ ownerId: 1 }),
    db.collection("groups").createIndex({ "members.id": 1 }),
    db.collection("sessions").createIndex({ token: 1 }, { unique: true })
  ]);
  createApp(db).listen(port, () => console.log(`Splitly API connected to MongoDB database: ${db.databaseName} on port ${port}`));
}

start().catch(error => {
  console.error("MongoDB connection failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
