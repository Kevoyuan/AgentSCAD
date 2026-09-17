'use client'

import { useEffect, useState } from 'react'
import {
  Play, Loader2, Sparkles, Tag, Ruler, Hammer, BoxSelect, Gauge, Cpu, Clock, CornerDownLeft, X, Wand2, LayoutTemplate, SlidersHorizontal,
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

// Sample prompt for immediate first-time exploration
const EXAMPLE_PROMPT = 'Create a wall-mountable phone holder with rounded corners and two screw holes.' as const

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
        className="max-w-[780px] w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden border border-[color:var(--cad-border)] bg-[var(--cad-surface)] text-[var(--cad-text)] font-sans shadow-2xl outline-none focus:outline-none sm:rounded-[10px]"
        aria-describedby="composer-description"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>New Design</DialogTitle>
          <DialogDescription id="composer-description">Create a new parametric CAD design</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(100dvh-32px)] flex-col bg-[var(--cad-background)]">
          {/* Header */}
          <div className="shrink-0 border-b border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] text-[var(--cad-accent)]">
                <BoxSelect className="h-3.5 w-3.5" />
              </div>
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--cad-text-primary)]">New Design</h2>
                <p className="text-[11px] text-[var(--cad-text-muted)]">Describe geometry and parametric constraints in natural language.</p>
              </div>
            </div>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)] hover:bg-[var(--cad-surface-muted)] transition-colors"
              onClick={() => onShowComposerChange(false)}
              aria-label="Close dialog"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body */}
          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            {/* Primary Prompt Input */}
            <div className="rounded-[8px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-[color:var(--cad-border)] px-3 py-1.5 bg-[var(--cad-surface-muted)]/50">
                <span className="text-[11px] font-mono text-[var(--cad-text-muted)] uppercase tracking-wider">
                  Design Brief
                </span>
                <div className="flex items-center gap-1">
                  {!newJobText.trim() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] font-mono text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)] hover:bg-[var(--cad-surface-muted)]"
                      onClick={() => onNewJobTextChange(EXAMPLE_PROMPT)}
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      Try Example
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] font-mono text-[var(--cad-accent)] hover:bg-[var(--cad-accent)]/10"
                    onClick={onAiEnhance}
                    disabled={!newJobText.trim() || isAiEnhancing}
                  >
                    {isAiEnhancing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {isAiEnhancing ? 'Refining...' : 'AI Enhance'}
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Textarea
                  value={newJobText}
                  onChange={e => onNewJobTextChange(e.target.value)}
                  placeholder="e.g. A snap-fit electronics enclosure with 2.5mm walls, M3 screw bosses, and USB-C port cutout..."
                  className="h-[130px] min-h-[130px] w-full resize-none border-0 bg-transparent p-3 text-[13px] leading-relaxed text-[var(--cad-text-primary)] placeholder:text-[var(--cad-text-muted)]/60 focus-visible:ring-0"
                  maxLength={5000}
                  autoFocus
                />
                <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-mono text-[var(--cad-text-muted)] opacity-60">
                  {newJobText.length}/5000
                </div>
              </div>
            </div>

            {/* Engine & Labels Bar */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[6px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-[var(--cad-text-muted)]">
                  <span className="flex items-center gap-1 text-[var(--cad-text-secondary)]">
                    <Cpu className="h-3 w-3" /> Model Engine
                  </span>
                  <button
                    onClick={onAddProvider}
                    className="text-[10px] text-[var(--cad-accent)] hover:underline"
                  >
                    Settings
                  </button>
                </div>
                {isLoadingModels ? (
                  <div className="h-8 flex items-center px-2 text-[11px] font-mono text-[var(--cad-text-muted)]">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading models...
                  </div>
                ) : (
                  <select
                    value={newJobModelId}
                    onChange={(e) => onNewJobModelIdChange(e.target.value)}
                    className="h-8 w-full cursor-pointer rounded-[4px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] px-2 text-[12px] font-mono text-[var(--cad-text-primary)] outline-none transition-colors hover:border-[color:var(--cad-border-strong)] focus:border-[color:var(--cad-accent)]"
                  >
                    {generationModels.length === 0 && <option value="">No models configured</option>}
                    {generationModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="rounded-[6px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-2.5 space-y-1.5">
                <div className="text-[11px] font-mono text-[var(--cad-text-secondary)] flex items-center gap-1">
                  <Tag className="h-3 w-3 text-[var(--cad-text-muted)]" /> Tags (Optional)
                </div>
                <Input
                  value={newJobTags}
                  onChange={e => onNewJobTagsChange(e.target.value)}
                  placeholder="e.g. bracket, prototype, abs"
                  className="h-8 rounded-[4px] border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] text-[12px] font-mono placeholder:text-[var(--cad-text-muted)]/50 focus:border-[color:var(--cad-accent)]"
                />
              </div>
            </div>

            {/* Progressive Assistance Tabs: Modifiers | Templates | Recent */}
            <div className="rounded-[8px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] overflow-hidden">
              <div className="flex items-center gap-1 border-b border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)]/40 px-2 py-1">
                <button
                  type="button"
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-[11px] font-mono transition-colors ${
                    activeAssistantTab === 'modifiers'
                      ? 'bg-[var(--cad-surface)] text-[var(--cad-text-primary)] shadow-xs border border-[color:var(--cad-border)]'
                      : 'text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)]'
                  }`}
                  onClick={() => setActiveAssistantTab('modifiers')}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Modifiers</span>
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-[11px] font-mono transition-colors ${
                    activeAssistantTab === 'templates'
                      ? 'bg-[var(--cad-surface)] text-[var(--cad-text-primary)] shadow-xs border border-[color:var(--cad-border)]'
                      : 'text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)]'
                  }`}
                  onClick={() => setActiveAssistantTab('templates')}
                >
                  <LayoutTemplate className="w-3 h-3" />
                  <span>Templates</span>
                </button>
                {recentRequests.length > 0 && (
                  <button
                    type="button"
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-[11px] font-mono transition-colors ${
                      activeAssistantTab === 'recent'
                        ? 'bg-[var(--cad-surface)] text-[var(--cad-text-primary)] shadow-xs border border-[color:var(--cad-border)]'
                        : 'text-[var(--cad-text-muted)] hover:text-[var(--cad-text-primary)]'
                    }`}
                    onClick={() => setActiveAssistantTab('recent')}
                  >
                    <Clock className="w-3 h-3" />
                    <span>Recent</span>
                  </button>
                )}
              </div>

              <div className="p-3">
                {activeAssistantTab === 'modifiers' && (
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {specGroups.map(group => {
                      const Icon = group.icon
                      return (
                        <div key={group.label} className="space-y-1">
                          <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-[var(--cad-text-muted)]">
                            <Icon className="h-3 w-3" />
                            <span>{group.label}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {group.values.map(value => (
                              <button
                                key={value}
                                type="button"
                                className="rounded-[4px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] px-1.5 py-0.5 text-left text-[11px] font-mono text-[var(--cad-text-secondary)] transition-colors hover:border-[color:var(--cad-accent)] hover:text-[var(--cad-text-primary)]"
                                onClick={() => appendSpec(value)}
                              >
                                + {value}
                              </button>
                            ))}
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
                        className="rounded-[4px] border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] p-2 text-left text-[11px] text-[var(--cad-text-secondary)] transition-colors hover:border-[color:var(--cad-accent)] hover:text-[var(--cad-text-primary)]"
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
              <div className="rounded-[8px] border border-[color:var(--cad-border)] bg-[var(--cad-surface)] p-3">
                <CaseMemory
                  searchQuery={newJobText}
                  onSuggestionClick={(job) => {
                    toast.info('Similar design found', { description: job.inputRequest.slice(0, 60) })
                  }}
                />
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div className="shrink-0 border-t border-[color:var(--cad-border)] bg-[var(--cad-surface)] px-4 py-2.5 flex items-center justify-between">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-[var(--cad-text-muted)]">
              <kbd className="rounded border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] px-1.5 py-0.5 text-[10px]">⌘</kbd>
              <span>+</span>
              <kbd className="rounded border border-[color:var(--cad-border)] bg-[var(--cad-surface-muted)] px-1.5 py-0.5 text-[10px] flex items-center gap-0.5">
                Enter <CornerDownLeft className="h-2.5 w-2.5" />
              </kbd>
              <span className="opacity-70">to generate</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-[12px] font-mono text-[var(--cad-text-secondary)] hover:text-[var(--cad-text-primary)]"
                onClick={() => onShowComposerChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 px-4 text-[12px] font-mono font-medium bg-[var(--cad-accent)] hover:bg-[var(--cad-accent-hover)] text-white shadow-xs"
                onClick={onCreate}
                disabled={!newJobText.trim() || !newJobModelId || isCreating}
              >
                {isCreating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
                <span>Generate</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
