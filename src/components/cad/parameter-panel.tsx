'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Wrench, Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Job, ParameterDef, ParameterSchema, parseJSON, safeNum } from './types'
import { updateParameters } from './api'
import { staggerContainer, staggerChild, staggerTransition, slideInLeft, slideInLeftTransition } from './motion-presets'
import { extractParameterDefsFromScad } from '@/lib/tools/scad-parameter-extractor'

export function ParameterPanel({
  job,
  onUpdate,
  onPreviewUpdate,
}: {
  job: Job
  onUpdate: () => void | Promise<void>
  onPreviewUpdate?: (parameterValues: Record<string, number>) => void
}) {
  // The parameterSchema in the DB can be either:
  // - A ParameterSchema object { part_family, design_summary, parameters: [...] }
  // - A raw ParameterDef[] array (from the process route)
  // Handle both formats
  const rawSchema = parseJSON<ParameterSchema | ParameterDef[] | null>(job.parameterSchema, null)
  const values = parseJSON<Record<string, number>>(job.parameterValues, {})
  const [localValues, setLocalValues] = useState(values)
  const [isUpdating, setIsUpdating] = useState(false)
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set())


  useEffect(() => {
    setLocalValues(values)
    setChangedKeys(new Set())
  }, [job.parameterValues])

  // Normalize schema: if it's a raw array, wrap it in a ParameterSchema object
  let schema: ParameterSchema | null = null
  if (rawSchema) {
    if (Array.isArray(rawSchema)) {
      schema = { part_family: 'unknown', design_summary: '', parameters: rawSchema as ParameterDef[] }
    } else if (rawSchema.parameters && Array.isArray(rawSchema.parameters)) {
      schema = rawSchema as ParameterSchema
    }
  }
  if ((!schema || schema.parameters.length === 0) && job.scadSource) {
    const extracted = extractParameterDefsFromScad(job.scadSource) as ParameterDef[]
    if (extracted.length > 0) {
      schema = {
        part_family: job.partFamily || 'unknown',
        design_summary: 'Parameters parsed from top-level OpenSCAD assignments',
        parameters: extracted,
      }
    }
  }

  const handleResetAll = useCallback(async () => {
    if (!schema) return
    const defaults: Record<string, number> = {}
    for (const p of schema.parameters) {
      defaults[p.key] = p.value
    }
    setLocalValues(defaults)
    setChangedKeys(new Set())
    onPreviewUpdate?.(defaults)
    setIsUpdating(true)
    try {
      await updateParameters(job.id, defaults)
      onUpdate()
      toast.success('Parameters reset', { description: 'All parameters reset to defaults' })
    } catch (err) {
      console.error('Parameter reset failed:', err)
      toast.error('Reset failed', { description: 'Failed to reset parameters' })
    } finally {
      setIsUpdating(false)
    }
  }, [schema, job.id, onPreviewUpdate, onUpdate])

  if (!schema) return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--cad-text-muted)] gap-3 p-6">
      <div className="w-12 h-12 rounded border border-[color:var(--cad-border-strong)] flex items-center justify-center opacity-40">
        <Wrench className="w-6 h-6" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">No parameters available</p>
        <p className="text-[13px] text-[var(--cad-text-muted)] mt-1">Process a job to generate parameters</p>
      </div>
    </div>
  )

  const groups = [...new Set(schema.parameters.map(p => p.group || 'general'))]
  const meaningfulSources = new Set(schema.parameters.map(p => p.source).filter(source => source && source !== 'artifact'))
  const showSourceBadges = meaningfulSources.size > 0 && new Set(schema.parameters.map(p => p.source).filter(Boolean)).size > 1

  const handleParamChange = (key: string, value: number, defaultValue: number) => {
    const newValues = { ...localValues, [key]: value }
    setLocalValues(newValues)
    onPreviewUpdate?.(newValues)
    // Track changed keys for pulse animation
    if (value !== defaultValue) {
      setChangedKeys(prev => new Set(prev).add(key))
    } else {
      setChangedKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const handleParamCommit = async (key: string, value: number) => {
    const newValues = { ...localValues, [key]: value }
    setIsUpdating(true)
    try {
      await updateParameters(job.id, newValues)
      onUpdate()
      toast.success('Parameter saved', {
        description: `Set ${key} to ${value}`,
      })
    } catch (err) {
      console.error('Parameter update failed:', err)
      toast.error('Render failed', {
        description: err instanceof Error ? err.message : 'Failed to save parameter change',
        duration: 4000,
      })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleResetParam = async (key: string, defaultValue: number) => {
    const newValues = { ...localValues, [key]: defaultValue }
    setLocalValues(newValues)
    setChangedKeys(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    onPreviewUpdate?.(newValues)
    setIsUpdating(true)
    try {
      await updateParameters(job.id, newValues)
      onUpdate()
      toast.success('Parameter reset', { description: `${key} reset to default` })
    } catch (err) {
      console.error('Parameter reset failed:', err)
      toast.error('Reset failed', { description: 'Failed to reset parameter' })
    } finally {
      setIsUpdating(false)
    }
  }

  const sourceColor: Record<string, string> = {
    user: 'text-[var(--cad-info)]',
    inferred: 'text-[var(--cad-warning)]',
    design_derived: 'text-[var(--cad-accent)]',
    engineering: 'text-[var(--cad-success)]',
    derived: 'text-[var(--cad-info)]',
    llm_declared: 'text-[var(--cad-success)]',
  }
  const sourceLabel: Record<string, string> = {
    user: 'user',
    inferred: 'inferred',
    design_derived: 'design',
    engineering: 'engineering',
    derived: 'derived',
    llm_declared: 'model',
  }
  const changedCount = changedKeys.size

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-3 py-1.5">
        <h3 className="text-[13px] font-mono tracking-widest text-[var(--app-text-muted)] uppercase">Parameters</h3>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {changedCount > 0 && (
            <Badge variant="outline" className="text-xs h-4 bg-[var(--cad-accent-soft)] text-[var(--cad-accent)] border-[color:var(--cad-border)]">
              {changedCount} changed
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-xs gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-accent-text)]"
            onClick={handleResetAll}
            disabled={isUpdating}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reset All
          </Button>
          <Badge variant="outline" className="text-xs h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
            {schema.parameters.length} params
          </Badge>
          {isUpdating && (
            <span className="flex items-center gap-1 text-xs font-mono text-[var(--cad-measure)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              saving
            </span>
          )}
        </div>
      </div>
      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto">
        <motion.div
          className="space-y-2.5 p-2.5 pb-16"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {groups.map((group, groupIdx) => (
            <motion.div
              key={group}
              variants={staggerChild}
              transition={staggerTransition}
              className={`rounded-[8px] border border-[color:var(--app-border)] bg-[var(--app-surface)] px-2.5 py-2 ${groupIdx > 0 ? 'border-t-[color:var(--cad-accent-soft)]' : ''}`}
            >
              <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] font-medium uppercase text-[var(--app-text-dim)]">
                <div className="w-1 h-1 rounded-full bg-[var(--cad-accent)] opacity-70" />
                <span className="tracking-[0.08em]">{group}</span>
              </div>
              <motion.div
                className="space-y-1.5"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                {schema.parameters.filter(p => (p.group || 'general') === group).map(param => {
                  const min = safeNum(param.min, 0)
                  const max = safeNum(param.max, 100)
                  const step = safeNum(param.step, 1)
                  const value = safeNum(localValues[param.key], param.value)
                  const fillPercent = max > min ? ((value - min) / (max - min)) * 100 : 0
                  const isChanged = changedKeys.has(param.key) || (localValues[param.key] !== undefined && localValues[param.key] !== param.value)
                  const delta = value - safeNum(param.value, 0)
                  const precision = step < 1 ? 1 : 0

                  return (
                    <motion.div
                      key={param.key}
                      variants={slideInLeft}
                      transition={{ ...slideInLeftTransition, delay: 0.02 }}
                      className={`group/param relative rounded-[6px] px-1 py-1 ring-1 transition-[box-shadow] ${isChanged ? 'bg-[var(--cad-accent-soft)]/40 ring-[color:var(--cad-accent-soft)]' : 'ring-transparent hover:bg-[var(--app-surface-hover)]'}`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-[var(--app-text-secondary)] transition-colors group-hover/param:text-[var(--app-text-primary)]">{param.label}</span>
                          {showSourceBadges && param.source !== 'artifact' && (
                            <span
                              className={`rounded bg-[var(--app-surface-raised)] px-1 py-0.5 text-[9px] font-mono ${sourceColor[param.source] || 'text-[var(--app-text-muted)]'}`}
                              title={`Source: ${sourceLabel[param.source] || param.source.replace('_', ' ')}`}
                            >
                              {sourceLabel[param.source] || param.source.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        <div className="grid shrink-0 grid-cols-[4.5rem_2rem_2.75rem_1.25rem] items-center justify-items-end gap-1">
                          <motion.span
                            className="text-[13px] font-mono text-[var(--app-text-primary)] tabular-nums"
                            key={value}
                            initial={{ scale: 1.15, color: 'var(--cad-accent)' }}
                            animate={{ scale: 1, color: 'var(--cad-text)' }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                          >
                            {typeof localValues[param.key] === 'number' ? localValues[param.key].toFixed(precision) : param.value?.toFixed(precision) ?? '0'}
                          </motion.span>
                          <span className="justify-self-start text-[12px] text-[var(--app-text-dim)]">{param.unit}</span>
                          <span className={`rounded px-1 py-0.5 text-[8px] font-mono ${isChanged ? 'bg-[var(--cad-accent-soft)] text-[var(--cad-accent)]' : 'text-transparent'}`}>
                            {isChanged ? (
                              <>
                              {delta > 0 ? '+' : ''}{delta.toFixed(precision)}
                              </>
                            ) : '+0'}
                          </span>
                          {/* Reset to default button - appears on hover */}
                          <button
                            onClick={() => handleResetParam(param.key, param.value)}
                            className={`rounded p-0.5 transition-colors ${isChanged ? 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-accent-text)]' : 'pointer-events-none text-transparent'}`}
                            title="Reset to default"
                            aria-hidden={!isChanged}
                            tabIndex={isChanged ? 0 : -1}
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                      {param.kind === 'number' || param.kind === 'float' || param.kind === 'integer' ? (
                        <div className="relative py-1">
                          {/* Custom colored fill indicator behind the slider */}
                          <div className="absolute top-1/2 left-0 h-[7px] w-full -translate-y-1/2 overflow-hidden border-y border-[color:var(--app-border-subtle)] bg-[linear-gradient(90deg,var(--app-border-subtle)_1px,transparent_1px)] bg-[length:25%_100%] pointer-events-none">
                            <div
                              className="h-full bg-[color-mix(in_srgb,var(--cad-accent)_26%,transparent)] transition-all duration-150"
                              style={{ width: `${fillPercent}%` }}
                            />
                          </div>
                          <Slider
                            value={[value]}
                            min={min}
                            max={max}
                            step={step}
                            onValueChange={([v]) => handleParamChange(param.key, v, param.value)}
                            onValueCommit={([v]) => handleParamCommit(param.key, v)}
                            disabled={isUpdating || !param.editable}
                            className="relative z-10 py-0"
                          />
                          <div className="pointer-events-none absolute left-0 right-0 top-1/2 z-0 flex -translate-y-1/2 justify-between px-0.5">
                            {Array.from({ length: 5 }).map((_, idx) => (
                              <span key={idx} className="h-3 w-px bg-[var(--cad-border-strong)] opacity-55" />
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="flex justify-between text-[9px] text-[var(--app-text-dim)] font-mono leading-3">
                        <span>{min}</span>
                        <span className="max-w-[45%] truncate opacity-0 transition-opacity group-hover/param:opacity-100">{param.key}</span>
                        <span>{max} {param.unit}</span>
                      </div>
                      {param.description && (
                        <div className="pointer-events-none absolute left-1 top-full z-20 mt-1 hidden max-w-[calc(100%-0.5rem)] rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface)] px-2 py-1 text-[12px] leading-4 text-[var(--app-text-dim)] shadow-[0_8px_24px_rgba(15,23,42,0.12)] group-hover/param:block">
                          {param.description}
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

export function SchemaInfoPanel({ schemaStr }: { schemaStr: string }) {
  const rawSchema = parseJSON<ParameterSchema | ParameterDef[] | null>(schemaStr, null)
  // Normalize: handle both raw array and object format
  let schema: ParameterSchema | null = null
  if (rawSchema) {
    if (Array.isArray(rawSchema)) {
      schema = { part_family: 'unknown', design_summary: '', parameters: rawSchema as ParameterDef[] }
    } else if (rawSchema.parameters && Array.isArray(rawSchema.parameters)) {
      schema = rawSchema as ParameterSchema
    }
  }
  if (!schema) return <span className="text-[var(--app-text-dim)] text-xs">Invalid schema</span>

  const sourceCounts: Record<string, number> = {}
  for (const p of schema.parameters) {
    sourceCounts[p.source] = (sourceCounts[p.source] || 0) + 1
  }

  const sourceColor: Record<string, string> = {
    user: 'bg-[var(--cad-info)]/10 text-[var(--cad-info)] border-[color:var(--cad-info)]/20',
    inferred: 'bg-[var(--cad-warning)]/10 text-[var(--cad-warning)] border-[color:var(--cad-warning)]/20',
    design_derived: 'bg-[var(--cad-accent-soft)] text-[var(--cad-accent)] border-[color:var(--cad-border)]',
    engineering: 'bg-[var(--cad-success)]/10 text-[var(--cad-success)] border-[color:var(--cad-success)]/20',
    derived: 'bg-[var(--cad-info)]/10 text-[var(--cad-info)] border-[color:var(--cad-info)]/20',
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[8px] h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
          {schema.part_family || 'unknown'}
        </Badge>
        <Badge variant="outline" className="text-[8px] h-4 bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]">
          {schema.parameters.length} params
        </Badge>
        {Object.entries(sourceCounts).map(([source, count]) => (
          <Badge key={source} variant="outline" className={`text-[8px] h-4 ${sourceColor[source] || 'bg-[var(--app-surface-raised)] text-[var(--app-text-muted)] border-[color:var(--app-border)]'}`}>
            {count} {source.replace('_', ' ')}
          </Badge>
        ))}
      </div>
      {schema.design_summary && (
        <p className="text-[13px] text-[var(--app-text-muted)] leading-relaxed">{schema.design_summary}</p>
      )}
    </div>
  )
}
