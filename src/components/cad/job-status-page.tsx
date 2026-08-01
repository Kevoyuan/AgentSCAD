'use client'

import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, Code2, CheckCircle2,
  XCircle, Clock, FileText, Ban, AlertCircle, GitBranch,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Job, PIPELINE_STEPS, getPipelineProgress, parseJSON, ExecutionLog,
  timeAgo, getStateInfo, ValidationResult,
  getValidationEvidenceStatus,
} from './types'
import { highlightScad } from '@/lib/scad-highlight'

// ─── Types ──────────────────────────────────────────────────────────────────

interface JobStatusPageProps {
  job: Job
  streamEvents?: Array<{ step: string; state: string; message: string; timestamp: string }>
  onViewLogs: () => void
  onViewError?: () => void
  onCancel: (job: Job) => void
  onResolveIntent?: (selectedInterpretationId: string) => Promise<void>
  isCancelable: boolean
}

interface IntentInterpretation {
  id: string
  label: string
  domain?: string
  objectKind?: string
  probability?: number
  evidence?: string[]
}

interface IntentClarification {
  status?: string
  clarificationQuestion?: string | null
  interpretations?: IntentInterpretation[]
}

// ─── Step Time Estimation ───────────────────────────────────────────────────

const AVERAGE_STEP_TIMES: Record<string, number> = {
  NEW: 1,
  SCAD_GENERATED: 8,
  RENDERED: 5,
  VALIDATED: 3,
  DELIVERED: 1,
}

function calculateElapsed(createdAt: string): string {
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
}

// ─── Step Duration from Execution Logs ──────────────────────────────────────

