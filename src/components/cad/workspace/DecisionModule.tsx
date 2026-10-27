'use client'

import { useI18n } from '@/components/i18n-provider'
import { englishTranslator, type Translator } from '@/lib/i18n'

/*
 * 要你定一下 — the decision module, shown instead of 尺寸 while a clarification is
 * pending (DESIGN.md section 6 conditional modules; workflow states section 10).
 *
 * The question and its options come from the job's own intent result, so this is a
 * real decision surface, not an illustration.
 *
 * This module *selects*; it does not commit. DESIGN.md acceptance criterion 3 asks
 * for exactly one action to press in every state, and that action is the composer's
 * circular button (section 5: "A decision is pending → 确认并生成"). Adding a second
 * lit confirm button here is the defect the 2026-09-17 audit logged as five
 * competing entry points.
 *
 * The options are cards, not a dim text list: a selected interpretation is the one
 * fact the next composer action depends on, so it carries a signal border, a signal
 * tint, a filled radio and a check mark - four redundant signals, none of them
 * colour-only.
 */

import { Check } from 'lucide-react'
import { Job, parseJSON } from '@/components/cad/types'
import { cn } from '@/lib/utils'
import { EmptyNote } from './instrument'

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

export function readInterpretations(job: Job | null): IntentInterpretation[] {
  if (!job) return []
  const intent = parseJSON<IntentClarification>(job.intentResult, {})
  return Array.isArray(intent.interpretations) ? intent.interpretations : []
}

export function readClarificationQuestion(job: Job | null, t: Translator = englishTranslator): string {
  if (!job) return ''
  const intent = parseJSON<IntentClarification>(job.intentResult, {})
  return intent.clarificationQuestion || t("This description could mean several parts. Choose one before generating.")
}

export function DecisionModule({
  job,
  selectedId,
  onSelect,
}: {
  job: Job
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()

  const interpretations = readInterpretations(job)
  const question = readClarificationQuestion(job, t)

  return (
    <div className="px-[11px] pb-[11px]">
      <div className="pt-[3px] pb-[8px]">
        <p className="text-[13px] font-semibold leading-[1.4] text-[var(--shell-text)]">{question}</p>
        <p className="mt-[5px] text-[11px] leading-[1.45] text-[var(--shell-text-label)]">
          {t("Your choice will be added to the description. Then use the button beside the input to generate.")}
        </p>
      </div>

      {interpretations.length === 0 ? (
        <EmptyNote>{t("No interpretations available. Make the description more specific or rebuild.")}</EmptyNote>
      ) : (
        <div role="radiogroup" aria-label={question} className="flex flex-col gap-[6px]">
          {interpretations.map(option => {
            const selected = selectedId === option.id
            const detail = option.objectKind || option.domain || option.evidence?.[0]
            return (
              <div
                key={option.id}
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                tabIndex={0}
                title={detail ? `${option.label} — ${detail}` : option.label}
                onClick={() => onSelect(option.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(option.id)
                  }
                }}
                className={cn(
                  'group grid min-h-[44px] cursor-pointer grid-cols-[15px_1fr_16px] items-start gap-[9px]',
                  'rounded-[6px] border px-[10px] py-[9px] transition-colors',
                  selected
                    ? 'border-[var(--shell-signal)] bg-[color-mix(in_srgb,var(--shell-signal)_9%,transparent)]'
                    : 'border-[color:var(--shell-border)] hover:border-[var(--shell-border-strong)] hover:bg-[var(--shell-hover)]'
                )}
                style={selected ? undefined : { background: 'var(--shell-well)' }}
              >
                <i
                  className={cn(
                    'relative mt-[2px] h-[15px] w-[15px] shrink-0 rounded-full border not-italic',
                    selected ? 'border-[var(--shell-signal)]' : 'border-[var(--shell-text-dim)]'
                  )}
                  aria-hidden="true"
                >
                  {selected && (
                    <span
                      className="absolute rounded-full bg-[var(--shell-signal)]"
                      style={{ inset: 3 }}
                    />
                  )}
                </i>
                <div className="min-w-0">
                  <div
                    className={cn(
                      'text-[12px] font-semibold leading-[1.3] transition-colors',
                      selected
                        ? 'text-[var(--shell-text)]'
                        : 'text-[var(--shell-text-muted)] group-hover:text-[var(--shell-text)]'
                    )}
                  >
                    {option.label}
                  </div>
                  {detail && (
                    <div className="mt-[3px] text-[11px] leading-[1.4] text-[var(--shell-text-label)]">
                      {detail}
                    </div>
                  )}
                </div>
                <span className="mt-[1px] flex h-[16px] w-[16px] items-center justify-center" aria-hidden="true">
                  {selected && <Check className="h-[14px] w-[14px] text-[var(--shell-signal-soft)]" />}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
