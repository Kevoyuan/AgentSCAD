/**
 * OpenSCAD compile/render budget and timeout classification.
 *
 * Dense assemblies can legitimately need minutes to compile. A timeout kill is
 * an operational budget failure, not a source or geometry diagnostic, so it must
 * be reported as such: the pipeline can then ask the model to simplify the design
 * and preserve the generated source for review instead of discarding it behind a
 * bare "Command failed" error.
 */

export const DEFAULT_OPENSCAD_TIMEOUT_MS = 300_000; // 5 minutes for dense native assemblies
export const MIN_OPENSCAD_TIMEOUT_MS = 5_000;
export const MAX_OPENSCAD_TIMEOUT_MS = 50 * 60_000;

/** WASM render timeouts are fixed by the isolated child-process runtime. */
export const OPENSCAD_WASM_TIMEOUT_MS = 120_000;

export type OpenScadTimeoutStage = "validation" | "render" | "preview";

export interface OpenScadTimeoutDetails {
  stage: OpenScadTimeoutStage;
  timeoutMs: number;
  elapsedMs: number;
  backend?: "native" | "wasm";
  diagnostics?: string;
}

export function getOpenScadTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.AGENTSCAD_OPENSCAD_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_OPENSCAD_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OPENSCAD_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.round(parsed), MIN_OPENSCAD_TIMEOUT_MS),
    MAX_OPENSCAD_TIMEOUT_MS,
  );
}

export function describeOpenScadTimeoutStage(stage: OpenScadTimeoutStage): string {
  switch (stage) {
    case "validation":
      return "compile";
    case "preview":
      return "PNG preview render";
    default:
      return "STL render";
  }
}

export class OpenScadTimeoutError extends Error {
  readonly code = "OPENSCAD_TIMEOUT";
  readonly stage: OpenScadTimeoutStage;
  readonly timeoutMs: number;
  readonly elapsedMs: number;

  constructor({ stage, timeoutMs, elapsedMs, backend = "native", diagnostics }: OpenScadTimeoutDetails) {
    const budgetSeconds = Math.max(1, Math.round(timeoutMs / 1000));
    const elapsedSeconds = Math.max(0.1, Math.round(elapsedMs / 100) / 10);
    super(
      `OpenSCAD ${describeOpenScadTimeoutStage(stage)} timed out after ${elapsedSeconds}s ` +
        `(budget ${budgetSeconds}s): the generated design is too complex to finish within the limit. ` +
        (backend === "wasm"
          ? "Simplify the geometry or use native OpenSCAD; the WASM budget is fixed at 120s."
          : "Simplify the geometry or raise AGENTSCAD_OPENSCAD_TIMEOUT_MS.") +
        (diagnostics ? `\n${diagnostics}` : ""),
    );
    this.name = "OpenScadTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

export function isOpenScadTimeoutError(error: unknown): error is OpenScadTimeoutError {
  return error instanceof OpenScadTimeoutError;
}

/** Validation-stage timeout: the generated SCAD never finished compiling. */
export function isOpenScadCompileTimeoutError(error: unknown): error is OpenScadTimeoutError {
  return isOpenScadTimeoutError(error) && error.stage === "validation";
}

export function isOpenScadTimeoutMessage(error: unknown): boolean {
  return (
    error instanceof Error &&
    /timed out after \d+(?:\.\d+)? seconds/i.test(error.message)
  );
}

interface OpenScadExecErrorLike {
  message?: string;
  code?: string | number | null;
  signal?: string | null;
  killed?: boolean;
  stdout?: unknown;
  stderr?: unknown;
}

/**
 * Node's `exec` timeout kills the child with SIGTERM and leaves the error message
 * as a bare "Command failed: ..." with empty stderr, which looks identical to an
 * unknown failure. Detect the kill explicitly instead of parsing the message.
 */
export function isOpenScadExecTimeoutKill(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const execError = error as OpenScadExecErrorLike;
  return (
    execError.code === "ETIMEDOUT" ||
    (execError.killed === true && execError.signal === "SIGTERM" && execError.code == null)
  );
}

function outputSnippet(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Convert a native OpenSCAD exec failure into a typed error.
 *
 * Timeout kills become {@link OpenScadTimeoutError}; other failures keep the
 * OpenSCAD stderr/stdout diagnostics so the existing compile-repair classifier
 * can see parser/CGAL messages instead of a bare "Command failed" string.
 */
export function toOpenScadExecError(options: {
  error: unknown;
  stage: OpenScadTimeoutStage;
  timeoutMs: number;
  elapsedMs: number;
  prefix: string;
}): Error {
  const { error, stage, timeoutMs, elapsedMs, prefix } = options;
  const execError = (error ?? {}) as OpenScadExecErrorLike;
  const baseMessage = error instanceof Error ? error.message : String(error);
  const output = [outputSnippet(execError.stdout), outputSnippet(execError.stderr)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);
  const diagnostics = [
    `elapsed=${elapsedMs}ms`,
    execError.code !== undefined && execError.code !== null ? `code=${execError.code}` : null,
    execError.signal ? `signal=${execError.signal}` : null,
    execError.killed ? "killed=true" : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (isOpenScadExecTimeoutKill(error)) {
    return new OpenScadTimeoutError({ stage, timeoutMs, elapsedMs, diagnostics: `${output} (${diagnostics})` });
  }

  return new Error(
    `${prefix}: ${baseMessage}${output ? `\n${output}` : ""} (${diagnostics})`,
  );
}
