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
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : isCurrent && !isFailed
                          ? 'border-[color:var(--app-accent)] bg-[var(--cad-accent-soft)] text-[var(--app-accent)] shadow-[0_0_8px_rgba(94,106,210,0.3)]'
                          : isCompleted
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-[color:var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-dim)]'
                      }`}
                      whileHover={isClickable ? { scale: 1.08 } : undefined}
                      whileTap={isClickable ? { scale: 0.95 } : undefined}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      onClick={() => {
                        if (isClickable) {
                          onStepClick?.(step.key, stepToTabMap[step.key] || 'PARAMS')
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
                      <div className="text-[13px] text-[var(--app-text-muted)] mt-0.5">Duration: {formatDuration(duration)}</div>
                    )}
                    {isCurrent && !isFailed && (
                      <div className="text-[13px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">Currently processing</div>
                    )}
                    {isFailedStep && (
                      <div className="text-[13px] text-rose-600 dark:text-rose-400 font-medium mt-0.5">Failed at this step</div>
                    )}
                    {isCompleted && (
                      <div className="text-[13px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">Completed</div>
                    )}
                    {isClickable && (
                      <div className="text-[13px] text-[var(--app-text-muted)] mt-1">Click to view in inspector</div>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {idx < PIPELINE_STEPS.length - 1 && (
                <div className="relative mx-1 flex items-center">
                  <div className="h-0.5 w-4 rounded-full bg-[var(--app-border)]" />
                  <AnimatePresence>
                    {isLineCompleted && (
                      <motion.div
                        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                        style={{
                          backgroundColor: isLineFailed ? 'var(--cad-danger)' : 'var(--app-accent)',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: 16 }}
                        exit={{ width: 0 }}
                        transition={{ duration: getTransitionDuration(idx), ease: 'easeOut', delay: idx * 0.04 }}
                      />
                    )}
                  </AnimatePresence>
                  {isFailed && idx === failedStepIdx - 1 && (
                    <motion.div
                      className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                      style={{ backgroundColor: 'var(--cad-danger)' }}
                      initial={{ width: 0 }}
                      animate={{ width: 16 }}
                      transition={{ duration: getTransitionDuration(idx), ease: 'easeOut', delay: idx * 0.04 }}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <span className={`hidden min-w-0 truncate text-[13px] font-medium lg:inline ${
        isFailed ? 'text-rose-600 dark:text-rose-400' : state === 'DELIVERED' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--app-text-muted)]'
      }`}>
        {currentLabel}
      </span>
      <div className="pipeline-mini-progress ml-1 w-14">
        <div
          className={`pipeline-mini-progress-fill ${
            isFailed ? 'bg-[var(--cad-danger)]' :
            progress === 100 ? 'bg-emerald-500' :
            'bg-[var(--app-accent)]'
          }`}
          style={{ width: `${isFailed ? Math.max(progress - 20, 20) : progress}%` }}
        />
      </div>
    </div>
  )
}
