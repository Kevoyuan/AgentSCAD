'use client'

import * as React from 'react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Shield,
  Layers,
  Wrench,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Job, ValidationResult, getValidationEvidenceStatus, parseJSON } from './types'

interface ValidationPanelProps {
  job: Job
  onRepair?: (job: Job) => void
}

export function ValidationPanel({ job, onRepair }: ValidationPanelProps) {
  const [showAllPassed, setShowAllPassed] = useState(false)
  const results = parseJSON<ValidationResult[]>(job.validationResults, [])

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-dim)] gap-3 p-6">
        <div className="w-12 h-12 rounded-xl bg-[var(--app-empty-bg)] flex items-center justify-center">
          <Shield className="w-6 h-6 opacity-30" />
        </div>
        <p className="text-sm">No validation results</p>
      </div>
    )
  }

  // 1. 三层清晰架构分类：Blockers / Warnings / Facts
  const blockers: ValidationResult[] = []
  const warnings: ValidationResult[] = []
  const passedFacts: ValidationResult[] = []

  for (const r of results) {
    const status = getValidationEvidenceStatus(r)
    if (r.is_critical && (status === 'FAIL' || status === 'ERROR')) {
      blockers.push(r)
    } else if (status === 'WARN' || (!r.is_critical && (status === 'FAIL' || status === 'ERROR')) || ['SKIP', 'NOT_RUN'].includes(status)) {
      warnings.push(r)
    } else if (status === 'PASS') {
      passedFacts.push(r)
    } else {
      warnings.push(r)
    }
  }

  // 2. 统计度量
  const statuses = results.map(getValidationEvidenceStatus)
  const actionable = statuses.filter(status => ['PASS', 'WARN', 'FAIL'].includes(status))
  const passed = statuses.filter(status => status === 'PASS').length
  const warningsCount = statuses.filter(status => status === 'WARN').length
  const unresolved = statuses.filter(status => ['SKIP', 'ERROR', 'NOT_RUN'].includes(status)).length
  const evidenceComplete = unresolved === 0
  const score = actionable.length > 0
    ? Math.round((passed + warningsCount * 0.5) / actionable.length * 100)
    : 0

  // 3. 几何与遥测指标事实
  const renderLog = parseJSON<{ render_time_ms?: number; stl_triangles?: number; openscad_version?: string } | null>(
    job.renderLog,
    null
  )

  let bboxText = 'Pending'
  try {
    const p = parseJSON<Record<string, number>>(job.parameterValues, {})
    const dims = [
      p.width ?? p.phone_width ?? p.length ?? p.outer_diameter ?? p.diameter,
      p.depth ?? p.phone_length ?? p.width ?? p.thickness,
      p.height ?? p.phone_thickness ?? p.thickness,
    ].filter(v => typeof v === 'number')
    if (dims.length) bboxText = `${dims.join(' × ')} mm`
  } catch {}

  const r003 = results.find(r => r.rule_id === 'R003')
  const isWatertight = r003 ? r003.passed : true

  const displayedPassed = showAllPassed ? passedFacts : passedFacts.slice(0, 5)

  return (
    <div className="flex flex-col h-full bg-[var(--app-surface)]">
      {/* 质检综合看板与工程结论指示 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-eyebrow text-[var(--app-text-muted)] font-mono text-[10px] uppercase tracking-wider">MANUFACTURING AUDIT</span>
          {blockers.length === 0 ? (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Ready to export</span>
            </span>
          ) : (
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Validation blocked</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs font-mono tabular-nums text-[var(--app-text-muted)]"
              title="Score across checks that produced actionable evidence"
            >
              {score}%
            </span>
          </div>

          <div className="flex items-center gap-1 font-mono text-xs">
            {blockers.length > 0 && (
              <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 gap-1 h-5 rounded-[4px]">
                <ShieldAlert className="w-3 h-3" />
                <span className="tabular-nums">{blockers.length}</span> BLOCKERS
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1 h-5 rounded-[4px]">
                <AlertTriangle className="w-3 h-3" />
                <span className="tabular-nums">{warnings.length}</span> WARN
              </Badge>
            )}
            {blockers.length === 0 && (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1 h-5 rounded-[4px]">
                <ShieldCheck className="w-3 h-3" />
                PRINTABLE
              </Badge>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* SECTION 1: BLOCKERS (致命阻塞) */}
          {blockers.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                <span className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Critical Blockers (<span className="tabular-nums">{blockers.length}</span>)
                </span>
                {onRepair && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] gap-1 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 active:scale-[0.98]"
                    onClick={() => onRepair(job)}
                  >
                    <Wrench className="w-3 h-3" />
                    Auto Repair
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                {blockers.map((b) => (
                  <div
                    key={b.rule_id}
                    className="p-2.5 rounded-[6px] border border-rose-500/30 bg-rose-500/[0.06] text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-rose-700 dark:text-rose-300">
                        {b.rule_id} · {b.rule_name}
                      </span>
                      <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400 uppercase tracking-wider font-semibold">
                        BLOCKER
                      </span>
                    </div>
                    <p className="text-[13px] text-[var(--app-text-secondary)] leading-relaxed">
                      {b.message}
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-rose-500/30 text-rose-600 dark:text-rose-400 font-mono">
                        {b.level}
                      </Badge>
                      {b.status && (
                        <span className="text-[10px] font-mono text-rose-500">
                          {b.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 2: WARNINGS (制造审查与建议) */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-amber-600 dark:text-amber-400 uppercase tracking-wider font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                Process Warnings & Reviews (<span className="tabular-nums">{warnings.length}</span>)
              </div>
              <div className="space-y-1.5">
                {warnings.map((w) => {
                  const status = getValidationEvidenceStatus(w)
                  return (
                    <div
                      key={w.rule_id}
                      className="p-2.5 rounded-[6px] border border-amber-500/25 bg-amber-500/[0.04] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-amber-700 dark:text-amber-300">
                          {w.rule_id} · {w.rule_name}
                        </span>
                        <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 uppercase">
                          {status || w.status || 'WARN'}
                        </span>
                      </div>
                      <p className="text-[13px] text-[var(--app-text-muted)] leading-relaxed">
                        {w.message}
                      </p>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/30 text-amber-600 dark:text-amber-400 font-mono">
                          {w.level}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* SECTION 3: FACTS (客观几何指标事实) */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-mono text-[var(--app-text-muted)] uppercase tracking-wider font-semibold">
              <Layers className="w-3.5 h-3.5" />
              Geometric Facts & Telemetry
            </div>

            {/* 精密数据度量网格 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/40">
                <span className="text-[10px] font-mono text-[var(--app-text-dim)] uppercase block">Bounding Box</span>
                <span className="text-xs font-mono tabular-nums text-[var(--app-text-primary)] font-medium block truncate">
                  {bboxText}
                </span>
              </div>
              <div className="p-2 rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/40">
                <span className="text-[10px] font-mono text-[var(--app-text-dim)] uppercase block">Triangles</span>
                <span className="text-xs font-mono tabular-nums text-[var(--app-text-primary)] font-medium block">
                  {renderLog?.stl_triangles ? renderLog.stl_triangles.toLocaleString() : 'Procedural'}
                </span>
              </div>
              <div className="p-2 rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/40">
                <span className="text-[10px] font-mono text-[var(--app-text-dim)] uppercase block">Compile Time</span>
                <span className="text-xs font-mono tabular-nums text-[var(--app-text-primary)] font-medium block">
                  {renderLog?.render_time_ms ? `${renderLog.render_time_ms} ms` : 'Cached'}
                </span>
              </div>
              <div className="p-2 rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface-raised)]/40">
                <span className="text-[10px] font-mono text-[var(--app-text-dim)] uppercase block">Watertight Mesh</span>
                <span className="text-xs font-mono font-medium flex items-center gap-1">
                  {isWatertight ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Non-manifold
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* 通过规则紧凑列表与折叠控制 */}
            {passedFacts.length > 0 && (
              <div className="pt-1.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-[var(--app-text-dim)] uppercase">
                    Verified Rules (<span className="tabular-nums">{passedFacts.length}</span>)
                  </span>
                  {passedFacts.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setShowAllPassed(!showAllPassed)}
                      className="text-[11px] font-mono text-[var(--app-accent)] hover:underline flex items-center gap-0.5"
                    >
                      {showAllPassed ? (
                        <>Show less <ChevronUp className="w-3 h-3" /></>
                      ) : (
                        <>View all ({passedFacts.length}) <ChevronDown className="w-3 h-3" /></>
                      )}
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {displayedPassed.map((p) => (
                    <div
                      key={p.rule_id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-[4px] bg-[var(--app-surface-raised)]/20 border border-[color:var(--app-border)]/50 text-xs"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="font-mono text-[var(--app-text-secondary)] truncate">
                          {p.rule_id} · {p.rule_name}
                        </span>
                      </div>
                      <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-mono shrink-0 ml-2">
                        PASS
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
