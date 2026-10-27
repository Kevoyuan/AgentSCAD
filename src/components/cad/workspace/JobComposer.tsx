'use client'

import { useI18n } from '@/components/i18n-provider'

import { useEffect, useMemo, useState } from 'react'
import {
  Play, Loader2, Sparkles, Tag, Ruler, Hammer, BoxSelect, Gauge, Cpu, Clock, X, Wand2, LayoutTemplate, SlidersHorizontal, Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

import { JobTemplateCards } from '@/components/cad/job-templates'
import { CaseMemory } from '@/components/cad/case-memory'
import { TagBadges, buildCustomerId } from '@/components/cad/tag-badges'
import { fetchModels, type ModelInfo } from '@/components/cad/api'

// Sample prompt for immediate first-time exploration. Same voice and family as the
// examples the empty canvas offers (DESIGN.md section 9).
const EXAMPLE_PROMPT = "Camera bracket for a 35 mm DIN rail, M4 screw holes, 3 mm walls" as const

/* DESIGN.md section 14: focus-visible is the signal accent, never a browser outline.
   `linear-focus-ring` is the shell's one focus ring (a 2px signal halo at 45%). */
const FOCUS = 'linear-focus-ring outline-none'
/* Suggestion chips are controls, not links: one shared recipe keeps the 28px target,
   the 10.5px mono label and the selected treatment identical across the four groups. */
const CHIP_BASE = `inline-flex min-h-7 items-center justify-center rounded-[4px] border px-2 py-1 text-left font-mono text-[11px] leading-4 transition-colors ${FOCUS}`

export function JobComposer({
  showComposer,
  providerRevision,
  newJobText,
  newJobModelId,
  newJobTags,
  isCreating,
  isAiEnhancing,
  recentRequests,
  onShowComposerChange,
  onNewJobTextChange,
  onNewJobModelIdChange,
  onNewJobTagsChange,
  onCreate,
  onAiEnhance,
  onAddProvider,
}: {
  showComposer: boolean
  providerRevision: number
  newJobText: string
  newJobModelId: string
  newJobTags: string
  isCreating: boolean
  isAiEnhancing: boolean
  recentRequests: string[]
  onShowComposerChange: (open: boolean) => void
  onNewJobTextChange: (text: string) => void
  onNewJobModelIdChange: (modelId: string) => void
  onNewJobTagsChange: (tags: string) => void
  onCreate: () => void
  onAiEnhance: () => void
  onAddProvider: () => void
}) {
  const { t } = useI18n()

  const [generationModels, setGenerationModels] = useState<Array<Pick<ModelInfo, 'id' | 'name' | 'providerName' | 'description'>>>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const [activeAssistantTab, setActiveAssistantTab] = useState<'modifiers' | 'templates' | 'recent'>('modifiers')

  useEffect(() => {
    if (!showComposer) return

    let cancelled = false
    fetchModels()
      .then(data => {
        if (cancelled) return
        const configured = data.models.slice(0, 9)
        setGenerationModels(configured)
        if (configured.length > 0 && !configured.some(model => model.id === newJobModelId)) {
          onNewJobModelIdChange(configured[0].id)
        }
        if (configured.length === 0 && newJobModelId) {
          onNewJobModelIdChange('')
        }
      })
      .catch(() => {
        if (!cancelled) setGenerationModels([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false)
      })
    return () => {
      cancelled = true
    }
  }, [showComposer, providerRevision, newJobModelId, onNewJobModelIdChange])

  const specGroups = useMemo(() => [
    {
      label: t("Dimensions"),
      icon: Ruler,
      values: ['120x80x32mm', '2.5mm walls', '6mm radius', 'M3 posts'],
    },
    {
      label: t("Material"),
      icon: BoxSelect,
      values: ['PLA', 'PETG', 'Aluminum', 'ABS'],
    },
    {
      label: t("Process"),
      icon: Hammer,
      values: ['FDM', 'CNC-ready', 'Laser cut', 'Prototype'],
    },
    {
      label: t("Tolerance"),
      icon: Gauge,
      values: ['0.2mm', 'Snap-fit', 'Inserts', 'Clearance'],
    },
  ], [t])

  /*
   * The chips are toggles, not blind appends: a value already present in the brief
   * paints as selected (signal tint + check), and clicking it again removes it. This
   * keeps the description the single source of truth - there is no second hidden
   * state that can disagree with the text the model will receive.
   */
  const isSpecSelected = (value: string) => {
    const tokens = newJobText.split(',').map(token => token.trim().toLowerCase())
    return tokens.includes(value.toLowerCase())
  }

  const toggleSpec = (value: string) => {
    const tokens = newJobText
      .split(',')
      .map(token => token.trim())
      .filter(Boolean)
    if (tokens.some(token => token.toLowerCase() === value.toLowerCase())) {
      onNewJobTextChange(tokens.filter(token => token.toLowerCase() !== value.toLowerCase()).join(', '))
      return
    }
    onNewJobTextChange(tokens.length ? `${tokens.join(', ')}, ${value}` : value)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (showComposer && newJobText.trim() && newJobModelId && !isCreating) {
          e.preventDefault()
          onCreate()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showComposer, newJobText, newJobModelId, isCreating, onCreate])

  const generateDisabledReason = !newJobText.trim()
    ? t("Describe the part first")
    : !newJobModelId
      ? t("Choose a model engine")
      : isCreating
        ? t("Generating…")
        : null

  return (
    <Dialog open={showComposer} onOpenChange={onShowComposerChange}>
      <DialogContent
        showCloseButton={false}
        /* The create surface is a shell plate (DESIGN.md section 13), not a legacy
           panel: same background, border, radius and shadow as a floating module.
           `sm:max-w-[780px]` is required because the primitive's `sm:max-w-lg` wins
           over an unprefixed `max-w-*` at >=640px - without it the dialog collapsed
           to 512px and the chip grid wrapped into noise. */
        className="max-w-[780px] sm:max-w-[780px] w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden text-[var(--shell-text)] font-sans outline-none focus:outline-none"
        style={{
          background: 'var(--shell-module-solid)',
          border: '1px solid var(--shell-border)',
          borderRadius: 9,
          /* A 100vmax spread shadow deepens the scrim around the plate itself, so the
             busy workspace behind it recedes further than the primitive's 50% overlay
             alone (the before audit read the background plates as still prominent). */
          boxShadow: 'var(--shell-shadow), 0 0 0 100vmax rgba(0, 0, 0, 0.26)',
        }}
        aria-describedby="composer-description"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("New part")}</DialogTitle>
          <DialogDescription id="composer-description">{t("Describe the part and its constraints")}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(100dvh-24px)] min-h-0 flex-col">
          {/* Header - pinned: the scroll region is the body below it */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--shell-hairline)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] text-[var(--shell-text-label)]">
                <BoxSelect className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold text-[var(--shell-text)]">{t("New part")}</h2>
                <p className="text-[12px] text-[var(--shell-text-muted)]">{t("Describe the geometry and constraints. After generation, edit the dimensions and rebuild.")}</p>
              </div>
            </div>
            <button
              type="button"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] ${FOCUS}`}
              onClick={() => onShowComposerChange(false)}
              aria-label={t("Close new part dialog")}
              title={t("Close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body - the only scroll region of the dialog */}
          <div className="stable-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
            {/* Primary Prompt Input */}
            <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] overflow-hidden focus-within:border-[var(--shell-signal)] transition-colors">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--shell-hairline)] px-3 py-1.5">
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)]">
                  {t("Part description")}
                </span>
                <div className="flex items-center gap-1">
                  {!newJobText.trim() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-7 px-2 font-mono text-[11px] text-[var(--shell-text-muted)] hover:bg-transparent hover:text-[var(--shell-text)] ${FOCUS}`}
                      onClick={() => onNewJobTextChange(t(EXAMPLE_PROMPT))}
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      {t("Try an example")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    /* The accent's soft form, the same role the rail's create action
                       and the stale status line use (DESIGN.md section 11). */
                    className={`h-7 px-2 font-mono text-[11px] text-[var(--shell-signal-soft)] hover:bg-transparent hover:text-[var(--shell-signal)] ${FOCUS}`}
                    onClick={onAiEnhance}
                    disabled={!newJobText.trim() || isAiEnhancing}
                    title={!newJobText.trim() ? t("Describe the part first") : t("Refine the description with AI")}
                  >
                    {isAiEnhancing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {isAiEnhancing ? t("Refining…") : t("Refine with AI")}
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Textarea
                  value={newJobText}
                  onChange={e => onNewJobTextChange(e.target.value)}
                  placeholder={t("For example: a snap-fit electronics enclosure, 2.5 mm walls, M3 standoffs and a USB-C opening…")}
                  /* `shell-field` hands focus to this block's own amber border instead of
                     drawing a second ring inside it (the composer does the same). */
                  className="shell-field h-[132px] min-h-[132px] w-full resize-none border-0 bg-transparent p-3 text-[13px] leading-relaxed text-[var(--shell-text)] placeholder:text-[var(--shell-text-muted)] focus-visible:ring-0"
                  maxLength={5000}
                  autoFocus
                />
              </div>
              {/* Helper + counter share one row under the field: the hint is the first
                  sentence a new user needs, the counter is meta (DESIGN.md section 9). */}
              <div className="flex items-center justify-between gap-3 border-t border-[color:var(--shell-hairline)] px-3 py-1.5">
                <p className="truncate text-[11px] leading-4 text-[var(--shell-text-muted)]">
                  {t("Include dimensions, wall thickness, material and mounting constraints.")}
                </p>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--shell-text-label)]">
                  {newJobText.length}/5000
                </span>
              </div>
            </div>

            {/* Engine & Labels Bar */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-2.5 space-y-1.5">
                <div className="flex min-h-7 items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)]">
                    <Cpu className="h-3 w-3" /> {t("Model engine")}
                  </span>
                  <button
                    type="button"
                    onClick={onAddProvider}
                    className={`-mr-1 inline-flex min-h-7 items-center rounded-[4px] px-1.5 font-mono text-[11px] text-[var(--shell-signal-soft)] transition-colors hover:text-[var(--shell-signal)] ${FOCUS}`}
                  >
                    {t("Settings")}
                  </button>
                </div>
                {isLoadingModels ? (
                  <div className="h-8 flex items-center px-2 font-mono text-[11px] text-[var(--shell-text-muted)]">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> {t("Loading models…")}
                  </div>
                ) : (
                  <select
                    value={newJobModelId}
                    onChange={(e) => onNewJobModelIdChange(e.target.value)}
                    aria-label={t("Model engine")}
                    className="shell-field h-8 w-full cursor-pointer rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] px-2 font-mono text-[12px] text-[var(--shell-text)] outline-none transition-colors hover:border-[color:var(--shell-border-strong)] focus:border-[var(--shell-signal)]"
                  >
                    {generationModels.length === 0 && <option value="">{t("No model configured")}</option>}
                    {generationModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-2.5 space-y-1.5">
                <div className="flex min-h-7 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)]">
                  <Tag className="h-3 w-3" /> {t("Tags (optional)")}
                </div>
                <Input
                  value={newJobTags}
                  onChange={e => onNewJobTagsChange(e.target.value)}
                  placeholder={t("For example: bracket, prototype, ABS")}
                  aria-label={t("Tags (optional)")}
                  className="shell-field h-8 rounded-[4px] border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] font-mono text-[12px] text-[var(--shell-text)] placeholder:text-[var(--shell-text-muted)] focus:border-[var(--shell-signal)] focus-visible:ring-0"
                />
              </div>
            </div>

            {/* Progressive Assistance Tabs: Modifiers | Templates | Recent */}
            <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] overflow-hidden">
              {/* Same segmented language as the density control: a well, and the active
                  segment carries the signal fill (DESIGN.md section 11, the active state). */}
              <div className="flex items-center gap-0.5 border-b border-[color:var(--shell-hairline)] px-2 py-1.5">
                {([
                  { key: 'modifiers' as const, label: t("Refine"), icon: SlidersHorizontal },
                  { key: 'templates' as const, label: t("Templates"), icon: LayoutTemplate },
                  ...(recentRequests.length > 0 ? [{ key: 'recent' as const, label: t("Recent"), icon: Clock }] : []),
                ]).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={activeAssistantTab === key}
                    className={`flex h-7 items-center gap-1 rounded-[4px] border px-2.5 font-mono text-[11px] transition-colors ${FOCUS} ${
                      activeAssistantTab === key
                        /* The selected segment is a tint, not a second solid signal group:
                           Generate is the only filled control on this surface (section 11
                           accent budget; one solid orange group per screen). */
                        ? 'border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-signal)_14%,transparent)] text-[var(--shell-text)]'
                        : 'border-transparent text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]'
                    }`}
                    onClick={() => setActiveAssistantTab(key)}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="p-3">
                {activeAssistantTab === 'modifiers' && (
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {specGroups.map(group => {
                      const Icon = group.icon
                      return (
                        <div key={group.label} className="space-y-1.5">
                          <div className="flex min-h-5 items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-label)]">
                            <Icon className="h-3 w-3" />
                            <span>{group.label}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {group.values.map(value => {
                              const selected = isSpecSelected(value)
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => toggleSpec(value)}
                                  className={`${CHIP_BASE} gap-1 ${
                                    selected
                                      ? 'border-[color:color-mix(in_srgb,var(--shell-signal)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--shell-signal)_14%,transparent)] text-[var(--shell-text)]'
                                      : 'border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] text-[var(--shell-text-muted)] hover:border-[color:var(--shell-border-strong)] hover:text-[var(--shell-text)]'
                                  }`}
                                >
                                  {selected ? <Check className="h-3 w-3 shrink-0 text-[var(--shell-signal)]" /> : <span aria-hidden="true">+</span>}
                                  <span>{value}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {activeAssistantTab === 'templates' && (
                  <JobTemplateCards onSelect={(template) => onNewJobTextChange(template)} />
                )}

                {activeAssistantTab === 'recent' && recentRequests.length > 0 && (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {recentRequests.slice(0, 4).map((req, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`min-h-7 rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-2 text-left text-[12px] text-[var(--shell-text-muted)] transition-colors hover:border-[color:var(--shell-border-strong)] hover:text-[var(--shell-text)] ${FOCUS}`}
                        onClick={() => onNewJobTextChange(req)}
                        title={req}
                      >
                        <p className="line-clamp-2">{req}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Case Memory / Similar Design Recommendation */}
            {newJobText.trim().length >= 5 && (
              <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-3">
                <CaseMemory
                  searchQuery={newJobText}
                  onSuggestionClick={(job) => {
                    toast.info(t("Similar design found"), { description: job.inputRequest.slice(0, 60) })
                  }}
                />
              </div>
            )}
          </div>

          {/* Footer - pinned under the scroll region */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--shell-hairline)] px-4 py-2.5">
            <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] text-[var(--shell-text-label)]">
              <span>{t("⌘⏎ Generate")}</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                /* Secondary, not quiet: cancel is a real alternative to the action and
                   should read as one, while Generate stays the only filled control. */
                className={`h-8 rounded-[6px] border border-[color:var(--shell-border)] bg-transparent px-3 font-mono text-[12px] text-[var(--shell-text-muted)] hover:border-[color:var(--shell-border-strong)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] ${FOCUS}`}
                onClick={() => onShowComposerChange(false)}
              >
                {t("Cancel")}
              </Button>
              <span title={generateDisabledReason ?? undefined}>
                <Button
                  size="sm"
                  /* The one solid signal group on this surface: the action (section 11). */
                  className="h-8 px-4 rounded-[6px] font-mono text-[12px] font-medium bg-[var(--shell-signal)] hover:bg-[var(--shell-signal-hover)] text-[var(--shell-signal-ink)] disabled:opacity-40 disabled:pointer-events-none"
                  onClick={onCreate}
                  disabled={!newJobText.trim() || !newJobModelId || isCreating}
                >
                  {isCreating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
                  <span>{t("Generate")}</span>
                </Button>
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
