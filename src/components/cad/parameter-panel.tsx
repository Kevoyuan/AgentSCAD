'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Wrench, Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Job, ParameterDef, ParameterSchema, parseJSON, safeNum } from './types'
import { updateParameters } from './api'
import { staggerContainer, staggerChild, staggerTransition, slideInLeft, slideInLeftTransition } from './motion-presets'
import { extractParameterDefsFromScad } from '@/lib/tools/scad-parameter-extractor'

// ─── Precision & Alignment Utilities ─────────────────────────────────────────

export function getPrecision(
  step: number,
  min: number | string = 0,
  kind?: string
): number {
  let minNum = 0
  let kindStr = kind

  if (typeof min === 'string') {
    kindStr = min
    minNum = 0
  } else if (typeof min === 'number') {
    minNum = min
  }

  if (kindStr === 'integer') return 0

  const getDecimals = (num: number) => {
    const str = num.toString()
    const dot = str.indexOf('.')
    return dot >= 0 ? str.length - dot - 1 : 0
  }

  const stepDecimals = getDecimals(step)
  const minDecimals = getDecimals(minNum)
  const maxDecimals = Math.max(stepDecimals, minDecimals)

  if (maxDecimals > 0) {
    return Math.min(maxDecimals, 4)
  }

  return kindStr === 'float' ? 1 : 0
}

export function clampAndAlign(
  val: number,
  min: number,
  max: number,
  step: number,
  kind?: string,
  precision: number = 0
): number {
  if (isNaN(val) || !Number.isFinite(val)) {
    return min
  }
  const maxAligned = step > 0 ? min + Math.floor((max - min) / step) * step : max
  const clamped = Math.max(min, Math.min(max, val))
  let aligned = clamped
  if (step > 0) {
    const offset = clamped - min
    const stepsCount = Math.round(offset / step)
    aligned = min + stepsCount * step
  }
  if (kind === 'integer') {
    aligned = Math.round(aligned)
  }
  const rounded = Number(aligned.toFixed(precision))
  return Math.max(min, Math.min(maxAligned, rounded))
}

// ─── ParameterRow Component ──────────────────────────────────────────────────

interface ParameterRowProps {
  param: ParameterDef
  currentValue: number
  isChanged: boolean
  isUpdating: boolean
  showSourceBadges: boolean
  sourceColor: Record<string, string>
  sourceLabel: Record<string, string>
  onChange: (key: string, value: number, defaultValue: number) => void
  onCommit: (key: string, value: number) => void
  onReset: (key: string, defaultValue: number) => void
}

