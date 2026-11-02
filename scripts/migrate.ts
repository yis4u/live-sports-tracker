import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function migrate() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL in .env.local before running migrations.",
    );
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Prevent two application instances from applying migrations together.
    await client.query("SELECT pg_advisory_xact_lock(735210645)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );
    const applied = new Set(
      (
        await client.query<{ name: string }>(
          "SELECT name FROM schema_migrations",
        )
      ).rows.map((row) => row.name),
    );
    const directory = path.join(process.cwd(), "db", "migrations");
    for (const name of (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      if (applied.has(name)) continue;
      await client.query(await readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        name,
      ]);
      console.log(`Applied ${name}`);
    }
    await client.query("COMMIT");
    console.log("Database migrations are up to date.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => {
  // Driver errors can include credentials or host details; keep output bounded.
  console.error(
    "Migration failed. Check DATABASE_URL, PostgreSQL connectivity, and schema permissions.",
  );
  process.exitCode = 1;
});
