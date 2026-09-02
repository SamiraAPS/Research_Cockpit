import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { D1DatabaseLike } from "./d1";

export async function getRuntimeEnv() {
  return (await import("cloudflare:workers")).env;
}

export async function getD1(): Promise<D1DatabaseLike> {
  const env = await getRuntimeEnv();
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` and apply the generated Drizzle migration before using persistence."
    );
  }

  return env.DB;
}

export function getDb() {
  return getD1().then((database) => drizzle(database as never, { schema }));
}
