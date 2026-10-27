'use client'

import { useI18n } from '@/components/i18n-provider'

import { useCallback } from 'react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import {
  Job,
  getJobDimensions,
  getJobStateUi,
  relativeTime,
  STATE_TONE_CLASS,
  STATE_TONE_DOT_CLASS,
} from './types'
import { PartFamilyIcon, getPartFamilyLabel } from './part-family-icon'

// ─── Types ────────────────────────────────────────────────────────────────────
/*
 * One palette for parts AND actions (DESIGN.md "Command palette / shortcuts":
 * keys only, and the hint must be true). The old surface was a job list that
 * leaked truncated ids (`cmv0ju1`) and used a different status vocabulary than
 * the rail. Now:
 *  - every row is either an action or a part, and both speak the same words;
 *  - no backend id ever reaches the screen - a part is identified by its family,
 *    its measured size and its age;
 *  - Actions are the first group, so the advertised commands are not hidden below
 *    a long list of parts.
 */

export interface CommandAction {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  shortcut?: string
  onSelect: () => void
  category: 'job' | 'action'
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: Job[]
  onSelectJob: (job: Job) => void
  actions: CommandAction[]
}

// ─── Row styles ───────────────────────────────────────────────────────────────
/* Shell tokens only (DESIGN.md section 11). Selection is the module hover wash
   plus the reading text colour - no second accent colour. */
const ITEM_CLASS = [
  /* `py-1!` beats @/components/ui/command's `[&_[cmdk-item]]:py-3` descendant rule so
     eight actions + parts fit the visible list instead of scrolling the commands away. */
  'group flex min-h-8 cursor-pointer items-center gap-2.5 rounded-[4px] px-2 py-1!',
  'text-[var(--shell-text-muted)] transition-colors',
  'data-[selected=true]:bg-[var(--shell-hover)] data-[selected=true]:text-[var(--shell-text)]',
  '[&_svg]:shrink-0',
].join(' ')

const GROUP_HEADING_CLASS = [
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5',
  '[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px]',
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em]',
  '[&_[cmdk-group-heading]]:text-[var(--shell-text-label)]',
].join(' ')

// ─── Command Palette Component ────────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
  jobs,
  onSelectJob,
  actions,
}: CommandPaletteProps) {
  const { t } = useI18n()

  // cmdk filters rendered items, so every part must be present for search.
  // The list's height cap keeps the unfiltered palette scrollable.
  const partRows = jobs

  const handleSelectJob = useCallback((job: Job) => {
    onSelectJob(job)
    onOpenChange(false)
  }, [onSelectJob, onOpenChange])

  const handleSelectAction = useCallback((action: CommandAction) => {
    action.onSelect()
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Command Palette")}
      description={t("Search parts and run commands…")}
      showCloseButton={false}
      className={[
        'w-[min(640px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[640px]',
        'gap-0 overflow-hidden rounded-[9px] border-[color:var(--shell-border)] p-0',
        'bg-[var(--shell-module-solid)] text-[var(--shell-text)]',
        'shadow-[0_28px_60px_-16px_rgba(0,0,0,0.55)]',
      ].join(' ')}
    >
      <CommandInput
        placeholder={t("Search parts, actions, or a command…")}
        /* shell-field: focus is one amber border on the field, not the global
           box-shadow ring (DESIGN.md section 21). */
        className="shell-field h-11 border border-transparent text-[13px] text-[var(--shell-text)] placeholder:text-[var(--shell-placeholder)] focus:border-[var(--shell-signal)]"
      />

      <CommandList
        className="max-h-[min(56vh,480px)] overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:var(--shell-scroll-thumb)_transparent]"
        data-testid="command-palette-list"
      >
        <CommandEmpty className="px-4 py-10 text-center">
          <p className="text-[13px] text-[var(--shell-text-muted)]">
            {t("No matching parts or actions.")}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--shell-text-label)]">
            {t("Try a part name, a family, or a command.")}
          </p>
        </CommandEmpty>

        {/* 1. Actions — the palette advertises commands, so they come first. */}
        <CommandGroup heading={t("Actions")} className={GROUP_HEADING_CLASS}>
          {actions.map((action) => (
            <CommandItem
              key={`action-${action.id}`}
              value={`action ${action.id} ${action.label} ${action.description ?? ''}`}
              onSelect={() => handleSelectAction(action)}
              className={ITEM_CLASS}
            >
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] border border-[color:var(--shell-border)] bg-[var(--shell-well)] text-[var(--shell-text-label)] group-data-[selected=true]:text-[var(--shell-text)]"
              >
                {action.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{action.label}</span>
              {action.description && (
                <span className="hidden min-w-0 max-w-[180px] shrink-0 truncate text-[10px] text-[var(--shell-text-label)] sm:block">
                  {action.description}
                </span>
              )}
              {action.shortcut && (
                <CommandShortcut className="ml-1 shrink-0 font-mono text-[10px] tracking-[0.08em] text-[var(--shell-text-label)]">
                  {action.shortcut}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator className="mx-2 h-px bg-[var(--shell-hairline)]" />

        {/* 2. Parts — same status words and dots as the rail, no ids. */}
        <CommandGroup heading={t("Parts")} className={GROUP_HEADING_CLASS}>
          {partRows.map((job) => {
            const { labelKey, tone } = getJobStateUi(job.state)
            const stateLabel = t(labelKey)
            const family = getPartFamilyLabel(job.partFamily)
            const dimensions = getJobDimensions(job)
            const meta = [
              job.partFamily && job.partFamily !== 'unknown' ? family : null,
              dimensions,
              relativeTime(job.createdAt),
            ].filter(Boolean).join(' · ')

            return (
              <CommandItem
                key={`part-${job.id}`}
                value={`part ${job.inputRequest} ${family} ${dimensions ?? ''} ${stateLabel}`}
                onSelect={() => handleSelectJob(job)}
                className={ITEM_CLASS}
              >
                <PartFamilyIcon family={job.partFamily || 'unknown'} size="sm" animate={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] leading-[1.35]">{job.inputRequest}</p>
                  <p className="mt-[3px] truncate font-mono text-[10px] leading-[1.4] text-[var(--shell-text-label)]">
                    {meta}
                  </p>
                </div>
                {/* Colour is never the only signal: dot + word. */}
                <span className={`flex shrink-0 items-center gap-1 text-[10px] ${STATE_TONE_CLASS[tone]}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_TONE_DOT_CLASS[tone]}`} />
                  {stateLabel}
                </span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>

      {/* Footer: real keys only. */}
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--shell-hairline)] px-3 py-2">
        <span className="truncate font-mono text-[10px] text-[var(--shell-text-label)]">
          {t("↑↓ Navigate · ↵ Select · Esc Close")}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[var(--shell-text-label)]">⌘K</span>
      </div>
    </CommandDialog>
  )
}
