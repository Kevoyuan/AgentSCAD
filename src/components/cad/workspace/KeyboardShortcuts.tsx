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
      /*
       * Space, digits 1-6, 0 and F belong to the shell (MainWorkspace): Space hides
       * every module, the digits and F drive the camera. This file used to write the
       * same keys - Space toggled the same state a second time, and 1-6 set the old
       * inspector tabs - so one keypress had two owners (DESIGN.md section 22) and
       * the camera keys silently re-pointed a surface that is no longer on screen.
       * `e` / `h` set those same tab values and went with them.
       */
      // S: Open stats dashboard
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onShowStats(true)
      }
      // T: Open theme settings
      if (e.key === 't' && !e.metaKey && !e.ctrlKey && !isInputFocused && !showComposer) {
        onShowSettings(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedJob, showComposer, onShowComposer, onShowCommandPalette, onShowShortcuts, onShowStats, onShowCompare, onShowSettings, onCloseAll, onDelete, onProcess])

  // This component renders nothing
  return null
}
