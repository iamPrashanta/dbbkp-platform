import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/dbbkp_panel";

// Use a Symbol for a collision-proof global key
const DB_KEY = Symbol.for("dbbkp.queryClient");

type GlobalWithDb = typeof globalThis & {
  [DB_KEY]?: ReturnType<typeof postgres>;
};

const g = globalThis as GlobalWithDb;

// Singleton initialization
export const queryClient =
  g[DB_KEY] ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

// Persist the client in non-production for hot-reloading
if (process.env.NODE_ENV !== "production") {
  if (!g[DB_KEY]) {
    console.log("[DB] Pool initialized (Singleton)");
    g[DB_KEY] = queryClient;
  }
}

export const db = drizzle(queryClient, { schema });

export * from "./schema";
