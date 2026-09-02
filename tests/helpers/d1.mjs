import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

class PreparedStatement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new PreparedStatement(this.database, this.sql, parameters);
  }

  async first(columnName) {
    const row = this.database.prepare(this.sql).get(...this.parameters);
    if (!row) return null;
    return columnName ? row[columnName] ?? null : { ...row };
  }

  async all() {
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.parameters).map((row) => ({ ...row })),
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

export async function createTestD1(root) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = new URL("../../drizzle/", new URL(`file:///${root.replaceAll("\\", "/")}/tests/helpers/`));
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migrationFile of migrationFiles) {
    const migration = await readFile(new URL(migrationFile, migrationDirectory), "utf8");
    for (const sql of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      database.exec(sql);
    }
  }
  return {
    prepare(sql) {
      return new PreparedStatement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const prepared of statements) results.push(await prepared.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      database.close();
    },
    raw: database,
  };
}
