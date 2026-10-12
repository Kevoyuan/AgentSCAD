'use client'

import { useI18n } from '@/components/i18n-provider'
import { englishTranslator, type Translator } from '@/lib/i18n'

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
  'OpenSCAD Compile': "OpenSCAD compiles",
  'Bounding Box Match': "Dimensions match intent",
  'Connected Components': "Connected part",
  'Manifold Geometry': "Manifold geometry",
  'Minimum Wall Thickness': "Minimum wall thickness",
  'Maximum Dimensions': "Maximum dimensions",
  'Through-Hole Count': "Through-hole count",
  'Semantic Geometry Match': "Geometry matches description",
  'Design Intent Preservation': "Design intent preserved",
  'Visual Design Intent Match': "Appearance matches description",
  'Wall Thickness': "Wall thickness",
  'Semantic': "Semantic check",
  'Visual': "Visual check",
  'Size': "Dimension check",
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

  if (status === 'PASS') return { key: result.rule_id, label, word: "Pass", tone: 'pass', detail }
  if (status === 'WARN') return { key: result.rule_id, label, word: "Review", tone: 'warn', detail }

  // FAIL / ERROR. A critical geometry failure is a real failure; an advisory rule
  // that merely disagrees is a warning, not a red light on a manufacturable part.
  if (result.is_critical && !ADVISORY_RULES.has(result.rule_name)) {
    return { key: result.rule_id, label, word: "Fail", tone: 'fail', detail }
  }
  return { key: result.rule_id, label, word: "Review", tone: 'warn', detail }
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
  const { t } = useI18n()

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
    ? t("Queued")
    : results.length === 0
      ? t("Not checked")
      : unrun > 0
        ? t("{0} / {1} passed · {2} not run", { 0: passed, 1: verdicts.length, 2: unrun })
        : t("{0} / {1} passed", { 0: passed, 1: verdicts.length })

  return (
    <div className="px-[11px] pb-[11px]">
      {/* ── Verdicts ─────────────────────────────────────────────────────── */}
      <div className="pt-[3px]">
        {verdicts.length === 0 ? (
          <p className="py-2 text-[11.5px] text-[var(--shell-text-dim)]">
            {isProcessing ? t("Checks are queued and will start after rendering.") : t("No check results yet. Generate a part to see them here.")}
          </p>
        ) : (
          verdicts.map(v => (
            <Verdict key={v.key} label={t(v.label)} word={t(v.word)} tone={v.tone} title={v.detail} />
          ))
        )}
      </div>

      {/* A check that cannot run gets one quiet line, never an alarm row. */}
      {unrun > 0 && (
        <p className="mt-[6px] font-mono text-[9px] tracking-[0.06em] text-[var(--shell-text-dim)]">
          {unrun} {t("checks not run · excluded from passes")}
        </p>
      )}

      {/* DESIGN.md section 10, "Validate": a blocked check answers what failed and
          whether the app can repair it. Repair is explicit and lives here, not as
          a second competing action on the viewport. */}
      {hasBlocker && (onRepair || onVisualRepair) && (
        <div className="mt-[9px] pt-[9px] border-t border-[color:var(--shell-hairline)]">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)] mb-[5px]">
            {t("Available actions")}
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
                {t("Automatic repair")}
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
                {t("Visual repair")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Outputs ──────────────────────────────────────────────────────── */}
      <div className="mt-[10px] pt-[9px] border-t border-[color:var(--shell-hairline)]">
        <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)] mb-[3px]">
          {t("Outputs")}
        </div>
        <OutputRow
          label={t("Export STL")}
          meta={stlSize ? formatBytes(stlSize) : undefined}
          disabled={!built}
          onClick={() => void downloadArtifact(job, 'stl', t)}
        />
        <OutputRow
          label={t("Export OpenSCAD")}
          meta={scadLines ? t("{0} lines", { 0: scadLines }) : undefined}
          disabled={!hasScad}
          onClick={() => void downloadArtifact(job, 'scad', t)}
          secondary={onOpenVersions ? { label: t("History"), onClick: onOpenVersions } : undefined}
        />

        {/* ── Revision flip-dot pair ─────────────────────────────────────── */}
        <div className="flex gap-[6px] mt-[9px]">
          <RevCell
            dots={3}
            text={built ? t("REV {0} · Built", { 0: revision }) : t("REV — · None")}
            state={built ? 'built' : 'none'}
            dim={!built}
          />
          <RevCell
            dots={3}
            text={
              !built
                ? t("REV — · Awaiting generation")
                : isProcessing
                  ? t("REV {0} · Rebuilding", { 0: revision + 1 })
                  : hasDraftChanges
                    ? t("REV {0} · Awaiting build", { 0: revision + 1 })
                    : t("REV {0} · Current", { 0: revision })
            }
            state={built && (hasDraftChanges || isProcessing) ? 'stale' : 'none'}
            dim={!built || (!hasDraftChanges && !isProcessing)}
          />
        </div>
      </div>
    </div>
  )
}

export function checksModuleHint(job: Job, isProcessing: boolean, t: Translator = englishTranslator): string {
  if (isProcessing) return t("Queued")
  const results = parseJSON<ValidationResult[]>(job.validationResults, [])
  const ran = results.filter(r => {
    const s = getValidationEvidenceStatus(r)
    return s !== 'SKIP' && s !== 'NOT_RUN'
  })
  if (ran.length === 0) return t("Not checked")
  const passed = ran.filter(r => getValidationEvidenceStatus(r) === 'PASS').length
  return t("{0} / {1} passed", { 0: passed, 1: ran.length })
}
