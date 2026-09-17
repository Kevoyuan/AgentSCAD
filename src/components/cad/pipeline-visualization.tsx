'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PIPELINE_STEPS, ExecutionLog, parseJSON, getPipelineProgress } from './types'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

interface PipelineVisualizationProps {
  state: string
  job?: {
    executionLogs?: string | null
    createdAt: string
    updatedAt: string
    completedAt?: string | null
  }
  onStepClick?: (stepKey: string, tabName: string) => void
}

export function PipelineVisualization({ state, job, onStepClick }: PipelineVisualizationProps) {
  const currentIdx = PIPELINE_STEPS.findIndex(s => s.key === state)
  const failedStates = ['GEOMETRY_FAILED', 'RENDER_FAILED', 'VALIDATION_FAILED']
  const isFailed = failedStates.includes(state)
  const progress = getPipelineProgress(state)

  // Find which step failed: map failed states to their pipeline step keys
  const failedStepMap: Record<string, string> = {
    'GEOMETRY_FAILED': 'SCAD_GENERATED',
    'RENDER_FAILED': 'RENDERED',
    'VALIDATION_FAILED': 'VALIDATED',
  }
  const failedStepKey = isFailed ? failedStepMap[state] ?? null : null
  const failedStepIdx = failedStepKey ? PIPELINE_STEPS.findIndex(s => s.key === failedStepKey) : -1

  // Calculate step durations from execution logs
  const executionLogs = job?.executionLogs ?? null
  const stepDurations = useMemo(() => {
    if (!executionLogs) return {} as Record<string, number>
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
  }, [executionLogs])

  // Map pipeline step to inspector tab for click navigation
  const stepToTabMap: Record<string, string> = {
    'NEW': 'SPEC',
    'SCAD_GENERATED': 'CODE',
    'RENDERED': 'SPEC',
    'VALIDATED': 'VALIDATION',
    'DELIVERED': 'SPEC',
  }

  // Determine effective current index for connecting line fill
  // For failed states, fill up to (but not including) the failed step
  const effectiveCurrentIdx = isFailed ? failedStepIdx : currentIdx

  // Goal gradient acceleration: animation duration progressively decreases as idx approaches DELIVERED
  const getTransitionDuration = (idx: number) => {
    return Math.max(0.18, 0.38 - idx * 0.05)
  }

  const currentStep = PIPELINE_STEPS[Math.max(currentIdx, 0)]
  const currentLabel = isFailed
    ? `${failedStepKey?.replace(/_/g, ' ') || 'VALIDATION'} needs review`
    : state === 'DELIVERED'
      ? 'Ready'
      : currentStep?.label || 'Queued'

  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1">
      <div className="flex items-center gap-1">
        {PIPELINE_STEPS.map((step, idx) => {
          const isTerminalState = state === 'DELIVERED' || state === 'CANCELLED'
          const isCompleted = isFailed
            ? idx < failedStepIdx
            : isTerminalState
              ? idx <= currentIdx
              : idx < currentIdx
          const isCurrent = isFailed
            ? idx === failedStepIdx
            : !isTerminalState && idx === currentIdx && !isFailed
          const isFailedStep = isFailed && idx === failedStepIdx
          const Icon = step.icon
          const duration = stepDurations[step.key]
          const isClickable = onStepClick && (isCompleted || isCurrent || isFailedStep)

          // Determine connecting line color
          // Completed: blueprint indigo, Active current: partial fill, Failed: red up to failed step
          const isLineCompleted = idx < effectiveCurrentIdx
          const isLineFailed = isFailed && idx < failedStepIdx

          return (
            <div key={step.key} className="flex items-center">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.div
                      className={`relative flex h-6 w-6 items-center justify-center rounded-[6px] border transition-all duration-200 ${
                        isClickable ? 'cursor-pointer hover:bg-[var(--cad-surface-raised)]' : 'cursor-default'
                      } ${
                        isFailedStep
                          ? 'border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 text-[var(--app-danger)]'
                          : isCurrent && !isFailed
                          ? 'border-[var(--app-accent)] bg-[var(--app-accent-bg)] text-[var(--app-accent)]'
                          : isCompleted
                          ? 'border-[var(--app-success)]/30 bg-[var(--app-success)]/10 text-[var(--app-success)]'
                          : 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-dim)]'
                      }`}
                      whileHover={isClickable ? { scale: 1.05 } : undefined}
                      whileTap={isClickable ? { scale: 0.96 } : undefined}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      onClick={() => {
                        if (isClickable) {
                          onStepClick?.(step.key, stepToTabMap[step.key] || 'PARAMETERS')
                        }
                      }}
                    >
                      <div className="relative flex items-center justify-center">
                        {isFailedStep ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : isCompleted ? (
                          <motion.div
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </motion.div>
                        ) : (
                          <Icon className="h-3.5 w-3.5" />
                        )}
                        {isCurrent && !isFailed && !isCompleted && (
                          <motion.span
                            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]"
                            animate={{
                              scale: [1, 1.45, 1],
                              opacity: [1, 0.45, 1],
                            }}
                            transition={{
                              duration: Math.max(0.8, 1.3 - (currentIdx >= 0 ? currentIdx * 0.12 : 0)),
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                          />
                        )}
                      </div>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs max-w-[200px]">
                    <div className="font-mono font-semibold">{step.label}: {step.key.replace(/_/g, ' ')}</div>
                    {duration !== undefined && (
                      <div className="text-[12px] text-[var(--app-text-muted)] mt-0.5">Duration: {formatDuration(duration)}</div>
                    )}
                    {isCurrent && !isFailed && (
                      <div className="text-[12px] text-[var(--app-warning)] font-medium mt-0.5">Currently processing</div>
                    )}
                    {isFailedStep && (
                      <div className="text-[12px] text-[var(--app-danger)] font-medium mt-0.5">Validation blocked at this step</div>
                    )}
                    {isCompleted && (
                      <div className="text-[12px] text-[var(--app-success)] font-medium mt-0.5">Completed</div>
                    )}
                    {isClickable && (
                      <div className="text-[12px] text-[var(--app-text-muted)] mt-1">Click to view in inspector</div>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {idx < PIPELINE_STEPS.length - 1 && (
                <div className="relative mx-1 flex items-center">
                  <div className="h-0.5 w-3 rounded-full bg-[var(--app-border)]" />
                  <AnimatePresence>
                    {isLineCompleted && (
                      <motion.div
                        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                        style={{
                          backgroundColor: isLineFailed ? 'var(--app-danger)' : 'var(--app-accent)',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: 12 }}
                        exit={{ width: 0 }}
                        transition={{ duration: getTransitionDuration(idx), ease: 'easeOut', delay: idx * 0.04 }}
                      />
                    )}
                  </AnimatePresence>
                  {isFailed && idx === failedStepIdx - 1 && (
                    <motion.div
                      className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                      style={{ backgroundColor: 'var(--app-danger)' }}
                      initial={{ width: 0 }}
                      animate={{ width: 12 }}
                      transition={{ duration: getTransitionDuration(idx), ease: 'easeOut', delay: idx * 0.04 }}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <span className={`hidden min-w-0 truncate text-xs font-medium lg:inline ${
        isFailed ? 'text-[var(--app-danger)]' : state === 'DELIVERED' ? 'text-[var(--app-success)]' : 'text-[var(--app-text-muted)]'
      }`}>
        {currentLabel}
      </span>
      <div className="pipeline-mini-progress ml-1 w-12">
        <div
          className={`pipeline-mini-progress-fill ${
            isFailed ? 'bg-[var(--app-danger)]' :
            progress === 100 ? 'bg-[var(--app-success)]' :
            'bg-[var(--app-accent)]'
          }`}
          style={{ width: `${isFailed ? Math.max(progress - 20, 20) : progress}%` }}
        />
      </div>
    </div>
  )
}

/**
 * RunProgress: Calm, compact metrology run-state indicator designed for the streamlined App Bar.
 * Conforms to the AgentSCAD Design System: unobtrusive when idle, informative when executing.
 */
export function RunProgress({
  state,
  isProcessing,
  onClick,
}: {
  state: string
  isProcessing?: boolean
  onClick?: () => void
}) {
  const currentIdx = PIPELINE_STEPS.findIndex(s => s.key === state)
  const isFailed = ['GEOMETRY_FAILED', 'RENDER_FAILED', 'VALIDATION_FAILED'].includes(state)
  const progress = getPipelineProgress(state)
  const stepNumber = Math.max(1, currentIdx + 1)
  const totalSteps = PIPELINE_STEPS.length

  let stateLabel = 'Ready'
  let dotClass = 'bg-[var(--app-text-dim)]'
  let textClass = 'text-[var(--app-text-muted)]'
  let borderClass = 'border-[var(--app-border)]'

  if (isProcessing || ['SCAD_GENERATED', 'RENDERED', 'VALIDATED'].includes(state)) {
    stateLabel = state === 'SCAD_GENERATED' ? 'Generating geometry' :
                 state === 'RENDERED' ? 'Rendering model' :
                 state === 'VALIDATED' ? 'Validating facts' : 'Executing run'
    dotClass = 'bg-[var(--app-accent)] animate-pulse'
    textClass = 'text-[var(--app-accent-text)]'
    borderClass = 'border-[var(--app-accent-border)]'
  } else if (state === 'DELIVERED') {
    stateLabel = 'Artifacts ready'
    dotClass = 'bg-[var(--app-success)]'
    textClass = 'text-[var(--app-status-success-text)]'
    borderClass = 'border-[var(--app-status-success-border)]'
  } else if (state === 'HUMAN_REVIEW') {
    stateLabel = 'Needs review'
    dotClass = 'bg-[var(--app-warning)]'
    textClass = 'text-[var(--app-status-warning-text)]'
    borderClass = 'border-[var(--app-status-warning-border)]'
  } else if (isFailed) {
    stateLabel = 'Validation blocked'
    dotClass = 'bg-[var(--app-danger)]'
    textClass = 'text-[var(--app-status-danger-text)]'
    borderClass = 'border-[var(--app-status-danger-border)]'
  } else if (state === 'NEW') {
    stateLabel = 'Draft'
    dotClass = 'bg-[var(--app-text-dim)]'
    textClass = 'text-[var(--app-text-muted)]'
    borderClass = 'border-[var(--app-border)]'
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-[5px] border ${borderClass} bg-[var(--app-surface-raised)]/60 hover:bg-[var(--app-surface-raised)] transition-all cursor-pointer text-left`}
      title="Click to view run details"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass} shrink-0`} />
      <span className={`text-xs font-medium font-mono ${textClass}`}>
        {stateLabel}
      </span>
      {(isProcessing || (currentIdx > 0 && currentIdx < totalSteps - 1)) && (
        <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--app-border)]">
          <span className="text-[11px] font-mono text-[var(--app-text-dim)]">
            {stepNumber}/{totalSteps}
          </span>
          <div className="w-10 h-1 rounded-full bg-[var(--app-border)] overflow-hidden">
            <div
              className="h-full bg-[var(--app-accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </button>
  )
}
