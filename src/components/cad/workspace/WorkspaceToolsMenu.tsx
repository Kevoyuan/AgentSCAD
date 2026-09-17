'use client'

import React from 'react'
import {
  MoreHorizontal,
  BarChart3,
  GitCompare,
  Cpu,
  Palette,
  Keyboard,
  Zap,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface WorkspaceToolsMenuProps {
  onOpenStats: () => void
  onOpenCompare: () => void
  onOpenSettings: (tab: 'providers' | 'theme') => void
  onOpenShortcuts: () => void
  onOpenCommandPalette: () => void
  onExportAllData: () => void
  className?: string
}

export function WorkspaceToolsMenu({
  onOpenStats,
  onOpenCompare,
  onOpenSettings,
  onOpenShortcuts,
  onOpenCommandPalette,
  onExportAllData,
  className,
}: WorkspaceToolsMenuProps) {
  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)] focus-visible:ring-1 focus-visible:ring-[var(--app-focus-ring)] rounded-[6px] transition-colors shrink-0 ${className || ''}`}
                aria-label="Workspace Tools & Preferences"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Tools & Options</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 bg-[var(--app-surface)] border border-[color:var(--app-border)] rounded-[8px] p-1 shadow-lg text-xs select-none z-50"
      >
        {/* Group 1: Analytics & Inspection */}
        <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--app-text-dim)] px-2 py-1">
          Analytics & Inspection
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={onOpenStats}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <BarChart3 className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400 shrink-0" />
          <span className="flex-1 text-xs">Stats Dashboard</span>
          <DropdownMenuShortcut className="font-mono text-[10px] text-[var(--app-text-dim)]">S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenCompare}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
          title="Compare Jobs"
        >
          <GitCompare className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
          <span className="flex-1 text-xs">Compare Designs</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-[var(--app-border-subtle)] my-1" />

        {/* Group 2: Configuration & Appearance */}
        <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--app-text-dim)] px-2 py-1">
          Preferences & System
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onOpenSettings('providers')}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <Cpu className="w-3.5 h-3.5 text-[var(--app-accent-text)] shrink-0" />
          <span className="flex-1 text-xs">Model Providers</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onOpenSettings('theme')}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <Palette className="w-3.5 h-3.5 text-[var(--app-accent)] shrink-0" />
          <span className="flex-1 text-xs">Theme & Styling</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenShortcuts}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <Keyboard className="w-3.5 h-3.5 text-[var(--app-text-muted)] shrink-0" />
          <span className="flex-1 text-xs">Shortcuts Guide</span>
          <DropdownMenuShortcut className="font-mono text-[10px] text-[var(--app-text-dim)]">?</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-[var(--app-border-subtle)] my-1" />

        {/* Group 3: Commands & Data Export */}
        <DropdownMenuItem
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <Zap className="w-3.5 h-3.5 text-yellow-500 dark:text-yellow-400 shrink-0" />
          <span className="flex-1 text-xs">Command Palette</span>
          <DropdownMenuShortcut className="font-mono text-[10px] text-[var(--app-text-dim)]">⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onExportAllData}
          className="flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded-[4px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
        >
          <Download className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
          <span className="flex-1 text-xs">Export All Data</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
