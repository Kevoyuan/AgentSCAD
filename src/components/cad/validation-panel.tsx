'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Job, ValidationResult, parseJSON } from './types'
import { CadExportChecklist } from './cad-primitives'
import { fadeInUp, fadeInUpTransition, staggerContainer, staggerChild, staggerTransition } from './motion-presets'

export function ValidationPanel({ job }: { job: Job }) {
  const results = parseJSON<ValidationResult[]>(job.validationResults, [])
  if (results.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-dim)] gap-3 p-6">
      <div className="w-12 h-12 rounded-xl bg-[var(--app-empty-bg)] flex items-center justify-center">
        <Shield className="w-6 h-6 opacity-30" />
      </div>
      <p className="text-sm">No validation results</p>
    </div>
  )

  const isSkipped = (result: ValidationResult) => result.message.toLowerCase().startsWith('skipped')
  const actionableResults = results.filter(r => !isSkipped(r))
  const skipped = results.length - actionableResults.length
  const passed = actionableResults.filter(r => r.passed).length
  const failed = actionableResults.filter(r => !r.passed).length
  const score = actionableResults.length > 0 ? Math.round((passed / actionableResults.length) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)]">
        <h3 className="text-eyebrow text-[var(--app-text-muted)]">Validation</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-8 h-1.5 rounded-full bg-[var(--app-surface-raised)] overflow-hidden">
              <div className={`h-full rounded-full transition-all ${score === 100 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-xs font-mono text-[var(--app-text-muted)]">{score}%</span>
          </div>
          <Badge variant="outline" className="text-xs h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{passed}✓</Badge>
          {failed > 0 && <Badge variant="outline" className="text-xs h-4 bg-rose-500/10 text-rose-400 border-rose-500/20">{failed}✗</Badge>}
          {skipped > 0 && <Badge variant="outline" className="text-xs h-4 bg-amber-500/10 text-amber-400 border-amber-500/20">{skipped} skipped</Badge>}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <motion.div
          className="p-2 space-y-1"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <CadExportChecklist job={job} />
          {results.map((r, i) => (
            <motion.div
              key={i}
              variants={staggerChild}
              transition={staggerTransition}
              className={`flex items-start gap-2 p-2.5 rounded-lg linear-transition ${
                isSkipped(r)
                  ? 'bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10'
                  : r.passed
                  ? 'bg-[var(--app-surface)] hover:bg-[var(--app-surface-hover)]'
                  : 'bg-rose-500/5 border border-rose-500/10 hover:bg-rose-500/10'
              }`}
            >
              {isSkipped(r)
                ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                : r.passed
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-[var(--app-text-dim)] bg-[var(--app-surface-raised)] px-1 rounded">{r.rule_id}</span>
                  <span className="text-xs text-[var(--app-text-secondary)]">{r.rule_name}</span>
                  {r.is_critical && (
                    <span className="flex items-center gap-0.5 text-[8px] text-amber-500">
                      <AlertTriangle className="w-2.5 h-2.5" />CRITICAL
                    </span>
                  )}
                  {isSkipped(r) && (
                    <span className="flex items-center gap-0.5 text-[8px] text-amber-500">
                      SKIPPED
                    </span>
                  )}
                  <Badge variant="outline" className="text-[8px] h-3 px-1 border-[color:var(--app-border)] text-[var(--app-text-muted)]">{r.level}</Badge>
                </div>
                <p className="text-sm text-[var(--app-text-muted)] mt-0.5">{r.message}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </ScrollArea>
    </div>
  )
}
