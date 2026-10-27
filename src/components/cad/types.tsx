import { Box, Code2, Shield, CheckCircle2 } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParameterDef {
  key: string
  label: string
  kind: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  source: string
  editable: boolean
  description: string
  group: string
}

/**
 * The outcome ledger, mirrored for the client.
 *
 * The server module that owns these types imports the database, so the browser
 * cannot import from it - only the shape crosses the wire. `accepted` and
 * `rejected` are the two kinds that say whether a task really succeeded; an
 * edit or an export is a process signal, not a verdict.
 */
export type JobOutcomeKind = 'accepted' | 'rejected' | 'user_edited' | 'exported'

export interface JobOutcomeEvent {
  id: string
  jobId: string
  kind: JobOutcomeKind
  source: 'user' | 'system'
  detail: string | null
  artifactVersionId: string | null
  createdAt: string
}

export interface JobOutcomeSummary {
  total: number
  counts: Record<JobOutcomeKind, number>
  latestDecision: {
    kind: JobOutcomeKind
    createdAt: string
    artifactVersionId?: string | null
  } | null
  /** True only when the most recent decision is `accepted` for the current artifact. */
  taskSucceeded: boolean
}

export interface ParameterSchema {
  part_family: string
  design_summary: string
  parameters: ParameterDef[]
}

export interface ValidationResult {
  rule_id: string
  rule_name: string
  level: string
  passed: boolean
  is_critical: boolean
  message: string
  status?: 'PASS' | 'WARN' | 'FAIL' | 'SKIP' | 'ERROR' | 'NOT_RUN'
}

export { getValidationEvidenceStatus } from '@/lib/validation/evidence-status'
export type { ValidationEvidenceStatus } from '@/lib/validation/evidence-status'

export interface ExecutionLog {
  timestamp: string
  event: string
  message: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  images?: string[]
}

