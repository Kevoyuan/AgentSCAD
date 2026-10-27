'use client'

import { useI18n } from '@/components/i18n-provider'
import { englishTranslator, type Translator } from '@/lib/i18n'

/*
 * 检验 — DESIGN.md section 6, "Checks", and section 18, "Honesty rules".
 *
 * Conclusions first, then telemetry:
 *   1. recovery     可用操作 (only when a check blocks delivery)
 *   2. verdict rows 结论
 *   3. revisions    版本 (scrolls with the checks list)
 *   4. outputs      pinned footer, outside the scroll flow (see below)
 *
 * Two honesty rules are enforced here rather than left to the caller:
 *   - A check that could not run (SKIP / NOT_RUN) is NOT a warning row. It is
 *     absent from the verdict list, and the module says so in one legible line
 *     above the list, with the same count in the module badge — the old 9px note
 *     sat below the fold of the height-capped plate, so the one sentence that
 *     explains "5 / 5 passed" was the one sentence nobody could see.
 *   - Colour is never the only signal: every verdict carries a word.
 *
 * When a critical check fails, repair is a real primary action, not a dim word.
 * DESIGN.md section 10: a blocked check answers what failed, what it means and
 * whether the app can repair it. The composer keeps the only solid lit control;
 * repair takes the accent's soft form, which still reads as the action to take.
 *
 * The outputs row is `position: sticky; bottom: 0` inside the plate body, so it is
 * pinned to the plate's bottom edge while the checks list scrolls under it. The
 * 2026-10-26 1280x800 probe caught "Export STL" cut in half by the plate fold, and
 * at 1440 "Export OpenSCAD / 75 lines / History" wrapped onto two lines. One row
 * of three compact actions can do neither.
 */

import * as React from 'react'
import { ChevronRight, CheckCircle2, Eye, Info, RefreshCw, XCircle } from 'lucide-react'
import { Job, JobOutcomeSummary, ValidationResult, getValidationEvidenceStatus, parseJSON } from '@/components/cad/types'
import { fetchJobOutcomeSummary, recordJobOutcome } from '@/components/cad/api'
import { cn } from '@/lib/utils'
import { useArtifactSize, downloadArtifact } from './artifacts'
import {
  ActionButton,
  EmptyNote,
  FooterAction,
  PendingRows,
  RevCell,
  SectionHeading,
  Verdict,
  formatBytes,
  VerdictTone,
} from './instrument'
import { jobDetailsFailed, jobDetailsPending, jobHasBeenBuilt } from './job-detail-state'

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

/**
 * The delivery verdict, read from the outcome ledger.
 *
 * `accepted` and `rejected` are the only two events that say whether a task
 * really succeeded, and the UI had no way to produce them: the ledger only held
 * edits and exports, which are process signals, not verdicts. A build that is
 * never judged cannot be measured, so "did the user get what they asked for"
 * was a number the product could not produce at all.
 *
 * The ledger is append-only and a decision can be changed, so the most recent
 * decision wins and the buttons stay available to overrule it.
 */
