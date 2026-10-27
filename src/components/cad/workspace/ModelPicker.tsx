'use client'

import * as React from 'react'
import { Check, ChevronDown, Cpu, Settings2 } from 'lucide-react'

import { useI18n } from '@/components/i18n-provider'
import type { Translator } from '@/lib/i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ModelInfo } from '@/components/cad/api'

/*
 * Model engine picker for the composer, per DESIGN.md sections 5 and 8.
 *
 * Section 8 says the model "defaults to the last healthy configured model", and
 * section 5 says the composer owns the primary action. Until now the engine could
 * only be chosen inside the New-part dialog, so once the inline composer started
 * creating parts directly there was no way to see or change the engine without
 * opening Settings - the choice silently fell back to a server default.
 *
 * This is a chip, not a second filled control: it sits inside the field as quiet
 * mono text, and the only filled thing on the surface is still the circular
 * action. The popover borrows the ViewCube menu's surface recipe so there is one
 * floating-panel look rather than two.
 */

/** "DeepSeek V4 Flash" from provider "DeepSeek" is just "V4 Flash" at 10px. */
function shortLabel(model: ModelInfo | undefined): string {
  if (!model) return ''
  const name = model.name.trim()
  const provider = (model.providerName || '').trim()
  if (provider && name.toLowerCase().startsWith(provider.toLowerCase())) {
    const rest = name.slice(provider.length).trim()
    if (rest) return rest
  }
  return name
}

/**
 * Where a model came from, for the case where two entries share a name.
 *
 * `/api/models` merges saved providers with environment-configured ones, so a
 * DEEPSEEK_API_KEY in the environment plus a DeepSeek key saved in Settings yields
 * two rows both reading "DeepSeek V4 Flash / DeepSeek". Picking between them is a
 * real choice - they can bill different keys - so the rows have to be tellable
 * apart. The distinction is only shown when a name actually collides, because on
 * the ordinary single-provider install the extra word is noise.
 */
function sourceOf(model: ModelInfo, t: Translator): string {
  return model.id.startsWith('provider:env-') ? t('From environment') : t('Saved in Settings')
}

/**
 * How an engine is named on screen, in one place.
 *
 * The composer chip and the part's provenance line have to agree, or the same
 * engine reads as two different things in two corners of the screen.
 *
 * An id whose model is no longer configured has NO name. The old fallback peeled
 * the last segment off the id and printed it, so a part built by
 * `provider:<uuid>:deepseek-v4-flash` showed the literal string
 * `deepseek-v4-flash` next to it - an internal identifier in the middle of the
 * workspace, which DESIGN.md section 26 forbids ("No rule id, engine name, file
 * path or compile time is visible anywhere in the UI"). A removed provider is
 * exactly the case where the id is most tempting to print and least meaningful
 * to the person reading it.
 *
 * So: unknown means unknown. The composer chip falls back to "Choose model" and
 * the part's provenance line is simply not drawn. The internal id stays in the
 * 源码 / 记录 detail sheet, where it is evidence rather than chrome.
 */
export function engineLabel(models: ModelInfo[], modelId: string | null | undefined): { label: string; full: string } | null {
  if (!modelId) return null
  const model = models.find(candidate => candidate.id === modelId)
  if (!model) return null
  return { label: shortLabel(model), full: `${model.name} · ${model.providerName}` }
}

/**
 * The rows the popover lists, with the second line already decided.
 *
 * Pure and exported so the collision rule is testable without a DOM: the popover
 * body only exists while it is open, so markup assertions can never see it.
 */
export function modelOptions(models: ModelInfo[], t: Translator): Array<{ model: ModelInfo; subtitle: string }> {
  const nameCounts = new Map<string, number>()
  for (const model of models) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
  return models.map(model => ({
    model,
    subtitle: (nameCounts.get(model.name) ?? 0) > 1
      ? `${model.providerName} · ${sourceOf(model, t)}`
      : model.providerName,
  }))
}

