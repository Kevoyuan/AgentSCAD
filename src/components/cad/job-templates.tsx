'use client'

import { useI18n } from '@/components/i18n-provider'

import { motion } from 'framer-motion'
import {
  Box, Cog, Smartphone, CircuitBoard, Triangle, Wrench, Cylinder,
} from 'lucide-react'

export interface JobTemplate {
  id: string
  name: string
  description: string
  template: string
  icon: React.ElementType
  color: string
}

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: 'electronics-enclosure',
    name: "Electronics enclosure",
    description: "Parametric enclosure for a circuit board",
    template: "An electronics enclosure measuring {width}×{depth}×{height} mm, with {wall} mm walls, a snap-fit lid and M3 mounting holes",
    icon: CircuitBoard,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'spur-gear',
    name: "Spur gear",
    description: "Standard involute teeth",
    template: "A spur gear with {teeth} teeth, a {bore} mm bore and {faceWidth} mm face width",
    icon: Cog,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'phone-stand',
    name: "Phone stand",
    description: "Desk stand with an adjustable viewing angle",
    template: "A phone stand for a device {width} mm wide and {height} mm tall, at a {angle}° viewing angle",
    icon: Smartphone,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'l-bracket',
    name: "L-bracket",
    description: "Right-angle structural support",
    template: "An L-bracket with {arm} mm arms, {wall} mm walls and countersunk holes",
    icon: Triangle,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'hex-bolt',
    name: "Hex bolt",
    description: "Standard hex-head fastener",
    template: "A hex bolt with a {head} mm head, a {shaft} mm shaft and an M{thread} thread",
    icon: Wrench,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'custom-pipe',
    name: "Pipe",
    description: "Hollow cylindrical tube",
    template: "A pipe {length} mm long, with a {outerDiam} mm outer diameter and {innerDiam} mm inner diameter",
    icon: Cylinder,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
]

export function JobTemplateCards({
  onSelect,
}: {
  onSelect: (template: string) => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-2">
      {/* The tab above already says 模板, so this block needs no second label; the
          cards are the content. */}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {JOB_TEMPLATES.map((template) => {
          const Icon = template.icon
          return (
            <motion.button
              key={template.id}
              whileTap={{ scale: 0.98 }}
              className="group flex min-w-0 items-center gap-2.5 rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-2 text-left transition-colors hover:border-[color:var(--shell-border-strong)] hover:bg-[var(--shell-hover)]"
              onClick={() => onSelect(t(template.template))}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--shell-border)] bg-[var(--shell-well)]">
                <Icon className={`h-3.5 w-3.5 transition-colors ${template.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium leading-4 text-[var(--shell-text)]">{t(template.name)}
</p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--shell-text-muted)]">{t(template.description)}
</p>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
