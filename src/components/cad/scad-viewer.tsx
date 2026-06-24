'use client'

import { useState, useMemo } from 'react'
import { CheckCircle2, FileCode, Copy, Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { highlightScad } from '@/lib/scad-highlight'
import { copyText } from '@/lib/clipboard'

export function ScadViewer({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false)

  const lineCount = useMemo(() => {
    if (!code) return 0
    return code.split('\n').length
  }, [code])

  const highlightedCode = useMemo(() => {
    if (!code) return ''
    return highlightScad(code)
  }, [code])

  if (!code) return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--cad-text-muted)] gap-3 p-6">
      <div className="w-12 h-12 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
        <Box className="w-6 h-6" />
      </div>
      <p className="text-sm">No SCAD source</p>
    </div>
  )

  const handleCopy = async () => {
    const ok = await copyText(code)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const lines = highlightedCode.split('\n')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[color:var(--app-border)]">
        <h3 className="text-eyebrow text-[var(--app-text-muted)]">SCAD Source</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
            {lineCount} lines
          </Badge>
          <Button variant="ghost" size="sm" className="h-5 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]" onClick={handleCopy}>
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex">
          {/* Line numbers */}
          <div className="flex flex-col items-end pr-3 pl-4 py-4 select-none border-r border-[color:var(--app-border)]">
            {lines.map((_, idx) => (
              <span key={idx} className="text-[13px] font-mono leading-relaxed text-[var(--app-text-dim)]">
                {idx + 1}
              </span>
            ))}
          </div>
          {/* Code content */}
          <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto flex-1">
            <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          </pre>
        </div>
      </ScrollArea>
    </div>
  )
}
