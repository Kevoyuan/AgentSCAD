'use client'

import { useMemo } from 'react'

// ─── Tag Badge Colors ──────────────────────────────────────────────────────

const TAG_COLORS = [
  { bg: 'bg-zinc-500/15', text: 'text-zinc-300', border: 'border-zinc-500/20' },
  { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/20' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/20' },
  { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20' },
]

// Simple hash function for consistent color assignment
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

// ─── Parse tags from customerId field ──────────────────────────────────────

export function parseTags(customerId: string | null): string[] {
  if (!customerId) return []
  if (customerId.startsWith('tags:')) {
    const tagsStr = customerId.slice(5)
    return tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0)
  }
  return []
}

export function buildCustomerId(tags: string[]): string {
  if (tags.length === 0) return ''
  return `tags:${tags.join(',')}`
}

// ─── Single Tag Badge ──────────────────────────────────────────────────────

function TagBadge({ tag, index }: { tag: string; index: number }) {
  const colorIndex = hashString(tag) % TAG_COLORS.length
  const color = TAG_COLORS[colorIndex]

  return (
    <span
      className={`tag-badge inline-flex items-center px-1.5 py-0 rounded-full text-[8px] font-mono border ${color.bg} ${color.text} ${color.border}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {tag}
    </span>
  )
}

// ─── Tag Badges Component ──────────────────────────────────────────────────

interface TagBadgesProps {
  customerId: string | null
  maxDisplay?: number
}

export function TagBadges({ customerId, maxDisplay = 3 }: TagBadgesProps) {
  const tags = useMemo(() => parseTags(customerId), [customerId])

  if (tags.length === 0) return null

  const displayTags = tags.slice(0, maxDisplay)
  const remaining = tags.length - maxDisplay

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {displayTags.map((tag, i) => (
        <TagBadge key={tag} tag={tag} index={i} />
      ))}
      {remaining > 0 && (
        <span className="text-[7px] text-[var(--app-text-dim)] font-mono">+{remaining}</span>
      )}
    </div>
  )
}
