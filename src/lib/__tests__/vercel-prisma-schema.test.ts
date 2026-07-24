import { describe, expect, test } from "bun:test";

import { toPostgresSchema } from "../../../scripts/prepare-vercel-prisma.mjs";

describe("Vercel Prisma schema preparation", () => {
  test("changes only the canonical datasource provider", () => {
    const sqliteSchema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url = env("DATABASE_URL")
}

model Job {
  id String @id
}`;

    const postgresSchema = toPostgresSchema(sqliteSchema);

    expect(postgresSchema).toContain('provider = "postgresql"');
    expect(postgresSchema.replace('provider = "postgresql"', 'provider = "sqlite"'))
      .toBe(sqliteSchema);
  });

  test("fails closed if the canonical provider cannot be identified", () => {
    expect(() => toPostgresSchema('provider = "postgresql"')).toThrow(
      "exactly one canonical SQLite datasource",
    );
  });
});
