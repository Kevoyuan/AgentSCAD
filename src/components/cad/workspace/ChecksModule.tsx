'use client'

/*
 * 检验 — DESIGN.md section 6, "Checks", and section 18, "Honesty rules".
 *
 * Conclusions first, then telemetry:
 *   1. verdict rows     结论
 *   2. outputs          产出 + revision flip-dot pair
 *   3. provenance       来源 (research / dependencies), collapsed
 *
 * Two honesty rules are enforced here rather than left to the caller:
 *   - A check that could not run (SKIP / NOT_RUN) is NOT a warning row. It is
 *     absent from the verdict list, and the module says so in one quiet line.
 *   - Colour is never the only signal: every verdict carries a word.
 */

import * as React from 'react'
import { Job, ValidationResult, getValidationEvidenceStatus, parseJSON } from '@/components/cad/types'
import { cn } from '@/lib/utils'
import { useArtifactSize, downloadArtifact } from './artifacts'
import { Verdict, OutputRow, RevCell, formatBytes, VerdictTone } from './instrument'

/** rule_name -> the words a machinist would use. Unknown rules keep their own name. */
const RULE_LABELS: Record<string, string> = {
  'OpenSCAD Compile': 'OpenSCAD 可编译',
  'Bounding Box Match': '外形尺寸符合意图',
  'Connected Components': '零件连成一体',
  'Manifold Geometry': '流形几何',
  'Minimum Wall Thickness': '最小壁厚',
  'Maximum Dimensions': '最大外形',
  'Through-Hole Count': '通孔数量',
  'Semantic Geometry Match': '几何符合描述',
  'Design Intent Preservation': '设计意图保持',
  'Visual Design Intent Match': '外观符合描述',
  'Wall Thickness': '壁厚',
  'Semantic': '语义检查',
  'Visual': '外观检查',
  'Size': '尺寸检查',
}

/** Rules that only a human or a model can decide — not a geometry failure. */
const ADVISORY_RULES = new Set(['Semantic', 'Visual', 'Semantic Geometry Match', 'Visual Design Intent Match'])

interface VerdictRow {
  key: string
  label: string
  word: string
  tone: VerdictTone
  detail: string
}

function classify(result: ValidationResult): VerdictRow {
  const status = getValidationEvidenceStatus(result)
  const label = RULE_LABELS[result.rule_name] || result.rule_name
  const detail = result.message

  if (status === 'PASS') return { key: result.rule_id, label, word: '通过', tone: 'pass', detail }
  if (status === 'WARN') return { key: result.rule_id, label, word: '注意', tone: 'warn', detail }

  // FAIL / ERROR. A critical geometry failure is a real failure; an advisory rule
  // that merely disagrees is a warning, not a red light on a manufacturable part.
  if (result.is_critical && !ADVISORY_RULES.has(result.rule_name)) {
    return { key: result.rule_id, label, word: '未通过', tone: 'fail', detail }
  }
  return { key: result.rule_id, label, word: '注意', tone: 'warn', detail }
}

