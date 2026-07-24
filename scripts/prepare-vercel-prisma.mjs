import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SCHEMA_PATH = path.join(ROOT_DIR, "prisma", "schema.prisma");
const VERCEL_SCHEMA_PATH = path.join(
  ROOT_DIR,
  ".vercel-build",
  "prisma",
  "schema.prisma",
);

export function toPostgresSchema(source) {
  const sqliteProvider = 'provider = "sqlite"';
  const matches = source.match(/provider\s*=\s*"sqlite"/g) ?? [];
  if (matches.length !== 1 || !source.includes(sqliteProvider)) {
    throw new Error(
      "Expected exactly one canonical SQLite datasource provider in prisma/schema.prisma",
    );
  }
  return source.replace(sqliteProvider, 'provider = "postgresql"');
}

function runPrisma(args) {
  const prismaCli = path.join(
    ROOT_DIR,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma ${args[0]} failed with exit code ${result.status}`);
  }
}

export async function prepareVercelPrisma() {
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    throw new Error(
      "Vercel DATABASE_URL must be a PostgreSQL connection string",
    );
  }

  const source = await fs.readFile(SOURCE_SCHEMA_PATH, "utf8");
  await fs.mkdir(path.dirname(VERCEL_SCHEMA_PATH), { recursive: true });
  await fs.writeFile(VERCEL_SCHEMA_PATH, toPostgresSchema(source), "utf8");

  runPrisma([
    "db",
    "push",
    "--schema",
    VERCEL_SCHEMA_PATH,
    "--skip-generate",
  ]);
  runPrisma(["generate", "--schema", VERCEL_SCHEMA_PATH]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareVercelPrisma().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
