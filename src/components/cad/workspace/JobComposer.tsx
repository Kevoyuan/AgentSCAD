'use client'

import { useEffect, useState } from 'react'
import {
  Play, Loader2, Sparkles, Tag, Ruler, Hammer, BoxSelect, Gauge, Cpu, Clock, X, Wand2, LayoutTemplate, SlidersHorizontal,
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
const EXAMPLE_PROMPT = '装在 35 mm 导轨上的相机支架,M4 螺孔,壁厚 3 mm' as const

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
      label: '尺寸',
      icon: Ruler,
      values: ['120x80x32mm', '2.5mm walls', '6mm radius', 'M3 posts'],
    },
    {
      label: '材料',
      icon: BoxSelect,
      values: ['PLA', 'PETG', 'Aluminum', 'ABS'],
    },
    {
      label: '工艺',
      icon: Hammer,
      values: ['FDM', 'CNC-ready', 'Laser cut', 'Prototype'],
    },
    {
      label: '公差',
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
        /* The create surface is a shell plate (DESIGN.md section 13), not a legacy
           panel: same background, border, radius and shadow as a floating module. */
        className="max-w-[780px] w-[calc(100vw-24px)] p-0 gap-0 overflow-hidden text-[var(--shell-text)] font-sans outline-none focus:outline-none"
        style={{
          background: 'var(--shell-module-solid)',
          border: '1px solid var(--shell-border)',
          borderRadius: 9,
          boxShadow: 'var(--shell-shadow)',
        }}
        aria-describedby="composer-description"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>新零件</DialogTitle>
          <DialogDescription id="composer-description">描述你要的零件和参数约束</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(100dvh-32px)] flex-col">
          {/* Header */}
          <div className="shrink-0 border-b border-[color:var(--shell-hairline)] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] text-[var(--shell-text-label)]">
                <BoxSelect className="h-3.5 w-3.5" />
              </div>
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--shell-text)]">新零件</h2>
                <p className="text-[11.5px] text-[var(--shell-text-muted)]">用一句话描述几何和参数约束,生成后可以改数字重建。</p>
              </div>
            </div>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-[var(--shell-well)] transition-colors"
              onClick={() => onShowComposerChange(false)}
              aria-label="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body */}
          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            {/* Primary Prompt Input */}
            <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] overflow-hidden focus-within:border-[var(--shell-signal)] transition-colors">
              <div className="flex items-center justify-between border-b border-[color:var(--shell-hairline)] px-3 py-1.5">
                <span className="font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
                  零件描述
                </span>
                <div className="flex items-center gap-1">
                  {!newJobText.trim() && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 font-mono text-[10.5px] text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] hover:bg-transparent"
                      onClick={() => onNewJobTextChange(EXAMPLE_PROMPT)}
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      试试例子
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    /* The accent's soft form, the same role the rail's create action
                       and the stale status line use (DESIGN.md section 11). */
                    className="h-6 px-2 font-mono text-[10.5px] text-[var(--shell-signal-soft)] hover:text-[var(--shell-signal)] hover:bg-transparent"
                    onClick={onAiEnhance}
                    disabled={!newJobText.trim() || isAiEnhancing}
                  >
                    {isAiEnhancing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                    {isAiEnhancing ? '润色中…' : 'AI 润色'}
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Textarea
                  value={newJobText}
                  onChange={e => onNewJobTextChange(e.target.value)}
                  placeholder="例如:一个卡扣式电子外壳,壁厚 2.5 mm,M3 螺柱,USB-C 开口…"
                  /* `shell-field` hands focus to this block's own amber border instead of
                     drawing a second ring inside it (the composer does the same). */
                  className="shell-field h-[130px] min-h-[130px] w-full resize-none border-0 bg-transparent p-3 text-[12.5px] leading-relaxed text-[var(--shell-text)] placeholder:text-[var(--shell-text-dim)] focus-visible:ring-0"
                  maxLength={5000}
                  autoFocus
                />
                <div className="pointer-events-none absolute bottom-2 right-3 font-mono text-[9px] text-[var(--shell-text-dim)]">
                  {newJobText.length}/5000
                </div>
              </div>
            </div>

            {/* Engine & Labels Bar */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
                    <Cpu className="h-3 w-3" /> 模型引擎
                  </span>
                  <button
                    onClick={onAddProvider}
                    className="font-mono text-[10px] text-[var(--shell-signal-soft)] hover:text-[var(--shell-signal)] transition-colors"
                  >
                    设置
                  </button>
                </div>
                {isLoadingModels ? (
                  <div className="h-8 flex items-center px-2 font-mono text-[10.5px] text-[var(--shell-text-dim)]">
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" /> 读取模型…
                  </div>
                ) : (
                  <select
                    value={newJobModelId}
                    onChange={(e) => onNewJobModelIdChange(e.target.value)}
                    className="shell-field h-8 w-full cursor-pointer rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] px-2 font-mono text-[11.5px] text-[var(--shell-text)] outline-none transition-colors hover:border-[color:var(--shell-border-strong)] focus:border-[var(--shell-signal)]"
                  >
                    {generationModels.length === 0 && <option value="">还没有配置模型</option>}
                    {generationModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 font-mono text-[9px] font-medium tracking-[0.16em] uppercase text-[var(--shell-text-label)]">
                  <Tag className="h-3 w-3" /> 标签(可选)
                </div>
                <Input
                  value={newJobTags}
                  onChange={e => onNewJobTagsChange(e.target.value)}
                  placeholder="例如:支架、原型、ABS"
                  className="shell-field h-8 rounded-[4px] border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] font-mono text-[11.5px] text-[var(--shell-text)] placeholder:text-[var(--shell-text-dim)] focus:border-[var(--shell-signal)] focus-visible:ring-0"
                />
              </div>
            </div>

            {/* Progressive Assistance Tabs: Modifiers | Templates | Recent */}
            <div className="rounded-[9px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] overflow-hidden">
              {/* Same segmented language as the density control: a well, and the active
                  segment carries the signal fill (DESIGN.md section 11, the active state). */}
              <div className="flex items-center gap-0.5 border-b border-[color:var(--shell-hairline)] px-2 py-1.5">
                {([
                  { key: 'modifiers' as const, label: '修饰', icon: SlidersHorizontal },
                  { key: 'templates' as const, label: '模板', icon: LayoutTemplate },
                  ...(recentRequests.length > 0 ? [{ key: 'recent' as const, label: '最近', icon: Clock }] : []),
                ]).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={`flex items-center gap-1 px-2.5 h-[22px] rounded-[4px] font-mono text-[10.5px] transition-colors ${
                      activeAssistantTab === key
                        ? 'bg-[var(--shell-signal)] text-[#1A0F08]'
                        : 'text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]'
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
                        <div key={group.label} className="space-y-1">
                          <div className="flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--shell-text-label)]">
                            <Icon className="h-3 w-3" />
                            <span>{group.label}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {group.values.map(value => (
                              <button
                                key={value}
                                type="button"
                                className="rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] px-1.5 py-0.5 text-left font-mono text-[10.5px] text-[var(--shell-text-muted)] transition-colors hover:border-[color:var(--shell-border-strong)] hover:text-[var(--shell-text)]"
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
                        className="rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-2 text-left text-[11px] text-[var(--shell-text-muted)] transition-colors hover:border-[color:var(--shell-border-strong)] hover:text-[var(--shell-text)]"
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
                    toast.info('Similar design found', { description: job.inputRequest.slice(0, 60) })
                  }}
                />
              </div>
            )}
          </div>

          {/* Footer Bar */}
          <div className="shrink-0 border-t border-[color:var(--shell-hairline)] px-4 py-2.5 flex items-center justify-between">
            <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] text-[var(--shell-text-dim)]">
              <span>⌘⏎ 生成</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 font-mono text-[11.5px] text-[var(--shell-text-muted)] hover:text-[var(--shell-text)] hover:bg-transparent"
                onClick={() => onShowComposerChange(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                /* The one solid signal group on this surface: the action (section 11). */
                className="h-7 px-4 rounded-[6px] font-mono text-[11.5px] font-medium bg-[var(--shell-signal)] hover:bg-[#FF6E36] text-[#1A0F08] disabled:opacity-40 disabled:pointer-events-none"
                onClick={onCreate}
                disabled={!newJobText.trim() || !newJobModelId || isCreating}
              >
                {isCreating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
                <span>生成</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
