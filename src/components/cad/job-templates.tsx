'use client'

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
    name: '电子外壳',
    description: '给电路板用的参数化盒体',
    template: '一个 {width}×{depth}×{height} mm 的电子外壳,壁厚 {wall} mm,卡扣盖,M3 安装孔',
    icon: CircuitBoard,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'spur-gear',
    name: '直齿轮',
    description: '标准渐开线齿形',
    template: '一个 {teeth} 齿的直齿轮,孔径 {bore} mm,齿宽 {faceWidth} mm',
    icon: Cog,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'phone-stand',
    name: '手机支架',
    description: '可调视角的桌面支架',
    template: '一个手机支架,适配宽 {width} mm、高 {height} mm 的机身,视角 {angle}°',
    icon: Smartphone,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'l-bracket',
    name: 'L 形支架',
    description: '直角结构支撑件',
    template: '一个 L 形支架,臂长 {arm} mm,壁厚 {wall} mm,带沉头孔',
    icon: Triangle,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'hex-bolt',
    name: '六角螺栓',
    description: '标准六角头紧固件',
    template: '一个六角螺栓,头径 {head} mm,杆长 {shaft} mm,螺纹 M{thread}',
    icon: Wrench,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
  {
    id: 'custom-pipe',
    name: '圆管',
    description: '空心圆柱管段',
    template: '一段长 {length} mm 的圆管,外径 {outerDiam} mm,内径 {innerDiam} mm',
    icon: Cylinder,
    color: 'text-[var(--shell-text-label)] group-hover:text-[var(--shell-text)]',
  },
]

export function JobTemplateCards({
  onSelect,
}: {
  onSelect: (template: string) => void
}) {
  return (
    <div className="space-y-2">
      {/* The tab above already says 模板, so this block needs no second label; the
          cards are the content. */}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {JOB_TEMPLATES.map((t) => {
          const Icon = t.icon
          return (
            <motion.button
              key={t.id}
              whileTap={{ scale: 0.98 }}
              className="group flex min-w-0 items-center gap-2.5 rounded-[6px] border border-[color:var(--shell-border)] bg-[var(--shell-module-solid)] p-2 text-left transition-colors hover:border-[color:var(--shell-border-strong)] hover:bg-[var(--shell-hover)]"
              onClick={() => onSelect(t.template)}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-[color:var(--shell-border)] bg-[var(--shell-well)]">
                <Icon className={`h-3.5 w-3.5 transition-colors ${t.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium leading-4 text-[var(--shell-text)]">{t.name}</p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-[var(--shell-text-muted)]">{t.description}</p>
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
