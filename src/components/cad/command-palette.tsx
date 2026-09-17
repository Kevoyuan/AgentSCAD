'use client'

import { useEffect, useState, useCallback } from 'react'
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
  Plus, Moon, Sun, BarChart3, GitCompare, Download,
  Play, Trash2, RotateCcw, FileJson, Search, Settings,
  Eye, Share2, AlertCircle, Palette, Keyboard,
} from 'lucide-react'
import { Job, getStateInfo } from './types'
import { StateBadge } from './state-badge'
import { PartFamilyIcon } from './part-family-icon'

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Recent Commands Storage ────────────────────────────────────────────────

const RECENT_KEY = 'agentscad-recent-commands'
const MAX_RECENT = 5

function getRecentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

function addRecentCommand(id: string) {
  const recent = getRecentCommands().filter(r => r !== id)
  recent.unshift(id)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

// ─── Command Palette Component ──────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
  jobs,
  onSelectJob,
  actions,
}: CommandPaletteProps) {
  const [recentIds] = useState<string[]>(getRecentCommands)

  // Filter jobs to show in command palette (max 10 for performance)
  const filteredJobItems = jobs.slice(0, 10)

  // Recent jobs
  const recentJobs = recentIds
    .map(id => jobs.find(j => j.id === id))
    .filter((j): j is Job => !!j)

  const handleSelectJob = useCallback((job: Job) => {
    addRecentCommand(job.id)
    onSelectJob(job)
    onOpenChange(false)
  }, [onSelectJob, onOpenChange])

  const handleSelectAction = useCallback((action: CommandAction) => {
    addRecentCommand(action.id)
    action.onSelect()
    onOpenChange(false)
  }, [onOpenChange])

  // Recent action items
  const recentActions = recentIds
    .map(id => actions.find(a => a.id === id))
    .filter((a): a is CommandAction => !!a)

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command Palette"
      description="Search jobs and actions..."
      className="bg-[var(--app-surface)] border-[color:var(--app-border)] [&_[cmdk-group-heading]]:text-[var(--app-text-muted)]"
    >
      <CommandInput
        placeholder="Search jobs, actions, or type a command..."
        className="text-[var(--app-text-secondary)] placeholder:text-[var(--app-text-dim)]"
      />
      <CommandList className="max-h-[400px]">
        <CommandEmpty className="text-[var(--app-text-dim)] text-sm py-6">No results found.</CommandEmpty>

        {/* Recent Commands */}
        {(recentJobs.length > 0 || recentActions.length > 0) && (
          <>
            <CommandGroup heading="Recent" className="[&_[cmdk-group-heading]]:text-[var(--app-text-dim)] [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:tracking-widest">
              {recentJobs.map(job => (
                <CommandItem
                  key={`recent-job-${job.id}`}
                  value={`recent-job-${job.id} ${job.inputRequest}`}
                  onSelect={() => handleSelectJob(job)}
                  className="text-[var(--app-text-secondary)] data-[selected=true]:bg-[var(--app-accent-bg)] data-[selected=true]:text-[var(--app-text-primary)] rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
                >
                  <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
                  <div className="flex-1 min-w-0 ml-1.5">
                    <span className="text-[13px] truncate block max-w-[280px]">{job.inputRequest}</span>
                  </div>
                  <StateBadge state={job.state} />
                  <span className="text-[10px] font-mono text-[var(--app-text-dim)] ml-1">{job.id.slice(0, 8)}</span>
                </CommandItem>
              ))}
              {recentActions.map(action => (
                <CommandItem
                  key={`recent-action-${action.id}`}
                  value={`recent-action-${action.id} ${action.label}`}
                  onSelect={() => handleSelectAction(action)}
                  className="text-[var(--app-text-secondary)] data-[selected=true]:bg-[var(--app-accent-bg)] data-[selected=true]:text-[var(--app-text-primary)] rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
                >
                  {action.icon}
                  <span className="text-[13px] ml-2">{action.label}</span>
                  {action.shortcut && <CommandShortcut className="text-xs text-[var(--app-text-dim)]">{action.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator className="bg-[var(--app-border-separator)]" />
          </>
        )}

        {/* Jobs */}
        <CommandGroup heading="Jobs" className="[&_[cmdk-group-heading]]:text-[var(--app-text-dim)] [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:tracking-widest">
          {filteredJobItems.map(job => (
            <CommandItem
              key={`job-${job.id}`}
              value={`job-${job.id} ${job.inputRequest} ${job.state}`}
              onSelect={() => handleSelectJob(job)}
              className="text-[var(--app-text-secondary)] data-[selected=true]:bg-[var(--app-accent-bg)] data-[selected=true]:text-[var(--app-text-primary)] rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
            >
              <PartFamilyIcon family={job.partFamily || 'unknown'} size="xs" />
              <div className="flex-1 min-w-0 ml-1.5">
                <span className="text-[13px] truncate block max-w-[280px]">{job.inputRequest}</span>
                <span className="text-[10px] font-mono text-[var(--app-text-dim)]">{job.id.slice(0, 8)}</span>
              </div>
              <StateBadge state={job.state} />
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator className="bg-[var(--app-border-separator)]" />

        {/* Actions */}
        <CommandGroup heading="Actions" className="[&_[cmdk-group-heading]]:text-[var(--app-text-dim)] [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:tracking-widest">
          {actions.map(action => (
            <CommandItem
              key={`action-${action.id}`}
              value={`action-${action.id} ${action.label}`}
              onSelect={() => handleSelectAction(action)}
              className="text-[var(--app-text-secondary)] data-[selected=true]:bg-[var(--app-accent-bg)] data-[selected=true]:text-[var(--app-text-primary)] rounded-md px-2.5 py-1.5 cursor-pointer transition-colors"
            >
              {action.icon}
              <span className="text-[13px] ml-2">{action.label}</span>
              {action.description && <span className="text-xs text-[var(--app-text-dim)] ml-2 hidden sm:inline">{action.description}</span>}
              {action.shortcut && <CommandShortcut className="text-xs text-[var(--app-text-dim)]">{action.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[color:var(--app-border-separator)]">
        <span className="text-xs text-[var(--app-text-dim)] font-mono">↑↓ Navigate · ↵ Select · Esc Close</span>
        <span className="text-xs text-[var(--app-text-dim)] font-mono">⌘K</span>
      </div>
    </CommandDialog>
  )
}
