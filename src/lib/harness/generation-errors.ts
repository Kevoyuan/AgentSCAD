import type { StructuredGenerationResult } from "@/lib/harness/types";

/**
 * OpenSCAD rejected an otherwise parseable LLM generation result.
 *
 * Keep the generated artifact attached so the pipeline can repair the actual
 * source instead of losing it behind a generic generation exception.
 */
export class GeneratedScadCompileError extends Error {
  readonly generationResult: StructuredGenerationResult;
  readonly compileLog: string;

  constructor(
    generationResult: StructuredGenerationResult,
    cause: unknown,
  ) {
    const compileLog = cause instanceof Error ? cause.message : String(cause);
    super(`Generated SCAD failed OpenSCAD compilation: ${compileLog}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = "GeneratedScadCompileError";
    this.generationResult = generationResult;
    this.compileLog = compileLog;
  }
}
