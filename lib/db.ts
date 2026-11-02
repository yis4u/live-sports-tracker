import { Pool } from "pg";
import { ApiError } from "./http";

const databaseGlobal = globalThis as typeof globalThis & {
  scoreboardPool?: Pool;
};

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new ApiError(
      503,
      "Accounts need PostgreSQL. Set DATABASE_URL and run npm run db:migrate. Guest favorites remain available on this device.",
    );
  }
  if (!databaseGlobal.scoreboardPool) {
    databaseGlobal.scoreboardPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    });
    databaseGlobal.scoreboardPool.on("error", () => {
      // pg requires an error handler for disconnected idle clients. Avoid logging secrets.
      console.error("An idle PostgreSQL connection was interrupted.");
    });
  }
  return databaseGlobal.scoreboardPool;
}
