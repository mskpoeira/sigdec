import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(here, "../../../../db/migrations");

const client = await db.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  for (const filename of files) {
    const already = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename]
    );

    if (already.rowCount) {
      console.log(`skip ${filename}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, filename), "utf8");

    console.log(`apply ${filename}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log("Migrations concluídas.");
} finally {
  client.release();
  await db.end();
}
