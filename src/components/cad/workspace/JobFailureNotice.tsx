'use client'

import { useI18n } from '@/components/i18n-provider'
import { AlertTriangle, RotateCcw, StopCircle, Wrench } from 'lucide-react'
import { Job, ExecutionLog, parseJSON } from '@/components/cad/types'

const stageLabels: Record<string, string> = {
  intake: 'Interpret request', research: 'Research', plan: 'Plan geometry',
  generate: 'Write OpenSCAD', repair: 'Repair geometry', render: 'Render geometry',
  validate: 'Checks', deliver: 'Prepare deliverables',
}

/*
 * Error codes are diagnostic identifiers, not user copy (DESIGN.md section 18:
 * "Never show a rule id to a user" is the same rule). The card keeps the human
 * message and drops the enum; these entries add the one sentence of guidance the
 * enum used to imply. Unknown codes are simply not rendered - the message from
 * the pipeline is already written for people.
 */
const CODE_GUIDANCE: Record<string, string> = {
  LLM_UNAVAILABLE: 'Model provider unavailable. Test the provider in Settings, then retry.',
  OPENSCAD_RUNTIME_UNAVAILABLE: 'The OpenSCAD runtime is not available. Check the runtime install, then retry.',
  OPENSCAD_COMPILE_TIMEOUT: 'OpenSCAD ran out of time compiling this geometry. Retry, or simplify the part.',
  OPENSCAD_RENDER_TIMEOUT: 'OpenSCAD ran out of time rendering this geometry. Retry, or simplify the part.',
  OPENSCAD_COMPILE_FAILED: 'The generated OpenSCAD could not be compiled. The source is kept for repair.',
  OPENSCAD_RENDER_FAILED: 'The geometry could not be rendered. The source is kept for repair.',
  EXECUTION_INTERRUPTED: 'The run was interrupted before it finished. Retry to continue.',
}

const KNOWN_CODES = Object.keys(CODE_GUIDANCE)