export interface Job {
  executionProgress?: import("@/lib/pipeline/execution-progress").ExecutionProgress | null;
  /**
   * True while this record came from the summary list (`?summary=true`) and has
   * not yet been hydrated by `/api/jobs/:id`.
   *
   * The list payload carries `state` / `stlPath` / `pngPath` but not
   * `parameterSchema`, `parameterValues` or `validationResults`. Without this
   * flag a module cannot tell "this part has no dimensions" from "the dimensions
   * have not arrived yet", and it prints the first sentence — which is false, and
   * false in the most expensive direction ("Generate this part").
   * See DESIGN.md sections 17 and 18.
   */
  summaryOnly?: boolean
  /**
   * True when the detail fetch for this record failed.
   *
   * Without it a failed request leaves the record in the "still arriving" state
   * forever, and the panels keep drawing loading bars for a part that will
   * never arrive. A failed load has to be said out loud, because the honest
   * alternative — "this part has no dimensions" — is not what happened.
   */
  detailFailed?: boolean
  id: string
  state: string
  inputRequest: string
  customerId: string | null
  modelId: string | null
  partFamily: string | null
  builderName: string | null
  generationPath: string | null
  scadSource: string | null
  parameterSchema: string | null
  parameterValues: string | null
  researchResult: string | null
  intentResult: string | null
  designResult: string | null
  stlPath: string | null
  pngPath: string | null
  renderLog: string | null
  validationResults: string | null
  validationReportJson?: string | null
  visualRepairReportJson?: string | null
  qualityScore?: number | null
  executionLogs: string | null
  notes: string | null
  parentId: string | null
  retryCount: number
  maxRetries: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

// ─── Status vocabulary ───────────────────────────────────────────────────────
/*
 * ONE mapping from pipeline state to user language and semantic tone
 * (DESIGN.md sections 2, 6, 10, 11, 19). Every surface that names a state — the
 * slots rail, the command palette, the activity feed, the shell header, badges —
 * reads this table. Raw enum values never reach UI copy.
 *
 * Backend state strings stay exactly as they are (AGENTS.md runtime contract);
 * only the presentation is unified. `labelKey` is an i18n catalog key, phrased as
 * an English sentence instead of a SCREAMING_ENUM.
 */

export type JobStateTone = 'neutral' | 'ok' | 'warn' | 'fail'

export interface JobStateUi {
  labelKey: string
  tone: JobStateTone
}

export const DEFAULT_JOB_STATE_UI: JobStateUi = { labelKey: 'Draft', tone: 'neutral' }

export const JOB_STATE_UI: Record<string, JobStateUi> = {
  NEW: { labelKey: 'Draft', tone: 'neutral' },
  SCAD_GENERATED: { labelKey: 'Code ready', tone: 'neutral' },
  RENDERED: { labelKey: 'Rendered', tone: 'neutral' },
  VALIDATED: { labelKey: 'Validated', tone: 'ok' },
  DELIVERED: { labelKey: 'Ready to export', tone: 'ok' },
  DEBUGGING: { labelKey: 'Repairing', tone: 'warn' },
  REPAIRING: { labelKey: 'Repairing', tone: 'warn' },
  VALIDATION_FAILED: { labelKey: 'Needs changes', tone: 'fail' },
  GEOMETRY_FAILED: { labelKey: 'Failed', tone: 'fail' },
  RENDER_FAILED: { labelKey: 'Failed', tone: 'fail' },
  HUMAN_REVIEW: { labelKey: 'Needs your decision', tone: 'warn' },
  CANCELLED: { labelKey: 'Cancelled', tone: 'neutral' },
  /*
   * DELETING is written by the batch delete route before it removes the rows.
   * When artifact cleanup fails the row stays behind with this state, so it is
   * a state the user can actually see for a long time. Without a mapping it fell
   * through to DEFAULT_JOB_STATE_UI and read as "Draft" - a failed delete
   * looked like a brand new empty part. "warn" keeps a stuck deletion visible
   * instead of letting it pass as routine.
   */
  DELETING: { labelKey: 'Deleting', tone: 'warn' },
}

export function getJobStateUi(state: string): JobStateUi {
  return JOB_STATE_UI[state] ?? DEFAULT_JOB_STATE_UI
}

export function getJobStateLabel(state: string, t: (key: string) => string = (key) => key): string {
  return t(getJobStateUi(state).labelKey)
}

/*
 * Tone → shell token. Text tones are a same-role shade mixed toward the reading
 * text colour, so the smallest state word still clears 4.6:1 in BOTH themes
 * (DESIGN.md sections 11 and 21: a semantic colour must not become unreadable in
 * light mode, and no new hue is invented). Dots and rings use the pure semantic
 * token; the state WORD is always present, so colour is never the only signal.
 */
export const STATE_TONE_CLASS: Record<JobStateTone, string> = {
  neutral: 'text-[var(--shell-text-label)]',
  ok: 'text-[color-mix(in_srgb,var(--shell-ok)_58%,var(--shell-text))]',
  warn: 'text-[color-mix(in_srgb,var(--shell-warn)_58%,var(--shell-text))]',
  fail: 'text-[color-mix(in_srgb,var(--shell-fail)_72%,var(--shell-text))]',
}

export const STATE_TONE_DOT_CLASS: Record<JobStateTone, string> = {
  neutral: 'bg-[var(--shell-text-dim)]',
  ok: 'bg-[var(--shell-ok)]',
  warn: 'bg-[var(--shell-warn)]',
  fail: 'bg-[var(--shell-fail)]',
}

export const STATE_TONE_RING_CLASS: Record<JobStateTone, string> = {
  neutral: 'ring-[color:color-mix(in_srgb,var(--shell-text-label)_45%,transparent)]',
  ok: 'ring-[color:color-mix(in_srgb,var(--shell-ok)_55%,transparent)]',
  warn: 'ring-[color:color-mix(in_srgb,var(--shell-warn)_55%,transparent)]',
  fail: 'ring-[color:color-mix(in_srgb,var(--shell-fail)_60%,transparent)]',
}

/*
 * The same four tones as `var()` references rather than literals.
 *
 * These were the dark theme's values, pasted into a map that every theme
 * shared: on the light theme a "passed" dot rendered in a pale green at 1.9:1 on
 * white. A `var(--shell-*)` string resolves per theme at paint time, so the map
 * cannot disagree with the tokens it is supposed to mirror (DESIGN.md section 22).
 */
export const STATE_TONE_COLOR: Record<JobStateTone, string> = {
  neutral: 'var(--shell-text-dim)',
  ok: 'var(--shell-ok)',
  warn: 'var(--shell-warn)',
  fail: 'var(--shell-fail)',
}

export function getStateToneColor(state: string): string {
  return STATE_TONE_COLOR[getJobStateUi(state).tone]
}

/* State groups, defined once so no surface re-derives a slightly different list. */
export const FAILED_JOB_STATES = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'] as const
export const PROCESSING_JOB_STATES = ['SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING'] as const
export const REVIEW_JOB_STATES = ['HUMAN_REVIEW'] as const
export const SUCCESS_JOB_STATES = ['VALIDATED', 'DELIVERED'] as const

export function isFailedJobState(state: string): boolean {
  return (FAILED_JOB_STATES as readonly string[]).includes(state)
}

export function isProcessingJobState(state: string): boolean {
  return (PROCESSING_JOB_STATES as readonly string[]).includes(state)
}

export function isReviewJobState(state: string): boolean {
  return (REVIEW_JOB_STATES as readonly string[]).includes(state)
}

/* Legacy shape consumed by stats/timeline/job-compare; derived, never hand-mapped. */
export const STATE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string; hex: string }> =
  Object.fromEntries(
    Object.keys(JOB_STATE_UI).map((state) => {
      const tone = getJobStateUi(state).tone
      return [state, {
        bg: 'bg-transparent',
        text: STATE_TONE_CLASS[tone],
        dot: STATE_TONE_DOT_CLASS[tone],
        border: 'border-transparent',
        hex: STATE_TONE_COLOR[tone],
      }]
    })
  )

