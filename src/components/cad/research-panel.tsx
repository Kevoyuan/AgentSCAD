'use client'

import { motion } from 'framer-motion'
import { Beaker, Lightbulb, Globe, Target, Cpu, Layers, Info, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Job, parseJSON } from './types'
import { SchemaInfoPanel } from './parameter-panel'
import { fadeInUp, fadeInUpTransition, staggerContainer, staggerChild, staggerTransition, scaleIn, scaleInTransition } from './motion-presets'

export function ResearchPanel({ job }: { job: Job }) {
  const research = parseJSON<Record<string, unknown> | null>(job.researchResult, null)
  const intent = parseJSON<Record<string, unknown> | null>(job.intentResult, null)
  const design = parseJSON<Record<string, unknown> | null>(job.designResult, null)

  const hasData = research || intent || design

  if (!hasData) return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--cad-text-muted)] gap-3 p-6">
      <div className="w-12 h-12 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
        <Sparkles className="w-6 h-6" />
      </div>
      <div className="text-center">
        <p className="text-sm">No research data yet</p>
        <p className="text-[13px] text-[var(--app-text-dim)] mt-1">Process a job to generate research</p>
      </div>
    </div>
  )

  const sections = [
    { data: research, icon: Globe, label: 'Research', color: 'text-sky-400' },
    { data: intent, icon: Lightbulb, label: 'Intent', color: 'text-amber-400' },
    { data: design, icon: Beaker, label: 'Design', color: 'text-[var(--app-accent-text)]' },
  ]

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--app-border)] px-3 py-1.5">
        <h3 className="text-eyebrow text-[var(--app-text-muted)]">Research & Intent</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          className="space-y-3 p-3 pb-8"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {/* Part Family & Builder Tags */}
          <div className="flex items-center gap-2 flex-wrap">
            {job.partFamily && (
              <motion.div
                variants={scaleIn}
                transition={scaleInTransition}
              >
                <Badge variant="outline" className="text-xs h-5 bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border-[color:var(--app-accent-border)] gap-1">
                  <Target className="w-2.5 h-2.5" />{job.partFamily.replace(/_/g, ' ')}
                </Badge>
              </motion.div>
            )}
            {job.builderName && (
              <motion.div
                variants={scaleIn}
                transition={scaleInTransition}
              >
                <Badge variant="outline" className="text-xs h-5 bg-cyan-500/10 text-cyan-400 border-cyan-500/20 gap-1">
                  <Cpu className="w-2.5 h-2.5" />{job.builderName}
                </Badge>
              </motion.div>
            )}
            {job.generationPath && (
              <motion.div
                variants={scaleIn}
                transition={scaleInTransition}
              >
                <Badge variant="outline" className="text-xs h-5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1">
                  <Layers className="w-2.5 h-2.5" />{job.generationPath.replace(/_/g, ' ')}
                </Badge>
              </motion.div>
            )}
          </div>

          {/* Data Sections */}
          {sections.map(({ data, icon: Icon, label, color }) => data && (
            <motion.div
              key={label}
              variants={fadeInUp}
              transition={fadeInUpTransition}
              className="rounded-lg linear-surface linear-border overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-empty-bg)] border-b border-[color:var(--app-border)]">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className={`text-xs font-mono tracking-wider ${color} uppercase`}>{label}</span>
              </div>
              <div className="p-2.5 space-y-1.5">
                {Object.entries(data).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs font-mono text-[var(--app-text-dim)] min-w-[90px] shrink-0">{key}</span>
                    <span className="text-[13px] text-[var(--app-text-muted)] flex-1">
                      {Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value, null, 0) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}

          {/* Parameter Schema Summary */}
          {job.parameterSchema && (
            <motion.div
              variants={fadeInUp}
              transition={fadeInUpTransition}
              className="rounded-lg linear-surface linear-border overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--app-empty-bg)] border-b border-[color:var(--app-border)]">
                <Info className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-mono tracking-wider text-emerald-400 uppercase">Schema Info</span>
              </div>
              <div className="p-2.5">
                <SchemaInfoPanel schemaStr={job.parameterSchema} />
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