export function ModelPicker({
  models,
  value,
  isLoading,
  partSelected = false,
  onChange,
  onManage,
}: {
  models: ModelInfo[]
  value: string
  isLoading?: boolean
  /** A part is open, so the field describes a change rather than a new brief. */
  partSelected?: boolean
  onChange: (modelId: string) => void
  onManage: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const options = modelOptions(models, t)
  const current = options.find(option => option.model.id === value)
  const label = shortLabel(current?.model) || (isLoading ? t('Loading...') : t('Choose model'))
  const subtitle = current?.subtitle ?? ''

  /*
   * The chip always answers "what will the next build use", never "what built this
   * part" - that second question belongs to the part, and the header shows it. With
   * a part open the placeholder already says "Describe a change", so the chip has to
   * say "next" out loud or it reads as this part's engine.
   */
  const description = current
    ? partSelected
      ? t('Next build: {0}', { 0: current.model.name })
      : t('Model engine: {0}', { 0: current.model.name })
    : t('Choose a model engine')
  const tooltip = current
    ? partSelected
      ? t('Next build uses {0}', { 0: `${current.model.name} · ${subtitle}` })
      : `${current.model.name} · ${subtitle}`
    : t('Choose a model engine')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="model-picker"
          aria-label={description}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={tooltip}
          /*
           * Below 960px the field is 11 tall with a 44px action, so the chip drops
           * its label and keeps the glyph: the engine still has to be reachable on a
           * phone (that is the whole point - no trip to Settings), but a 92px word
           * would take a fifth of the 254px input and truncate the placeholder to
           * nothing. Icon-only at 36x44 keeps the touch target usable.
           */
          className="linear-focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] border border-transparent px-1.5 font-mono text-[10px] text-[var(--shell-text-muted)] transition-colors hover:border-[var(--shell-border)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] max-[959px]:h-11 max-[959px]:w-9 max-[959px]:justify-center max-[959px]:px-0"
        >
          <Cpu aria-hidden="true" className="h-3 w-3 shrink-0 opacity-70" />
          <span className="hidden max-w-[104px] truncate min-[960px]:inline">{label}</span>
          <ChevronDown aria-hidden="true" className="hidden h-2.5 w-2.5 shrink-0 opacity-60 min-[960px]:block" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[268px] rounded-[9px] border border-[var(--shell-border-strong)] p-1.5 backdrop-blur-xl"
        style={{ background: 'var(--shell-module-solid)', boxShadow: 'var(--shell-shadow)' }}
      >
        <p className="px-1.5 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--shell-text-dim)]">
          {t('Model engine')}
        </p>

        {models.length === 0 ? (
          <p className="px-1.5 py-2 text-[11px] leading-4 text-[var(--shell-text-muted)]">
            {isLoading ? t('Loading...') : t('No model configured')}
          </p>
        ) : (
          <div role="listbox" aria-label={t('Model engine')} className="max-h-[248px] overflow-y-auto">
            {options.map(({ model, subtitle: sub }) => {
              const selected = model.id === value
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-start gap-1.5 rounded-[4px] px-1.5 py-1 text-left transition-colors ${
                    selected
                      ? 'bg-[var(--shell-well)] text-[var(--shell-text)]'
                      : 'text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
                  }`}
                >
                  <Check
                    aria-hidden="true"
                    className={`mt-[3px] h-2.5 w-2.5 shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] leading-4">{model.name}</span>
                    <span className="block truncate font-mono text-[10px] leading-[1.4] text-[var(--shell-text-dim)]">
                      {sub}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="my-1 h-px bg-[var(--shell-hairline)]" />
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onManage()
          }}
          className="flex w-full items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left text-[11px] text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
        >
          <Settings2 aria-hidden="true" className="h-3 w-3 shrink-0 opacity-70" />
          {t('Manage providers…')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
