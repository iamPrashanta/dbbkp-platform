import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/dbbkp_panel";

// Use a single connection for migrations, pooled for queries
const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });

export * from "./schema";