/** Remove raw enum tokens that leaked into a human-readable message. */
function stripRawCodes(message: string): string {
  let next = message
  for (const code of KNOWN_CODES) next = next.split(code).join('')
  return next
    .replace(/\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

export function readJobFailure(job: Job) {
  const parsed = parseJSON<ExecutionLog[]>(job.executionLogs, [])
  const logs = Array.isArray(parsed) ? parsed : []
  const failure = [...logs].reverse().find(log =>
    log && typeof log.message === 'string' && typeof log.event === 'string' &&
    /FAILED|ERROR|LLM_|failed|error/.test(`${log.event} ${log.message}`),
  )
  const stage = failure?.message.match(/failed during (\w+)/)?.[1]
  return {
    stage: stage ? stageLabels[stage] ?? 'Processing' :
      job.state === 'RENDER_FAILED' ? 'Render geometry' :
      job.state === 'VALIDATION_FAILED' ? 'Checks' : 'Processing',
    message: failure?.message.replace(/^Processing failed during \w+ \[[^\]]+\]:\s*/, '') ?? null,
    code: failure?.event,
  }
}

export function JobFailureNotice({
  job,
  onViewLog,
  onProcess,
  onRepair,
  solid = false,
}: {
  job: Job
  onViewLog: (job: Job) => void
  /** rerun the pipeline; the recovery action when there is no source to repair */
  onProcess?: (job: Job) => void
  /** validation-driven repair; the recovery action when a source/artifact exists */
  onRepair?: (job: Job) => void
  /**
   * Take the solid accent.
   *
   * The composer's circular action is normally the workspace's one solid lit
   * control, and this button is the accent's soft form beside it. That was
   * backwards in the failure state: the composer's circle said "Rebuild" and
   * ran the same pipeline call as "Generate again", so the loudest thing on
   * screen was a button that would only repeat the failure, while the action
   * that actually recovered the part was a 1px outline.
   *
   * When the composer is dim - which is now what happens on a failed part - the
   * card owns the state, so it takes the solid form and becomes the one lit
   * action (DESIGN.md sections 5 and 11, acceptance criterion 4).
   */
  solid?: boolean
}) {
  const { t } = useI18n()
  const failure = readJobFailure(job)
  const hasRepairableSource = Boolean(job.scadSource || job.stlPath)
  const message = failure.message ? stripRawCodes(failure.message) : ''
  /*
   * The pipeline's message is already written for people and usually names the next
   * step. Only add the code's guidance when it would not repeat that sentence - the
   * first pass rendered "…test the provider… then retry" twice in a row.
   */
  const guidance = failure.code && !/retry|settings|simplify|check the/i.test(message)
    ? CODE_GUIDANCE[failure.code]
    : undefined

  /*
   * One primary action per state (DESIGN.md section 5). A failure with a retained
   * source is repairable; a failure before generation has nothing to repair, so
   * the primary action is a fresh run. The log stays secondary: it is evidence,
   * not the recovery path.
   */
  const primary = hasRepairableSource && onRepair
    ? { label: t('Repair blocking checks'), icon: Wrench, onClick: () => onRepair(job) }
    : onProcess
      ? { label: t('Generate again'), icon: RotateCcw, onClick: () => onProcess(job) }
      : null

  return (
    <div
      role="alert"
      data-testid="job-failure-notice"
      className="pointer-events-auto w-full max-w-[460px] overflow-hidden rounded-[9px] border border-[var(--shell-border-strong)] border-l-2 border-l-[var(--shell-fail)] bg-[var(--shell-module)] text-left backdrop-blur-md"
      style={{ boxShadow: 'var(--shell-shadow)' }}
    >
      <div className="flex items-start gap-2.5 p-4">
        <AlertTriangle aria-hidden="true" strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shell-fail)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-[var(--shell-text)]">
            {t('Failed at: {0}', { 0: t(failure.stage) })}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--shell-text-muted)]">
            {message || t('The run stopped before it reported a reason. Retry, or open the execution log for details.')}
          </p>
          {guidance && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--shell-text-label)]">
              {t(guidance)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {primary && (
              <button
                type="button"
                onClick={primary.onClick}
                className={
                  solid
                    ? "inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[color:var(--shell-signal)] bg-[var(--shell-signal)] px-3 text-[12px] font-semibold text-[var(--shell-signal-ink)] transition-colors hover:bg-[var(--shell-signal-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--shell-signal)]"
                    : "inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] bg-[color-mix(in_srgb,var(--shell-signal)_10%,transparent)] px-3 text-[12px] font-semibold text-[var(--shell-signal-soft)] transition-colors hover:bg-[color-mix(in_srgb,var(--shell-signal)_16%,transparent)] active:scale-[0.98] focus-visible:outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--shell-signal)]"
                }
              >
                <primary.icon aria-hidden="true" strokeWidth={1.5} className="h-3.5 w-3.5" />
                {primary.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onViewLog(job)}
              className="inline-flex h-8 items-center rounded-[4px] border border-[var(--shell-border-strong)] px-3 text-[12px] text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-raise)] focus-visible:outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--shell-signal)]"
            >
              {t('View execution log')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/*
 * A cancellation is not a failure.
 *
 * The user chose to stop the run, so this deliberately does not wear the failure
 * card's clothes: no red, no `role="alert"` — there is nothing to attend to, and
 * the person who pressed stop already knows — and no "Failed at:" line, because
 * nothing failed.
 *
 * What it has to do is acknowledge the action and offer the way back. Before it
 * existed, cancelling a job left the viewport showing whatever the pipeline had
 * last written, with no sign the run had been stopped; the reason lived in the
 * execution log and nowhere a user would look.
 */
export function JobCancelledNotice({
  job,
  onViewLog,
  onProcess,
}: {
  job: Job
  onViewLog: (job: Job) => void
  /** the way back: a cancellation has nothing to repair, so it is a fresh run */
  onProcess?: (job: Job) => void
}) {
  const { t } = useI18n()
  return (
    <div
      data-testid="job-cancelled-notice"
      className="pointer-events-auto w-full max-w-[460px] overflow-hidden rounded-[9px] border border-[var(--shell-border-strong)] bg-[var(--shell-module)] text-left backdrop-blur-md"
      style={{ boxShadow: 'var(--shell-shadow)' }}
    >
      <div className="flex items-start gap-2.5 p-4">
        <StopCircle aria-hidden="true" strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--shell-text-label)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-[var(--shell-text)]">
            {t('You stopped this run')}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--shell-text-muted)]">
            {t('It was stopped before the part was finished. Everything completed up to that point is kept.')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onProcess && (
              <button
                type="button"
                onClick={() => onProcess(job)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] bg-[color-mix(in_srgb,var(--shell-signal)_10%,transparent)] px-3 text-[12px] font-semibold text-[var(--shell-signal-soft)] transition-colors hover:bg-[color-mix(in_srgb,var(--shell-signal)_16%,transparent)] active:scale-[0.98] focus-visible:outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--shell-signal)]"
              >
                <RotateCcw aria-hidden="true" strokeWidth={1.5} className="h-3.5 w-3.5" />
                {t('Generate again')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onViewLog(job)}
              className="inline-flex h-8 items-center rounded-[4px] border border-[var(--shell-border-strong)] px-3 text-[12px] text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-raise)] focus-visible:outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--shell-signal)]"
            >
              {t('View execution log')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
