'use client'

import { useEffect } from 'react'
import { Job } from '@/components/cad/types'

export function KeyboardShortcuts({
  selectedJob,
  showComposer,
  onShowComposer,
  onShowCommandPalette,
  onShowShortcuts,
  onShowStats,
  onShowCompare,
  onShowSettings,
  onCloseAll,
  onSetActiveTab,
  onDelete,
  onProcess,
  onToggleSidebar,
  onToggleInspector,
  onToggleFocusMode,
}: {
  selectedJob: Job | null
  showComposer: boolean
  onShowComposer: (show: boolean) => void
  onShowCommandPalette: (show: boolean) => void
  onShowShortcuts: (show: boolean) => void
  onShowStats: (show: boolean) => void
  onShowCompare: (show: boolean) => void
  onShowSettings: (show: boolean) => void
  onCloseAll: () => void
  onSetActiveTab: (tab: string) => void
  onDelete: (id: string) => void
  onProcess: (job: Job) => void
  onToggleSidebar?: () => void
  onToggleInspector?: () => void
  onToggleFocusMode?: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // Ctrl+Shift+N: New job with focus on textarea
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        onShowComposer(true)
        setTimeout(() => {
          const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-textarea]')
          if (textarea) textarea.focus()
        }, 100)
        return
      }

      // Cmd+K / Ctrl+K: Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onShowCommandPalette(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        onShowComposer(true)
        return
      }
      if (e.key === 'Escape') {
        onCloseAll()
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isInputFocused) {
        onShowShortcuts(true)
      }
      if (e.key === 'Delete' && selectedJob && !showComposer && !isInputFocused) {
        onDelete(selectedJob.id)
      }
      // Space: Process selected job
      if (e.key === ' ' && selectedJob && !showComposer && !isInputFocused) {
        e.preventDefault()
        if (selectedJob.state === 'NEW') onProcess(selectedJob)
      }
      // E: Edit SCAD code
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onSetActiveTab('CODE')
      }
      // H: Show history (LOG tab)
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onSetActiveTab('HISTORY')
      }
      // S: Open stats dashboard
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onShowStats(true)
      }
      // T: Open theme settings
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onShowSettings(true)
      }
      // 1-6: Switch inspector tabs
      const tabMap: Record<string, string> = { '1': 'SPEC', '2': 'PARAMETERS', '3': 'ASSIST', '4': 'VALIDATION', '5': 'HISTORY', '6': 'CODE' }
      if (tabMap[e.key] && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onSetActiveTab(tabMap[e.key])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedJob, showComposer, onShowComposer, onShowCommandPalette, onShowShortcuts, onShowStats, onShowCompare, onShowSettings, onCloseAll, onSetActiveTab, onDelete, onProcess])

  // This component renders nothing
  return null
}