export function getStateHex(state: string): string {
  return getStateToneColor(state)
}

export function InboxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

export const PIPELINE_STEPS = [
  { key: 'NEW', label: 'INTAKE', icon: InboxIcon },
  { key: 'SCAD_GENERATED', label: 'GENERATE', icon: Code2 },
  { key: 'RENDERED', label: 'RENDER', icon: Box },
  { key: 'VALIDATED', label: 'VALIDATE', icon: Shield },
  { key: 'DELIVERED', label: 'DELIVER', icon: CheckCircle2 },
]

/*
 * Filter chips in the rail speak the same vocabulary as the rows (DESIGN.md
 * section 6). The filter KEY is still the backend group; only the label moves.
 */
export const FILTER_STATES = [
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'Draft' },
  { key: 'HUMAN_REVIEW', label: 'Needs your decision' },
  { key: 'DELIVERED', label: 'Ready to export' },
  { key: 'FAILED', label: 'Failed', stateKey: 'VALIDATION_FAILED' },
]

export const CANCELABLE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function formatTime(iso: string, locale = 'en') {
  const d = new Date(iso)
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDate(iso: string, locale = 'en') {
  const d = new Date(iso)
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

export function timeAgo(iso: string) {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

/*
 * Relative time in words. `timeAgo` stays a terse duration for dense readouts;
 * this is for copy the user reads in a sentence ("2m ago" in a row or palette
 * result) where a bare "2m" looks like a measurement.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'just now'
  return relativeTimeFromDate(new Date(then))
}

export function relativeTimeFromDate(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(date.toISOString())
}

/*
 * The one dimension string the rail and the palette show as meta. It prefers
 * measured B001 evidence and falls back to declared parameter values, so a part
 * that has not been validated still reads as a real object rather than an id.
 */
export function getJobDimensions(job: Job): string | null {
  if (job.validationReportJson) {
    try {
      const report = JSON.parse(job.validationReportJson)
      if (Array.isArray(report.checks)) {
        for (const chk of report.checks) {
          if (chk.rule_id === 'B001' && chk.details) {
            const actual = chk.details.actual_bbox as { length?: number; width?: number; height?: number } | undefined
            if (actual && typeof actual.length === 'number' && typeof actual.width === 'number' && typeof actual.height === 'number') {
              return `${Math.round(actual.length)} × ${Math.round(actual.width)} × ${Math.round(actual.height)} mm`
            }
          }
        }
      }
    } catch {
      // Ignore JSON error
    }
  }

  if (job.parameterValues) {
    try {
      const vals = JSON.parse(job.parameterValues) as Record<string, unknown>
      const entries = Object.entries(vals).filter(
        ([key, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0 && !/angle|radius|fillet|chamfer|count|teeth|hole|wall|thickness|clearance|pitch|draft|detail|fn\b/i.test(key)
      ) as Array<[string, number]>

      /*
       * Parameter keys are author-named (`ship_length`, `body_width`, `body_depth`,
       * `total_height`), so match by suffix rather than a fixed list. Depth is the
       * usual third axis for folded/plate parts. Missing axes are filled from the
       * remaining numeric parameters in declaration order - this is metadata for a
       * palette row, not a measurement claim (B001 evidence above wins when present).
       */
      const used = new Set<string>()
      const pick = (re: RegExp): number | null => {
        for (const [key, value] of entries) {
          if (!used.has(key) && re.test(key.toLowerCase())) {
            used.add(key)
            return value
          }
        }
        return null
      }

      let l = pick(/length$|^l$/) ?? pick(/^x$|size_?x$/)
      let w = pick(/width$|^w$/)
      let h = pick(/height$|^h$|depth$/)
      if (l === null) l = pick(/width$|^w$/)
      if (w === null) w = pick(/depth$/)
      if (h === null) h = pick(/thickness$/)

      if (l !== null && w !== null && h !== null) {
        return `${Math.round(l)} × ${Math.round(w)} × ${Math.round(h)} mm`
      }

      const fallback = entries.filter(([key]) => !used.has(key)).slice(0, 3).map(([, value]) => value)
      if (fallback.length === 3) {
        return `${Math.round(fallback[0])} × ${Math.round(fallback[1])} × ${Math.round(fallback[2])} mm`
      }
    } catch {
      // Ignore JSON error
    }
  }

  /*
   * The workspace list endpoint returns a summary job (no parameterValues), so for
   * rows and palette entries the brief itself is the only size evidence available.
   * When the user wrote "90 × 60 × 25 mm", that is a declared size and it is what the
   * row should show - clearly a description, not a measurement claim.
   */
  const fromBrief = job.inputRequest.match(/(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*mm/i)
  if (fromBrief) {
    return `${fromBrief[1]} × ${fromBrief[2]} × ${fromBrief[3]} mm`
  }

  return null
}

export function getStateInfo(state: string) {
  return STATE_COLORS[state] || {
    bg: 'bg-transparent',
    text: 'text-[var(--shell-text-label)]',
    dot: 'bg-[var(--shell-text-dim)]',
    border: 'border-transparent',
    hex: STATE_TONE_COLOR.neutral,
  }
}

export function parseJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

/*
 * How far a part got, as a state -> percentage map.
 *
 * This used to be an index lookup into PIPELINE_STEPS, the five happy-path
 * states. Every state OFF that path - repairing, failed, waiting for a decision
 * - returned 0, and the job card clamped 0 to 4%. So the states a user is most
 * likely to be looking at while a bar is on screen (a part being repaired, a
 * part blocked on a decision) showed a bar that had barely started.
 *
 * The values follow the real stage order: INTAKE -> GENERATE -> RENDER ->
 * VALIDATE -> DELIVER. A repair inherits the stage it interrupts.
 */
const STATE_PROGRESS: Record<string, number> = {
  NEW: 20,
  SCAD_GENERATED: 40,
  RENDERED: 60,
  VALIDATED: 80,
  DELIVERED: 100,
  DEBUGGING: 45,
  REPAIRING: 75,
  VALIDATION_FAILED: 80,
  GEOMETRY_FAILED: 60,
  RENDER_FAILED: 60,
  HUMAN_REVIEW: 80,
  CANCELLED: 0,
  DELETING: 0,
}

export function getPipelineProgress(state: string): number {
  return STATE_PROGRESS[state] ?? 0
}

export function safeNum(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !isNaN(val)) return val
  return fallback
}