function getStepDurations(executionLogs: string | null): Record<string, number> {
  if (!executionLogs) return {}
  const logs = parseJSON<ExecutionLog[]>(executionLogs, [])
  const stepTimes: Record<string, { start: number; end?: number }> = {}

  for (const log of logs) {
    const ts = new Date(log.timestamp).getTime()
    for (const step of PIPELINE_STEPS) {
      if (log.event === step.key) {
        if (!stepTimes[step.key]) {
          stepTimes[step.key] = { start: ts }
        } else {
          stepTimes[step.key].end = ts
        }
      }
    }
    const eventIdx = PIPELINE_STEPS.findIndex(s => s.key === log.event)
    if (eventIdx > 0) {
      const prevStep = PIPELINE_STEPS[eventIdx - 1].key
      if (stepTimes[prevStep] && !stepTimes[prevStep].end) {
        stepTimes[prevStep].end = ts
      }
    }
  }

  const durations: Record<string, number> = {}
  for (const [key, times] of Object.entries(stepTimes)) {
    if (times.end && times.start) {
      durations[key] = times.end - times.start
    }
  }
  return durations
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function parseObject(value: string | null): Record<string, unknown> {
  return parseJSON<Record<string, unknown>>(value, {})
}

function IntentClarificationCard({
  job,
  onResolveIntent,
}: {
  job: Job
  onResolveIntent?: (selectedInterpretationId: string) => Promise<void>
}) {
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const intent = parseJSON<IntentClarification>(job.intentResult, {})
  const interpretations = Array.isArray(intent.interpretations) ? intent.interpretations : []
  const question = intent.clarificationQuestion
    || 'This request has multiple plausible CAD meanings. Which one should AgentSCAD build?'

  const selectInterpretation = async (id: string) => {
    if (!onResolveIntent || submittingId) return
    setSubmittingId(id)
    try {
      await onResolveIntent(id)
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono uppercase tracking-widest text-amber-300">Clarification required</p>
            <h3 className="mt-2 text-lg font-semibold leading-snug text-[var(--app-text-primary)]">{question}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--app-text-muted)]">
              No model has been generated yet. Your choice is stored locally as explicit input and can be audited later.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {interpretations.map((interpretation) => (
            <button
              key={interpretation.id}
              type="button"
              className="group rounded-lg border border-[color:var(--app-border)] bg-[var(--app-surface)] p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.05] disabled:cursor-wait disabled:opacity-60"
              disabled={!onResolveIntent || Boolean(submittingId)}
              onClick={() => void selectInterpretation(interpretation.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-[var(--app-text-primary)]">{interpretation.label}</span>
                {submittingId === interpretation.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-300" />}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {interpretation.domain && (
                  <span className="rounded border border-[color:var(--app-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)]">
                    {interpretation.domain}
                  </span>
                )}
                {interpretation.objectKind && (
                  <span className="rounded border border-[color:var(--app-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)]">
                    {interpretation.objectKind}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {interpretations.length === 0 && (
          <p className="mt-5 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
            Clarification options are unavailable. Re-run intake or create a new job with a more specific request.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Live Elapsed Timer ─────────────────────────────────────────────────────

function LiveElapsed({ createdAt }: { createdAt: string }) {
  const [elapsed, setElapsed] = useState(() => calculateElapsed(createdAt))

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(calculateElapsed(createdAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [createdAt])

  return <span>{elapsed}</span>
}

function FailureDiagnostics({ job }: { job: Job }) {
  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])
  const validationResults = parseJSON<ValidationResult[]>(job.validationResults, [])
  const renderLog = parseJSON<{ warnings?: string[]; errors?: string[]; render_time_ms?: number } | null>(job.renderLog, null)
  const failedLogs = logs.filter((log) => {
    const text = `${log.event} ${log.message}`.toLowerCase()
    return text.includes('failed') || text.includes('error')
  })
  const failedValidation = validationResults.filter((rule) =>
    !['PASS', 'WARN'].includes(getValidationEvidenceStatus(rule)),
  )
  const renderMessages = [...(renderLog?.errors || []), ...(renderLog?.warnings || [])]
  const hasDiagnostics = failedLogs.length > 0 || failedValidation.length > 0 || renderMessages.length > 0

  if (!hasDiagnostics) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <div className="flex items-center gap-2 text-amber-300">
          <AlertCircle className="h-4 w-4" />
          <span className="text-[13px] font-mono uppercase tracking-widest">No diagnostic payload</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--cad-text-muted)]">
          This job is failed, but no execution log, validation result, or render warning was returned with the job.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-rose-300">
          <AlertCircle className="h-4 w-4" />
          <span className="text-[13px] font-mono uppercase tracking-widest">Error diagnostics</span>
        </div>
        <span className="text-xs font-mono text-[var(--cad-text-muted)]">
          {failedLogs.length + failedValidation.length + renderMessages.length} items
        </span>
      </div>
      <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
        {failedLogs.map((log, idx) => (
          <div key={`log-${idx}`} className="rounded border border-rose-500/15 bg-black/15 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-rose-300">{log.event}</span>
              <span className="text-[8px] font-mono text-[var(--cad-text-muted)]">{new Date(log.timestamp).toLocaleTimeString()}</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--cad-text-secondary)]">{log.message}</p>
          </div>
        ))}
        {failedValidation.map((rule) => (
          <div key={rule.rule_id} className="rounded border border-amber-500/15 bg-amber-500/5 px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-black/20 px-1 text-[8px] font-mono text-amber-300">{rule.rule_id}</span>
              <span className="text-[13px] font-medium text-[var(--cad-text)]">{rule.rule_name}</span>
              {rule.is_critical && <span className="text-[8px] font-mono uppercase text-rose-300">critical</span>}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--cad-text-secondary)]">{rule.message}</p>
          </div>
        ))}
        {renderMessages.map((message, idx) => (
          <div key={`render-${idx}`} className="rounded border border-orange-500/15 bg-orange-500/5 px-2 py-1.5">
            <span className="text-xs font-mono text-orange-300">RENDER</span>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--cad-text-secondary)]">{message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function GenerationEvidence({
  job,
  streamEvents,
}: {
  job: Job
  streamEvents: Array<{ step: string; state: string; message: string; timestamp: string }>
}) {
  const logs = parseJSON<ExecutionLog[]>(job.executionLogs, [])
  const designResult = parseObject(job.designResult)
  const researchResult = parseObject(job.researchResult)
  const traceEvents = streamEvents.length
    ? streamEvents
    : logs.map((log) => ({
        step: log.event,
        state: log.event,
        message: log.message,
        timestamp: log.timestamp,
      }))

  const inferenceFacts = [
    job.modelId ? `model: ${job.modelId}` : null,
    job.generationPath ? `path: ${job.generationPath}` : null,
    typeof designResult.approach === 'string' ? `approach: ${designResult.approach}` : null,
    typeof researchResult.summary === 'string' ? `summary: ${researchResult.summary}` : null,
  ].filter(Boolean)

  const scadSource = job.scadSource || ''
  const highlightedScad = scadSource ? highlightScad(scadSource) : ''
  const lineCount = scadSource ? scadSource.split('\n').length : 0

  return (
    <div className="flex flex-1 min-h-0 flex-col 2xl:flex-row h-full">
      {/* Inference Stream */}
      <div className="flex flex-1 flex-col min-w-0 2xl:border-r border-[color:var(--app-border)]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-6 py-3 bg-[var(--app-surface-raised)]/30">
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--app-text-primary)]">Inference Stream</span>
          <span className="online-dot" />
        </div>
        {inferenceFacts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-[color:var(--app-border)] px-6 py-2 bg-[var(--app-surface)]">
            {inferenceFacts.map((fact) => (
              <span key={fact} className="rounded border border-[color:var(--app-border)] bg-[var(--app-surface-raised)] px-2 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)]">
                {fact}
              </span>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="divide-y divide-[color:var(--app-border)]">
            {(traceEvents.length ? traceEvents : [{ step: 'waiting', state: job.state, message: 'Waiting for inference stream...', timestamp: job.updatedAt || job.createdAt }]).map((event, idx) => (
              <motion.div
                key={`${event.timestamp}-${idx}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-3 px-2 hover:bg-[var(--app-hover-subtle)] transition-colors linear-transition group"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="truncate text-xs font-mono font-medium text-[var(--app-accent-text)]">{event.step}</span>
                  <span className="shrink-0 text-[10px] font-mono text-[var(--app-text-dim)] group-hover:text-[var(--app-text-muted)] transition-colors">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--app-text-secondary)]">{event.message}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* SCAD Code */}
      <div className="flex flex-1 flex-col min-w-0 border-t 2xl:border-t-0 border-[color:var(--app-border)] bg-[var(--app-code-bg)]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-6 py-3 bg-[var(--app-surface-raised)]/30">
          <span className="text-xs font-mono uppercase tracking-widest text-[var(--app-text-primary)]">SCAD Code</span>
          <span className="rounded bg-[var(--app-surface-hover)] px-2 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)]">
            {lineCount ? `${lineCount} lines` : 'pending'}
          </span>
        </div>
        {scadSource ? (
          <pre className="flex-1 overflow-auto p-6 text-[13px] font-mono leading-relaxed text-[var(--cad-text-secondary)]">
            <code dangerouslySetInnerHTML={{ __html: highlightedScad }} />
          </pre>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-relaxed text-[var(--app-text-dim)]">
            SCAD source will appear as soon as generation completes.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function JobStatusPage({ job, streamEvents = [], onViewLogs, onViewError, onCancel, onResolveIntent, isCancelable }: JobStatusPageProps) {
  const state = job.state
  const progress = getPipelineProgress(state)
  const currentIdx = PIPELINE_STEPS.findIndex(s => s.key === state)
  const failedStates = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED']
  const isFailed = failedStates.includes(state)
  const isDelivered = state === 'DELIVERED'
  const isIntentClarification = state === 'HUMAN_REVIEW' && job.generationPath === 'intent_clarification'
  const persistedIntent = parseJSON<IntentClarification & {
    approval?: { selectedInterpretationId?: string }
  }>(job.intentResult, {})
  const approvedInterpretation = persistedIntent.interpretations?.find(
    interpretation => interpretation.id === persistedIntent.approval?.selectedInterpretationId,
  )
  const stepDurations = useMemo(() => getStepDurations(job.executionLogs), [job.executionLogs])
  const latestEvent = streamEvents[streamEvents.length - 1]

  // Current step label
  const currentStepLabel = useMemo(() => {
    if (isFailed) {
      const failedStep = state.replace('_FAILED', '')
      const step = PIPELINE_STEPS.find(s => s.key === failedStep)
      return step ? `Failed at ${step.label}` : 'Failed'
    }
    if (isDelivered) return 'Complete'
    if (isIntentClarification) return 'Clarify request'
    const step = PIPELINE_STEPS.find(s => s.key === state)
    return step ? step.label : state
  }, [state, isFailed, isDelivered, isIntentClarification])

  // Calculate effective progress (for failed, show up to the failed step)
  const effectiveProgress = isFailed
    ? Math.max(getPipelineProgress(state.replace('_FAILED', '')), 20)
    : progress

  return (
    <div className="h-full overflow-hidden bg-[var(--app-surface)]">
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="h-full flex flex-col min-h-0"
        >
          {/* Header (Full Bleed) */}
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--app-border)] bg-[var(--app-surface)] px-6 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                isFailed ? 'border-rose-500/25 bg-rose-500/10 text-rose-300' :
                isDelivered ? 'border-lime-500/25 bg-lime-500/10 text-lime-300' :
                isIntentClarification ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' :
                'border-[color:var(--app-border)] bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]'
              }`}>
                {isFailed ? <XCircle className="h-5 w-5" /> :
                 isDelivered ? <CheckCircle2 className="h-5 w-5" /> :
                 isIntentClarification ? <GitBranch className="h-5 w-5" /> :
                 <Loader2 className="h-5 w-5 animate-spin" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className={`text-lg font-semibold tracking-tight ${
                    isFailed ? 'text-rose-400' :
                    isDelivered ? 'text-lime-400' :
                    isIntentClarification ? 'text-amber-300' :
                    'text-[var(--app-text-primary)]'
                  }`}>
                    {currentStepLabel}
                  </h2>
                  <span className="rounded border border-[color:var(--app-border)] bg-[var(--app-surface-raised)] px-2 py-0.5 text-xs font-mono uppercase tracking-widest text-[var(--app-text-muted)]">
                    {state.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {approvedInterpretation && (
                    <span
                      className="max-w-[260px] truncate rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300"
                      title={`Approved interpretation: ${approvedInterpretation.label}. Create a new job to choose a different interpretation.`}
                    >
                      Approved: {approvedInterpretation.label}
                    </span>
                  )}
                  <span className="truncate text-xs text-[var(--app-text-muted)]">
                    {latestEvent?.message || 'Queued CAD generation pipeline...'}
                  </span>
                  {job.builderName && (
                    <>
                      <span className="text-[var(--app-border)]">&bull;</span>
                      <span className="text-xs font-mono text-[var(--app-text-dim)] truncate max-w-[120px]">
                        {job.builderName}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {/* Progress Bar inside Header */}
              <div className="hidden sm:flex items-center gap-3 w-48">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-border)]">
                  <motion.div
                    className={`h-full rounded-full ${
                      isFailed ? 'bg-rose-500' :
                      isDelivered ? 'bg-lime-500' :
                      'bg-[var(--app-accent-text)]'
                    }`}
                    animate={{ width: `${effectiveProgress}%` }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </div>
                <span className={`shrink-0 text-[13px] font-mono ${
                  isFailed ? 'text-rose-400' :
                  isDelivered ? 'text-lime-400' :
                  'text-[var(--app-text-muted)]'
                }`}>
                  {effectiveProgress}%
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex shrink-0 items-center gap-3 border-l border-[color:var(--app-border)] pl-6">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-4 text-xs font-medium gap-2 border-[color:var(--app-border)] shadow-sm bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] active:scale-[0.98] transition-all"
                  onClick={onViewLogs}
                >
                  <FileText className="w-3.5 h-3.5 text-[var(--app-text-muted)]" />
                  Logs
                </Button>

                {isCancelable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-4 text-xs font-medium gap-2 border-rose-500/30 shadow-sm bg-[var(--app-surface)] text-rose-400 hover:text-rose-300 hover:border-rose-500/50 hover:bg-rose-500/10 active:scale-[0.98] transition-all"
                    onClick={() => onCancel(job)}
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Cancel
                  </Button>
                )}

                {isFailed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-4 text-xs font-medium gap-2 border-amber-500/30 shadow-sm bg-[var(--app-surface)] text-amber-400 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/10 active:scale-[0.98] transition-all"
                    onClick={onViewError || onViewLogs}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    Error Details
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Main Body (Sidebar + Content) */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar (Run Steps) */}
            <div className="w-64 shrink-0 flex flex-col border-r border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/20">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-6 py-3">
                <span className="text-xs font-mono uppercase tracking-widest text-[var(--app-text-muted)]">Run steps</span>
                <span className="text-xs font-mono text-[var(--app-text-dim)]">
                  {latestEvent ? new Date(latestEvent.timestamp).toLocaleTimeString() : 'waiting'}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {PIPELINE_STEPS.map((step, idx) => {
                  const isCompleted = idx < currentIdx || isDelivered
                  const isCurrent = idx === currentIdx && !isFailed && !isDelivered
                  const isFailedStep = isFailed && step.key === state.replace('_FAILED', '')
                  const StepIcon = step.icon
                  const duration = stepDurations[step.key]

                  return (
                    <motion.div
                      key={step.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.04 }}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        isCurrent ? 'bg-[var(--app-accent-bg)] shadow-sm' :
                        isFailedStep ? 'bg-rose-500/10' :
                        'hover:bg-[var(--app-hover-subtle)]'
                      }`}
                    >
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-lime-400" />
                        ) : isFailedStep ? (
                          <XCircle className="h-4 w-4 text-rose-400" />
                        ) : isCurrent ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[var(--app-accent-text)]" />
                        ) : (
                          <StepIcon className="h-4 w-4 text-[var(--app-text-dim)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`truncate text-sm font-medium ${
                            isCompleted ? 'text-[var(--app-text-secondary)]' :
                            isCurrent ? 'text-[var(--app-text-primary)]' :
                            isFailedStep ? 'text-rose-400' :
                            'text-[var(--app-text-dim)]'
                          }`}>
                            {step.label}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-[10px] font-mono text-[var(--app-text-dim)]">
                        {isCurrent ? (
                          <span className="text-[var(--app-accent-text)]">Running</span>
                        ) : isCompleted && duration ? (
                          <span className="text-[var(--app-text-muted)]">{formatDuration(duration)}</span>
                        ) : !isCompleted && !isFailedStep ? (
                          <span>~{AVERAGE_STEP_TIMES[step.key] || 5}s</span>
                        ) : null}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
              {/* Bottom footer metadata in sidebar */}
              <div className="mt-auto border-t border-[color:var(--app-border)] px-6 py-4">
                <div className="flex flex-col gap-2 text-[13px] font-mono text-[var(--app-text-dim)]">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 shrink-0" />
                    <LiveElapsed createdAt={job.createdAt} />
                  </span>
                  {job.generationPath && (
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <Code2 className="w-4 h-4 shrink-0" />
                      <span className="truncate">{job.generationPath}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Main Stage (Generation Evidence) */}
            <div className="flex-1 flex flex-col min-w-0 bg-[var(--app-surface)]">
              {isIntentClarification ? (
                <IntentClarificationCard job={job} onResolveIntent={onResolveIntent} />
              ) : (
                <GenerationEvidence job={job} streamEvents={streamEvents} />
              )}
              {isFailed && (
                <div className="shrink-0 p-6 border-t border-[color:var(--app-border)] bg-rose-500/5">
                  <FailureDiagnostics job={job} />
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