function useJobOutcome(jobId: string, enabled: boolean) {
  const [summary, setSummary] = React.useState<JobOutcomeSummary | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!enabled) {
      setSummary(null)
      return
    }
    let cancelled = false
    fetchJobOutcomeSummary(jobId)
      .then(s => { if (!cancelled) setSummary(s) })
      .catch(() => { if (!cancelled) setSummary(null) })
    return () => { cancelled = true }
  }, [jobId, enabled])

  const decide = React.useCallback(async (kind: 'accepted' | 'rejected') => {
    setPending(true)
    try {
      const { summary: next } = await recordJobOutcome(jobId, kind)
      setSummary(next)
    } finally {
      setPending(false)
    }
  }, [jobId])

  return { summary, decide, pending }
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

  const verdicts = React.useMemo(() => {
    const rows: VerdictRow[] = []
    for (const r of results) {
      const status = getValidationEvidenceStatus(r)
      if (status === 'SKIP' || status === 'NOT_RUN') continue
      rows.push(classify(r))
    }
    // Conclusions first: failures, then warnings, then passes.
    const order: Record<VerdictTone, number> = { fail: 0, warn: 1, pass: 2, mute: 3 }
    rows.sort((a, b) => order[a.tone] - order[b.tone])
    return rows
  }, [results])

  /* The counts come from the same function the header badge uses, so the badge and
     the sentence below it can never disagree about how many checks ran. */
  const { ran, passed, failed, warned, unrun } = React.useMemo(() => summarizeChecks(job), [job])
  const hasBlocker = failed > 0
  const stlSize = useArtifactSize(job.id, 'stl', Boolean(job.stlPath))
  const scadLines = React.useMemo(
    () => (job.scadSource ? job.scadSource.split('\n').length : null),
    [job.scadSource]
  )
  const hasScad = Boolean(job.scadSource)
  const built = Boolean(job.stlPath)
  const pendingRevision = built && (hasDraftChanges || isProcessing)

  // A part can be judged once it exists and nothing blocks it. Judging a broken
  // part would record a verdict on geometry that is known to be wrong.
  const canJudge = built && !hasBlocker && !isProcessing
  const { summary, decide, pending } = useJobOutcome(job.id, canJudge)
  const decision = summary?.latestDecision?.kind ?? null

  return (
    <div className="px-[11px]">
      {/* ── Recovery ─────────────────────────────────────────────────────── */}
      {/* DESIGN.md section 10, "Validate". Keep this above the verdict list: the
          plate is height-capped and scrollable, so a bottom action block would be
          invisible until the user discovers the scroll area - the exact defect the
          2026-09-26 audit found in the failed-check flow. */}
      {hasBlocker && (onRepair || onVisualRepair) && (
        <div className="pt-[2px] pb-[9px] border-b border-[color:var(--shell-hairline)]">
          <div className="mb-[6px] flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
              {t("Available actions")}
            </span>
            <span className="font-mono text-[10px] tracking-[0.05em] text-[var(--shell-fail)]">
              {t("{0} failed", { 0: failed })}
            </span>
          </div>
          <div className="flex flex-col gap-[6px]">
            {onRepair && (
              <ActionButton
                variant="primary"
                disabled={isProcessing}
                onClick={onRepair}
                title={t(
                  "Automatic repair — rebuilds the failing geometry from the check results, then re-runs every check."
                )}
                icon={<RefreshCw className="h-[14px] w-[14px]" aria-hidden="true" />}
              >
                {t("Automatic repair")}
              </ActionButton>
            )}
            {onVisualRepair && (
              <ActionButton
                variant="secondary"
                disabled={isProcessing}
                onClick={onVisualRepair}
                title={t(
                  "Visual repair — sends the rendered part to the vision model for a visual review and a repair."
                )}
                icon={<Eye className="h-[14px] w-[14px]" aria-hidden="true" />}
              >
                {t("Visual repair")}
              </ActionButton>
            )}
          </div>
          <p className="mt-[7px] text-[11px] leading-[1.45] text-[var(--shell-text-label)]">
            {onRepair
              ? t("Rebuilds the failing geometry, then re-runs every check.")
              : t("Asks the vision model to review the render, then rebuilds the part.")}
          </p>
        </div>
      )}

      {/* ── Delivery verdict ────────────────────────────────────────────── */}
      {/* 检验 means inspection, and an inspection ends in a verdict. Until this
          existed the only way to express "this part is fine" was to export it,
          which the ledger records as a process signal rather than a decision -
          so the product had no way to know whether a generation had succeeded. */}
      {canJudge && (
        <div className="pt-[2px] pb-[9px] border-b border-[color:var(--shell-hairline)]">
          <div className="mb-[6px] flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
              {t("Delivery verdict")}
            </span>
            {decision && (
              <span className="font-mono text-[10px] tracking-[0.05em] text-[var(--shell-text-muted)]">
                {decision === 'accepted' ? t("Accepted") : t("Rejected")}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-[6px]">
            <ActionButton
              variant="primary"
              disabled={pending}
              onClick={() => void decide('accepted')}
              title={t("Accept this part — records that the generated geometry is what you asked for.")}
              icon={<CheckCircle2 className="h-[14px] w-[14px]" aria-hidden="true" />}
            >
              {decision === 'accepted' ? t("Accepted") : t("Accept this part")}
            </ActionButton>
            <ActionButton
              variant="secondary"
              disabled={pending}
              onClick={() => void decide('rejected')}
              title={t("Mark this part as not usable — records that the generation missed the request.")}
              icon={<XCircle className="h-[14px] w-[14px]" aria-hidden="true" />}
            >
              {decision === 'rejected' ? t("Rejected") : t("This part is not right")}
            </ActionButton>
          </div>
        </div>
      )}

      {/* ── Verdicts ─────────────────────────────────────────────────────── */}
      <div className="pt-[6px]">
        {verdicts.length === 0 ? (
          /* Three facts, one of which deserves a sentence. While the record is
             still in flight the module shows the shape of the verdict list and
             says nothing at all — the old text ("No check results yet. Generate
             a part to see them here.") was false for every part the user had
             already generated, and it appeared for one to two seconds on every
             part they opened. */
          jobDetailsPending(job) ? (
            <div className="pb-[9px]">
              <PendingRows rows={3} label={t("Loading check results…")} />
            </div>
          ) : (
            <EmptyNote>
              {isProcessing
                ? t("Checks are queued and will start after rendering.")
                : jobDetailsFailed(job)
                ? t("Could not load this part's check results.")
                : jobHasBeenBuilt(job)
                ? t("No checks were run on this part.")
                : t("No check results yet. Generate a part to see them here.")}
            </EmptyNote>
          )
        ) : (
          <>
            {/* One sentence, one denominator.
                The plate used to print "5 / 7 passed" in the header badge, then
                "5 / 7 passed + 1 failed" again in the body, then "3 checks not run ·
                excluded from passes" underneath. 5 + 1 + 3 = 9 against a denominator
                of 7: every number was right (7 = checks that ran) and the layout made
                the module look broken, in the one plate whose job is to be trusted.
                The sentence now names every bucket of the ran set; unrun is its own
                line and never shares a denominator with it. */}
            <div className="pb-[3px] text-[12px] leading-[1.5] text-[var(--shell-text-muted)]">
              {t("{0} checks ran", { 0: ran })}
              <span className="text-[var(--shell-text-label)]"> · </span>
              {t("{0} passed", { 0: passed })}
              {failed > 0 && (
                <>
                  <span className="text-[var(--shell-text-label)]"> · </span>
                  <span className="text-[var(--shell-fail)]">{t("{0} failed", { 0: failed })}</span>
                </>
              )}
              {warned > 0 && (
                <>
                  <span className="text-[var(--shell-text-label)]"> · </span>
                  <span className="text-[var(--shell-warn)]">{t("{0} to review", { 0: warned })}</span>
                </>
              )}
            </div>

            {/* A check that cannot run gets one legible line, never an alarm row.
                Above the list: below it, the height cap hid the sentence that
                explains why the pass count is smaller than the evidence list. */}
            {unrun > 0 && (
              <p
                className="flex items-start gap-[5px] pb-[4px] text-[11px] leading-[1.4] text-[var(--shell-text-label)]"
                title={t(
                  "These checks were skipped or could not run, so they are not part of the counts above. They are not warnings either."
                )}
              >
                <Info className="mt-[1px] h-3 w-3 shrink-0 text-[var(--shell-text-dim)]" aria-hidden="true" />
                <span>{t("{0} checks could not run", { 0: unrun })}</span>
              </p>
            )}

            {verdicts.map(v => (
              <Verdict key={v.key} label={t(v.label)} word={t(v.word)} tone={v.tone} title={v.detail} />
            ))}
          </>
        )}
      </div>

      {/* ── Revisions ────────────────────────────────────────────────────── */}
      <div className="mt-[4px]">
        <SectionHeading meta={!built || pendingRevision ? undefined : t("No unbuilt edits")}>
          {t("Revisions")}
        </SectionHeading>

        {!built ? (
          <div
            className="mb-[11px] rounded-[4px] border border-dashed border-[color:var(--shell-border)] px-[9px] py-[8px]"
            style={{ background: 'var(--shell-well)' }}
          >
            <p className="text-[11px] leading-[1.4] text-[var(--shell-text-label)]">
              {isProcessing
                ? t("Building the first revision…")
                : t("No revision yet. The first successful build creates REV 1.")}
            </p>
          </div>
        ) : pendingRevision ? (
          <div className="mb-[11px] flex gap-[6px]">
            <RevCell
              dots={Math.min(3, revision)}
              text={t("REV {0} · Built", { 0: revision })}
              state="built"
            />
            <RevCell
              dots={0}
              text={
                isProcessing
                  ? t("REV {0} · Rebuilding", { 0: revision + 1 })
                  : t("REV {0} · Pending build", { 0: revision + 1 })
              }
              state="stale"
            />
          </div>
        ) : (
          <div className="mb-[11px]">
            <RevCell dots={Math.min(3, revision)} text={t("REV {0} · Built", { 0: revision })} state="built" />
          </div>
        )}
      </div>

      {/* ── Outputs: pinned footer ───────────────────────────────────────── */}
      {/* One row, three equal actions, no wrapping and no mid-button cut by the
          plate fold. Sticky keeps it at the bottom edge of the body scrollport, so
          the checks list scrolls under it instead of pushing it out of view. */}
      <div
        className="sticky bottom-0 z-10 -mx-[11px] mt-auto border-t border-[color:var(--shell-hairline)] px-[11px] pb-[9px] pt-[6px]"
        style={{ background: 'var(--shell-module-solid)' }}
        data-testid="checks-outputs"
      >
        <div className="grid grid-cols-3 gap-[5px]">
          <FooterAction
            label="STL"
            meta={stlSize ? formatBytes(stlSize) : '—'}
            disabled={!built}
            onClick={() => void downloadArtifact(job, 'stl', t)}
            title={t("Export STL")}
          />
          <FooterAction
            label="SCAD"
            meta={scadLines ? t("{0} ln", { 0: scadLines }) : '—'}
            disabled={!hasScad}
            onClick={() => void downloadArtifact(job, 'scad', t)}
            title={hasScad && scadLines ? t("Export OpenSCAD — {0} lines", { 0: scadLines }) : t("Export OpenSCAD")}
          />
          <FooterAction
            label={t("History")}
            disabled={!onOpenVersions}
            onClick={onOpenVersions}
            title={t("Open revision history")}
          />
        </div>
      </div>
    </div>
  )
}

/*
 * The module badge in MainWorkspace's header. It must agree with the rows below it:
 * same evidence status function and same "ran" denominator. It stays SHORT - the
 * plate title is a fixed word and must never be pushed into an ellipsis by a badge.
 * The skipped count is explained in the body notice instead.
 */
export function summarizeChecks(job: Job): {
  ran: number
  passed: number
  failed: number
  warned: number
  unrun: number
} {
  const results = parseJSON<ValidationResult[]>(job.validationResults, [])
  let ran = 0
  let passed = 0
  let failed = 0
  let warned = 0
  let unrun = 0
  for (const r of results) {
    const status = getValidationEvidenceStatus(r)
    if (status === 'SKIP' || status === 'NOT_RUN') {
      unrun += 1
      continue
    }
    ran += 1
    const tone = classify(r).tone
    if (tone === 'pass') passed += 1
    else if (tone === 'fail') failed += 1
    else if (tone === 'warn') warned += 1
  }
  return { ran, passed, failed, warned, unrun }
}

/**
 * The module badge: a status word, never a count.
 *
 * "5 / 7 passed" in a 262px title bar was the header of a module whose body then
 * repeated the same fraction next to a different denominator ("3 checks not run").
 * A verdict is a word - passed, failed, needs review - and the numbers belong in
 * the one sentence inside the plate, where there is room to name each bucket.
 */
export function checksModuleHint(job: Job, isProcessing: boolean, t: Translator = englishTranslator): string {
  if (jobDetailsPending(job)) return t("Loading…")
  if (isProcessing) return t("Queued")
  const { ran, failed, warned } = summarizeChecks(job)
  if (ran === 0) return t("Not checked")
  if (failed > 0) return t("Failed")
  if (warned > 0) return t("Needs review")
  return t("Passed")
}
