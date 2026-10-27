/** Observable work, not an estimated completion percentage. */
export interface ExecutionProgress {
  step: string;
  message: string;
  startedAt: string;
  stageStartedAt: string;
  updatedAt: string;
  backend?: "native" | "wasm";
  timeoutMs?: number;
  sourceBytes?: number;
  diagnostic?: string;
}
