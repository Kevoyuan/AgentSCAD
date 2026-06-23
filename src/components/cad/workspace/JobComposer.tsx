'use client'

import { useEffect, useState } from 'react'
import {
  Play, Loader2, Sparkles, Tag, Ruler, Hammer, BoxSelect, Gauge, LockKeyhole, Cpu, Clock, CornerDownLeft, X, Wand2,
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

export function JobComposer({
  showComposer,
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
  const [generationModels, setGenerationModels] = useState<Array<Pick<ModelInfo, 'id' | 'name' | 'providerName' | 'description'>>>([])
  const [isLoadingModels, setIsLoadingModels] = useState(true)

  useEffect(() => {
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
  }, [newJobModelId, onNewJobModelIdChange])

  const specGroups = [
    {
      label: 'Dimensions',
      icon: Ruler,
      values: ['120x80x32mm', '2.5mm walls', '6mm radius', 'M3 posts'],
    },
    {
      label: 'Material',
      icon: BoxSelect,
      values: ['PLA', 'PETG', 'Aluminum', 'ABS'],
    },
    {
      label: 'Process',
      icon: Hammer,
      values: ['FDM', 'CNC-ready', 'Laser cut', 'Prototype'],
    },
    {
      label: 'Tolerance',
      icon: Gauge,
      values: ['0.2mm', 'Snap-fit', 'Inserts', 'Clearance'],
    },
  ]

  const appendSpec = (value: string) => {
    const next = newJobText.trim() ? `${newJobText.trim()}, ${value}` : value
    onNewJobTextChange(next)
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

  return (
    <Dialog open={showComposer} onOpenChange={onShowComposerChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[860px] w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden border border-[color:var(--cad-border)] bg-[var(--cad-surface)] text-[var(--cad-text)] font-sans shadow-[0_24px_60px_-16px_rgba(15,23,42,0.24)] outline-none focus:outline-none sm:rounded-[12px]"
        aria-describedby="composer-description"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>New Specification</DialogTitle>
          <DialogDescription id="composer-description">Create a new CAD specification</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(100dvh-24px)] min-h-[560px] flex-col bg-[var(--app-bg)]">
          <div className="shrink-0 border-b border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-raised)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <BoxSelect className="h-3.5 w-3.5 text-[var(--cad-text-secondary)]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[var(--cad-text)]">Create CAD Job</div>
                  <div className="truncate text-[11px] text-[var(--cad-text-muted)]">Describe the part first, then refine constraints.</div>
                </div>
              </div>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--cad-text-muted)] transition-colors hover:bg-[var(--cad-surface-raised)] hover:text-[var(--cad-text)]"
                onClick={() => onShowComposerChange(false)}
                aria-label="Close composer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <div className="rounded-[10px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-2 border-b border-[color:var(--cad-border)] px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--cad-accent)]" />
                    <span className="truncate text-[12px] font-medium text-[var(--cad-text-secondary)]">Part brief</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* Junior Designer Assumption: show "Try Example" only when textarea is empty
                        so new users instantly understand what to type. Prompt matches README sample job. */}
                    {!newJobText.trim() && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 rounded-[6px] px-2.5 text-[11px] font-medium text-[var(--cad-text-muted)] transition-colors hover:bg-[var(--cad-surface-raised)] hover:text-[var(--cad-text)] active:scale-[0.98]"
                        onClick={() => onNewJobTextChange('Create a wall-mountable phone holder with rounded corners and two screw holes.')}
                      >
                        <Wand2 className="mr-1.5 h-3 w-3 shrink-0" />
                        <span className="truncate">Try Example</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 max-w-[136px] shrink-0 rounded-[6px] px-2.5 text-[11px] font-medium text-[var(--cad-accent)] transition-colors hover:bg-[var(--cad-accent-soft)] active:scale-[0.98]"
                      onClick={onAiEnhance}
                      disabled={!newJobText.trim() || isAiEnhancing}
                    >
                      {isAiEnhancing ? <Loader2 className="mr-1.5 h-3 w-3 shrink-0 animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3 shrink-0" />}
                      <span className="truncate">{isAiEnhancing ? 'Synthesizing' : 'AI Enhance'}</span>
                    </Button>
                  </div>
                </div>
                <div className="relative">
                  <Textarea
                    value={newJobText}
                    onChange={e => onNewJobTextChange(e.target.value)}
                    placeholder="Hinged electronics enclosure with 2.5mm walls, M3 screw posts, snap-fit lid..."
                    className="h-[150px] min-h-[150px] w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 py-4 pb-10 text-[15px] leading-7 text-[var(--cad-text)] placeholder:text-[var(--cad-text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0"
                    maxLength={5000}
                    autoFocus
                  />
                  <div className="pointer-events-none absolute bottom-3 right-4 text-[10px] font-mono tabular-nums text-[var(--cad-text-muted)]">
                    {newJobText.length}/5000
                  </div>
                </div>
              </div>

              <section className="rounded-[9px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-3.5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--cad-text-secondary)]">
                        <Cpu className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Engine</span>
                      </label>
                      <button onClick={onAddProvider} className="shrink-0 text-[11px] text-[var(--cad-text-muted)] transition-colors hover:text-[var(--cad-text)]">
                        Manage
                      </button>
                    </div>
                    <div className="relative">
                      {isLoadingModels ? (
                        <div className="flex h-9 w-full items-center rounded-[7px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-2.5 text-[12px] text-[var(--cad-text-muted)]">
                          <Loader2 className="mr-2 h-3 w-3 shrink-0 animate-spin" /> Loading...
                        </div>
                      ) : (
                        <select
                          value={newJobModelId}
                          onChange={(e) => onNewJobModelIdChange(e.target.value)}
                          className="h-9 w-full cursor-pointer appearance-none truncate rounded-[7px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] pl-3 pr-8 text-[12px] text-[var(--cad-text)] shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-colors hover:bg-[var(--cad-surface-raised)] focus:border-[color:var(--cad-accent)] focus:ring-1 focus:ring-[var(--cad-accent)]"
                          style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2375808b%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px top 50%', backgroundSize: '8px auto' }}
                        >
                          {generationModels.length === 0 && <option value="">No engines available</option>}
                          {generationModels.map(model => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--cad-text-secondary)]">
                      <Tag className="h-3.5 w-3.5 shrink-0" /> Labels
                    </label>
                    <Input
                      value={newJobTags}
                      onChange={e => onNewJobTagsChange(e.target.value)}
                      placeholder="prototype, abs"
                      className="h-9 rounded-[7px] border-[color:var(--cad-border)] bg-[var(--cad-surface)] text-[12px] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors placeholder:text-[var(--cad-text-muted)] hover:bg-[var(--cad-surface-raised)] focus:border-[color:var(--cad-accent)]"
                    />
                    {newJobTags.trim() && (
                      <div className="pt-1">
                        <TagBadges customerId={buildCustomerId(newJobTags.split(',').map(t => t.trim()).filter(t => t))} maxDisplay={4} />
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-[9px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-3.5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--cad-text-secondary)]">
                    <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Quick modifiers</span>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {specGroups.map(group => {
                    const Icon = group.icon
                    return (
                      <div key={group.label} className="space-y-1.5">
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--cad-text-muted)]">
                          <Icon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{group.label}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.values.map(value => (
                            <button
                              key={value}
                              type="button"
                              className="max-w-full rounded-[6px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-raised)] px-2 py-1 text-left text-[11px] leading-4 text-[var(--cad-text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all hover:border-[color:var(--cad-accent)] hover:bg-[var(--cad-accent-soft)] hover:text-[var(--cad-text)] active:scale-[0.98]"
                              onClick={() => appendSpec(value)}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="rounded-[9px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-3.5">
                <JobTemplateCards onSelect={(template) => onNewJobTextChange(template)} />
              </section>

              {(newJobText.trim().length >= 3 || recentRequests.length > 0) && (
                <section className="min-h-[104px] rounded-[9px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-3.5">
                  <CaseMemory
                    searchQuery={newJobText}
                    onSuggestionClick={(job) => {
                      toast.info('Similar job found', { description: job.inputRequest.slice(0, 60) })
                    }}
                  />
                  {recentRequests.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--cad-text-secondary)]">
                        <Clock className="h-3 w-3" /> Recent
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-3">
                        {recentRequests.slice(0, 3).map((req, i) => (
                          <button
                            key={i}
                            className="line-clamp-2 rounded-[6px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-2.5 py-2 text-left text-[12px] leading-4 text-[var(--cad-text-secondary)] transition-all hover:bg-[var(--cad-surface-raised)] hover:text-[var(--cad-text)] active:scale-[0.98]"
                            onClick={() => onNewJobTextChange(req)}
                            title={req}
                          >
                            {req}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-4 py-3">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
              <Button
                variant="ghost"
                className="h-8 rounded-[6px] px-2.5 text-[12px] font-medium text-[var(--cad-text-secondary)] transition-colors hover:bg-[var(--cad-surface-raised)] hover:text-[var(--cad-text)] active:scale-[0.98]"
                onClick={() => onShowComposerChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex h-8 min-w-0 items-center justify-center gap-2 rounded-[6px] bg-[var(--cad-accent)] px-3 text-[12px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(15,23,42,0.12)] transition-all hover:bg-opacity-90 disabled:opacity-50 active:scale-[0.98]"
                onClick={onCreate}
                disabled={!newJobText.trim() || !newJobModelId || isCreating}
              >
                {isCreating ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Play className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">Create Job</span>
              </Button>
            </div>
            <div className="mt-2 hidden items-center justify-center gap-1.5 text-[10px] text-[var(--cad-text-muted)] md:flex">
              <kbd className="rounded border border-[color:var(--cad-border)] bg-[var(--cad-surface-raised)] px-1.5 py-0.5 font-sans">⌘</kbd>
              <span>+</span>
              <kbd className="flex items-center gap-1 rounded border border-[color:var(--cad-border)] bg-[var(--cad-surface-raised)] px-1.5 py-0.5 font-sans">
                Enter <CornerDownLeft className="h-2.5 w-2.5" />
              </kbd>
              <span className="ml-1">to create</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