export function ChecksModule({
  job,
  isProcessing,
  hasDraftChanges,
  revision,
  onOpenVersions,
  onRepair,
  onVisualRepair,
}: {
  job: Job
  isProcessing: boolean
  hasDraftChanges: boolean
  revision: number
  onOpenVersions?: () => void
  /** deterministic repair of the failing geometry */
  onRepair?: () => void
  /** the separate user-triggered VLM path */
  onVisualRepair?: () => void
}) {
  const results = React.useMemo(
    () => parseJSON<ValidationResult[]>(job.validationResults, []),
    [job.validationResults]
  )

  const { verdicts, unrun } = React.useMemo(() => {
    const verdicts: VerdictRow[] = []
    let unrun = 0
    for (const r of results) {
      const status = getValidationEvidenceStatus(r)
      if (status === 'SKIP' || status === 'NOT_RUN') {
        unrun += 1
        continue
      }
      verdicts.push(classify(r))
    }
    // Conclusions first: failures, then warnings, then passes.
    const order: Record<VerdictTone, number> = { fail: 0, warn: 1, pass: 2, mute: 3 }
    verdicts.sort((a, b) => order[a.tone] - order[b.tone])
    return { verdicts, unrun }
  }, [results])

  const passed = verdicts.filter(v => v.tone === 'pass').length
  const hasBlocker = verdicts.some(v => v.tone === 'fail')
  const stlSize = useArtifactSize(job.id, 'stl', Boolean(job.stlPath))
  const scadLines = React.useMemo(
    () => (job.scadSource ? job.scadSource.split('\n').length : null),
    [job.scadSource]
  )
  const hasScad = Boolean(job.scadSource)
  const built = Boolean(job.stlPath)

  const hintText = isProcessing
    ? '排队中'
    : results.length === 0
      ? '未检验'
      : unrun > 0
        ? `${passed} / ${verdicts.length} 通过 · ${unrun} 项未运行`
        : `${passed} / ${verdicts.length} 通过`

  return (
    <div className="px-[11px] pb-[11px]">
      {/* ── Verdicts ─────────────────────────────────────────────────────── */}
      <div className="pt-[3px]">
        {verdicts.length === 0 ? (
          <p className="py-2 text-[11.5px] text-[var(--shell-text-dim)]">
            {isProcessing ? '检验正在排队，几何渲染完成后开始。' : '还没有检验结论。生成一次后会出现在这里。'}
          </p>
        ) : (
          verdicts.map(v => (
            <Verdict key={v.key} label={v.label} word={v.word} tone={v.tone} title={v.detail} />
          ))
        )}
      </div>

      {/* A check that cannot run gets one quiet line, never an alarm row. */}
      {unrun > 0 && (
        <p className="mt-[6px] font-mono text-[9px] tracking-[0.06em] text-[var(--shell-text-dim)]">
          {unrun} 项检验未运行 · 不计入通过
        </p>
      )}

      {/* DESIGN.md section 10, "Validate": a blocked check answers what failed and
          whether the app can repair it. Repair is explicit and lives here, not as
          a second competing action on the viewport. */}
      {hasBlocker && (onRepair || onVisualRepair) && (
        <div className="mt-[9px] pt-[9px] border-t border-[color:var(--shell-hairline)]">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)] mb-[5px]">
            可以做什么
          </div>
          <div className="flex items-stretch gap-1">
            {onRepair && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={onRepair}
                className={cn(
                  'flex-1 h-[28px] rounded-[4px] border font-mono text-[10px] transition-colors',
                  isProcessing
                    ? 'opacity-40 cursor-not-allowed border-[color:var(--shell-border)] text-[var(--shell-text-dim)]'
                    : 'border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[var(--shell-border-strong)]'
                )}
                style={{ background: 'var(--shell-well)' }}
              >
                自动修复
              </button>
            )}
            {onVisualRepair && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={onVisualRepair}
                className={cn(
                  'flex-1 h-[28px] rounded-[4px] border font-mono text-[10px] transition-colors',
                  isProcessing
                    ? 'opacity-40 cursor-not-allowed border-[color:var(--shell-border)] text-[var(--shell-text-dim)]'
                    : 'border-[color:var(--shell-border)] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:border-[var(--shell-border-strong)]'
                )}
                style={{ background: 'var(--shell-well)' }}
              >
                看图修复
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Outputs ──────────────────────────────────────────────────────── */}
      <div className="mt-[10px] pt-[9px] border-t border-[color:var(--shell-hairline)]">
        <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)] mb-[3px]">
          产出
        </div>
        <OutputRow
          label="导出 STL"
          meta={stlSize ? formatBytes(stlSize) : undefined}
          disabled={!built}
          onClick={() => void downloadArtifact(job, 'stl')}
        />
        <OutputRow
          label="导出 OpenSCAD"
          meta={scadLines ? `${scadLines} 行` : undefined}
          disabled={!hasScad}
          onClick={() => void downloadArtifact(job, 'scad')}
          secondary={onOpenVersions ? { label: '记录', onClick: onOpenVersions } : undefined}
        />

        {/* ── Revision flip-dot pair ─────────────────────────────────────── */}
        <div className="flex gap-[6px] mt-[9px]">
          <RevCell
            dots={3}
            text={built ? `REV ${revision} · 已构建` : 'REV — · 无'}
            state={built ? 'built' : 'none'}
            dim={!built}
          />
          <RevCell
            dots={3}
            text={
              !built
                ? 'REV — · 待生成'
                : isProcessing
                  ? `REV ${revision + 1} · 重建中`
                  : hasDraftChanges
                    ? `REV ${revision + 1} · 待构建`
                    : `REV ${revision} · 当前`
            }
            state={built && (hasDraftChanges || isProcessing) ? 'stale' : 'none'}
            dim={!built || (!hasDraftChanges && !isProcessing)}
          />
        </div>
      </div>
    </div>
  )
}

export function checksModuleHint(job: Job, isProcessing: boolean): string {
  if (isProcessing) return '排队中'
  const results = parseJSON<ValidationResult[]>(job.validationResults, [])
  const ran = results.filter(r => {
    const s = getValidationEvidenceStatus(r)
    return s !== 'SKIP' && s !== 'NOT_RUN'
  })
  if (ran.length === 0) return '未检验'
  const passed = ran.filter(r => getValidationEvidenceStatus(r) === 'PASS').length
  return `${passed} / ${ran.length} 通过`
}
