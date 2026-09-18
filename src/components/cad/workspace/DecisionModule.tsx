'use client'

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
 */

import { Job, parseJSON } from '@/components/cad/types'
import { cn } from '@/lib/utils'

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

export function readClarificationQuestion(job: Job | null): string {
  if (!job) return ''
  const intent = parseJSON<IntentClarification>(job.intentResult, {})
  return intent.clarificationQuestion || '这句话可以理解成几种零件，选一个再生成。'
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
  const interpretations = readInterpretations(job)
  const question = readClarificationQuestion(job)

  return (
    <div className="px-[11px] pb-[11px]">
      <div className="pt-[3px] pb-[9px]">
        <p className="text-[12.5px] font-semibold leading-[1.4] text-[var(--shell-text)]">{question}</p>
        <p className="mt-[5px] font-mono text-[9px] leading-[1.5] text-[var(--shell-text-dim)]">
          选中的解释会记进描述，然后按输入框右边的按钮生成
        </p>
      </div>

      {interpretations.length === 0 ? (
        <p className="py-2 text-[11.5px] text-[var(--shell-text-dim)]">
          这次没有可选的解释。改成更具体的描述，或者重建一次。
        </p>
      ) : (
        <div>
          {interpretations.map(option => (
            <div
              key={option.id}
              role="radio"
              aria-checked={selectedId === option.id}
              tabIndex={0}
              onClick={() => onSelect(option.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(option.id)
                }
              }}
              className={cn(
                'grid grid-cols-[13px_1fr] gap-[9px] items-start py-[10px] cursor-pointer',
                'border-b border-[color:var(--shell-hairline)] last:border-b-0 last:pb-[2px] group'
              )}
            >
              <i
                className={cn(
                  'w-3 h-3 rounded-full border mt-[2px] relative not-italic shrink-0',
                  selectedId === option.id ? 'border-[var(--shell-signal)]' : 'border-[var(--shell-text-dim)]'
                )}
              >
                {selectedId === option.id && (
                  <span className="absolute rounded-full bg-[var(--shell-signal)]" style={{ inset: 2 }} />
                )}
              </i>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold leading-[1.3] text-[var(--shell-text)] group-hover:text-[var(--shell-signal-soft)] transition-colors">
                  {option.label}
                </div>
                {(option.objectKind || option.domain || option.evidence?.[0]) && (
                  <div className="mt-[4px] font-mono text-[9px] leading-[1.45] text-[var(--shell-text-dim)]">
                    {option.objectKind || option.domain || option.evidence?.[0]}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