function ParameterRow({
  param,
  currentValue,
  isChanged,
  isUpdating,
  showSourceBadges,
  sourceColor,
  sourceLabel,
  onChange,
  onCommit,
  onReset,
}: ParameterRowProps) {
  const min = safeNum(param.min, 0)
  const max = safeNum(param.max, 100)
  const step = safeNum(param.step, 1)
  const precision = getPrecision(step, min, param.kind)
  const isNumeric = param.kind === 'number' || param.kind === 'float' || param.kind === 'integer' || !param.kind

  const [prevCurrentValue, setPrevCurrentValue] = useState(currentValue)
  const [prevPrecision, setPrevPrecision] = useState(precision)
  const [draftValue, setDraftValue] = useState<string>(() => currentValue.toFixed(precision))
  const [isFocused, setIsFocused] = useState(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isEscapingRef = useRef(false)
  const initialFocusValueRef = useRef<number>(currentValue)

  if (!isFocused && (prevCurrentValue !== currentValue || prevPrecision !== precision)) {
    setPrevCurrentValue(currentValue)
    setPrevPrecision(precision)
    setDraftValue(currentValue.toFixed(precision))
  }

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const fillPercent = max > min ? ((currentValue - min) / (max - min)) * 100 : 0
  const delta = currentValue - safeNum(param.value, 0)

  const scheduleDebounceCommit = useCallback((numVal: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      const finalVal = clampAndAlign(numVal, min, max, step, param.kind, precision)
      onCommit(param.key, finalVal)
    }, 400)
  }, [min, max, step, param.kind, precision, param.key, onCommit])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawText = e.target.value
    setDraftValue(rawText)

    const parsed = parseFloat(rawText)
    if (!isNaN(parsed) && Number.isFinite(parsed)) {
      const clampedForSlider = Math.max(min, Math.min(max, parsed))
      onChange(param.key, clampedForSlider, param.value)
      scheduleDebounceCommit(parsed)
    }
  }

  const commitInput = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const parsed = parseFloat(draftValue)
    const finalVal = clampAndAlign(
      isNaN(parsed) ? currentValue : parsed,
      min,
      max,
      step,
      param.kind,
      precision
    )
    setDraftValue(finalVal.toFixed(precision))
    onChange(param.key, finalVal, param.value)
    onCommit(param.key, finalVal)
  }, [draftValue, currentValue, min, max, step, param.kind, precision, param.key, param.value, onChange, onCommit])

  const handleBlur = () => {
    setIsFocused(false)
    if (isEscapingRef.current) {
      isEscapingRef.current = false
      const restored = initialFocusValueRef.current
      setDraftValue(restored.toFixed(precision))
      onChange(param.key, restored, param.value)
      return
    }
    commitInput()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      isEscapingRef.current = true
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      const restored = initialFocusValueRef.current
      setDraftValue(restored.toFixed(precision))
      onChange(param.key, restored, param.value)
      setIsFocused(false)
      e.currentTarget.blur()
    }
  }

  const handleSliderChange = ([v]: number[]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setDraftValue(v.toFixed(precision))
    onChange(param.key, v, param.value)
  }

  const handleSliderCommit = ([v]: number[]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    const finalVal = clampAndAlign(v, min, max, step, param.kind, precision)
    setDraftValue(finalVal.toFixed(precision))
    onCommit(param.key, finalVal)
  }

  const isDimensionless =
    param.key.startsWith('$') ||
    param.key.toLowerCase().includes('fn') ||
    param.key.toLowerCase().includes('count') ||
    param.key.toLowerCase().includes('teeth') ||
    param.key.toLowerCase().includes('segments') ||
    param.key.toLowerCase().includes('facets') ||
    param.key.toLowerCase().includes('steps') ||
    param.key.toLowerCase().includes('qty') ||
    param.key.toLowerCase().includes('num') ||
    param.key.toLowerCase().includes('ratio') ||
    param.key.toLowerCase().includes('scale')
  const displayUnit = isDimensionless ? '' : param.unit

  return (
    <motion.div
      key={param.key}
      variants={slideInLeft}
      transition={{ ...slideInLeftTransition, delay: 0.02 }}
      className={`group/param relative rounded-[6px] px-2 py-1.5 transition-all ${
        isChanged
          ? 'bg-[var(--cad-accent-soft)]/20 border border-[color:var(--cad-accent-soft)]'
          : 'border border-transparent hover:bg-[var(--app-surface-hover)] hover:border-[color:var(--app-border-subtle)]'
      }`}
    >
      {/* Line 1: Label and Integrated Numeric Input with Unit */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {isChanged && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cad-accent)]"
              title="Parameter modified from default"
            />
          )}
          <span className="truncate text-[12px] font-medium text-[var(--app-text-primary)] transition-colors">
            {param.label}
          </span>
          {showSourceBadges && param.source !== 'artifact' && (
            <span
              className={`rounded bg-[var(--app-surface-raised)] px-1 py-0.2 text-[9px] font-mono uppercase ${
                sourceColor[param.source] || 'text-[var(--app-text-muted)]'
              }`}
              title={`Source: ${sourceLabel[param.source] || param.source.replace('_', ' ')}`}
            >
              {sourceLabel[param.source] || param.source.replace('_', ' ')}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isChanged && (
            <>
              <span className="rounded bg-[var(--cad-accent-soft)] px-1.5 py-0.5 text-[9px] font-mono font-medium text-[var(--cad-accent)] tabular-nums">
                {delta > 0 ? `+${delta.toFixed(precision)}` : delta.toFixed(precision)}
              </span>
              <button
                onClick={() => onReset(param.key, param.value)}
                className="rounded p-0.5 text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text-primary)] transition-colors cursor-pointer"
                title="Reset to default"
                aria-label={`Reset ${param.label}`}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}

          {/* Integrated numeric input with inline unit */}
          <div className="flex h-6 items-center rounded border border-[color:var(--app-border)] bg-[var(--app-surface-raised)] px-1.5 focus-within:border-[var(--cad-accent)] focus-within:ring-1 focus-within:ring-[var(--cad-accent)] transition-all">
            {isNumeric ? (
              <Input
                type="number"
                value={draftValue}
                min={min}
                max={max}
                step={step}
                disabled={!param.editable}
                onFocus={() => {
                  setIsFocused(true)
                  initialFocusValueRef.current = currentValue
                }}
                onChange={handleInputChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="h-full w-14 border-0 bg-transparent p-0 text-right font-mono text-[12px] font-medium text-[var(--app-text-primary)] tabular-nums shadow-none focus-visible:ring-0 focus-visible:border-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label={`${param.label} numeric input`}
              />
            ) : (
              <span className="font-mono text-[12px] text-[var(--app-text-primary)] tabular-nums">
                {currentValue.toFixed(precision)}
              </span>
            )}
            {displayUnit && (
              <span className="ml-1 select-none font-mono text-[11px] text-[var(--app-text-dim)]">
                {displayUnit}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Line 2: Precision Slider with Inline Min and Max */}
      {isNumeric && (
        <div className="mt-1 flex items-center gap-2">
          <span className="w-6 shrink-0 text-right font-mono text-[9px] text-[var(--app-text-dim)] tabular-nums">
            {min}
          </span>
          <div className="relative min-w-0 flex-1">
            <Slider
              value={[currentValue]}
              min={min}
              max={max}
              step={step}
              onValueChange={handleSliderChange}
              onValueCommit={handleSliderCommit}
              disabled={isUpdating || !param.editable}
              className="cursor-pointer"
            />
          </div>
          <span className="w-12 shrink-0 truncate font-mono text-[9px] text-[var(--app-text-dim)] tabular-nums">
            {max}{displayUnit ? ` ${displayUnit}` : ''}
          </span>
        </div>
      )}

      {param.description && (
        <div className="pointer-events-none absolute top-full left-2 z-20 mt-1 hidden max-w-[calc(100%-1rem)] rounded-[6px] border border-[color:var(--app-border)] bg-[var(--app-surface)] px-2 py-1 text-[11px] leading-4 text-[var(--app-text-secondary)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] group-hover/param:block">
          {param.description}
        </div>
      )}
    </motion.div>
  )
}

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
  const isSingleDefaultGroup =
    groups.length === 1 &&
    (groups[0].toLowerCase() === 'general' || groups[0].toLowerCase() === 'parameters')

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--app-surface)]">
      {/* Sleek Parameter Header */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider font-mono text-[var(--app-text-primary)]">
            Parameters
          </h3>
          <span className="rounded-[4px] bg-[var(--app-surface-raised)] border border-[color:var(--app-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--app-text-muted)] tabular-nums">
            {schema.parameters.length}
          </span>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {changedCount > 0 && (
            <span className="rounded bg-[var(--cad-accent-soft)] px-1.5 py-0.5 text-[10px] font-mono font-medium text-[var(--cad-accent)] tabular-nums">
              {changedCount} modified
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-mono gap-1 text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-raised)] transition-colors cursor-pointer"
            onClick={handleResetAll}
            disabled={isUpdating}
          >
            <RotateCcw className="w-3 h-3" />
            Reset All
          </Button>
          {isUpdating && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--cad-accent)]">
              <Loader2 className="w-3 h-3 animate-spin" />
              saving
            </span>
          )}
        </div>
      </div>

      {/* Parameter List */}
      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <motion.div
          className="space-y-1 pb-12"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {groups.map((group) => {
            const groupParams = schema.parameters.filter(p => (p.group || 'general') === group)
            return (
              <div key={group} className="space-y-1">
                {!isSingleDefaultGroup && (
                  <div className="mb-1.5 mt-3 first:mt-1 flex items-center gap-1.5 px-1 border-b border-[color:var(--app-border-subtle)] pb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--cad-accent)]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider font-mono text-[var(--app-text-muted)]">
                      {group}
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  {groupParams.map(param => {
                    const value = safeNum(localValues[param.key], param.value)
                    const isChanged = changedKeys.has(param.key) || (localValues[param.key] !== undefined && localValues[param.key] !== param.value)

                    return (
                      <ParameterRow
                        key={param.key}
                        param={param}
                        currentValue={value}
                        isChanged={isChanged}
                        isUpdating={isUpdating}
                        showSourceBadges={showSourceBadges}
                        sourceColor={sourceColor}
                        sourceLabel={sourceLabel}
                        onChange={handleParamChange}
                        onCommit={handleParamCommit}
                        onReset={handleResetParam}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
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
