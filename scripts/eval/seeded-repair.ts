import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractEmbeddedAssemblySpec } from "../../src/lib/assembly/embedded-spec";
import type { TaskSet } from "./generation-trial";

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** A retained candidate and measured feedback replace the first generation prompt. */
export async function loadSeededRepair(protocolPath: string, tasks: TaskSet) {
  if (tasks.tasks.length !== 1 || tasks.tasks[0].maxRepairs !== 0) {
    throw new Error("Seeded repair requires one task and exactly one new call");
  }
  const protocolBytes = await fs.readFile(protocolPath);
  const protocol = JSON.parse(protocolBytes.toString()) as Record<string, unknown>;
  if (protocol.taskSetSha256 !== tasks.taskSetSha256
    || typeof protocol.sourcePath !== "string" || typeof protocol.feedbackPath !== "string") {
    throw new Error("Seed protocol does not match the frozen task set");
  }
  const sourceBytes = await fs.readFile(protocol.sourcePath);
  const feedbackBytes = await fs.readFile(protocol.feedbackPath);
  if (sourceBytes.length > 1_000_000 || feedbackBytes.length > 1_000_000) {
    throw new Error("Seed input exceeds its byte budget");
  }
  if (sha256(sourceBytes) !== protocol.sourceSha256 || sha256(feedbackBytes) !== protocol.feedbackSha256) {
    throw new Error("Retained source or feedback hash changed");
  }
  const source = sourceBytes.toString();
  if (extractEmbeddedAssemblySpec(source).status !== "valid") {
    throw new Error("The retained source needs a valid embedded assembly declaration");
  }
  const feedback = JSON.parse(feedbackBytes.toString()) as {
    sourceSha256?: unknown;
    passed?: unknown;
    findings?: unknown;
  };
  if (feedback.sourceSha256 !== protocol.sourceSha256 || feedback.passed !== false
    || !Array.isArray(feedback.findings) || !feedback.findings.length
    || !feedback.findings.every(line => typeof line === "string" && line.trim())) {
    throw new Error("Feedback must identify this failed retained source and its findings");
  }
  return {
    source,
    feedback: feedback.findings.join("\n"),
    protocolBytes,
    feedbackBytes,
    provenance: {
      protocolPath,
      protocolSha256: sha256(protocolBytes),
      sourceSha256: sha256(sourceBytes),
      feedbackSha256: sha256(feedbackBytes),
    },
  };
}
