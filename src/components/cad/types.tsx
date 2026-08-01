import { Box, Code2, Shield, CheckCircle2 } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParameterDef {
  key: string
  label: string
  kind: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  source: string
  editable: boolean
  description: string
  group: string
}

export interface ParameterSchema {
  part_family: string
  design_summary: string
  parameters: ParameterDef[]
}

export interface ValidationResult {
  rule_id: string
  rule_name: string
  level: string
  passed: boolean
  is_critical: boolean
  message: string
  status?: 'PASS' | 'WARN' | 'FAIL' | 'SKIP' | 'ERROR' | 'NOT_RUN'
}

export type ValidationEvidenceStatus = NonNullable<ValidationResult['status']>

const VALIDATION_EVIDENCE_STATUSES = new Set<ValidationEvidenceStatus>([
  'PASS', 'WARN', 'FAIL', 'SKIP', 'ERROR', 'NOT_RUN',
])

/** Normalize new status-aware payloads while preserving legacy stored jobs. */
export function getValidationEvidenceStatus(result: ValidationResult): ValidationEvidenceStatus {
  const explicit = result.status?.toUpperCase() as ValidationEvidenceStatus | undefined
  if (explicit && VALIDATION_EVIDENCE_STATUSES.has(explicit)) return explicit
  if (/^skipped\b/i.test(result.message.trim())) return 'SKIP'
  return result.passed ? 'PASS' : 'FAIL'
}

export interface ExecutionLog {
  timestamp: string
  event: string
  message: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  images?: string[]
}

export interface Job {
  id: string
  state: string
  inputRequest: string
  customerId: string | null
  modelId: string | null
  partFamily: string | null
  builderName: string | null
  generationPath: string | null
  scadSource: string | null
  parameterSchema: string | null
  parameterValues: string | null
  researchResult: string | null
  intentResult: string | null
  designResult: string | null
  stlPath: string | null
  pngPath: string | null
  renderLog: string | null
  validationResults: string | null
  validationReportJson?: string | null
  visualRepairReportJson?: string | null
  qualityScore?: number | null
  executionLogs: string | null
  notes: string | null
  parentId: string | null
  retryCount: number
  maxRetries: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const STATE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string; hex: string }> = {
  NEW: { bg: 'bg-[var(--app-state-neutral-bg)]', text: 'text-[var(--app-state-neutral-text)]', dot: 'bg-[var(--app-state-neutral-dot)]', border: 'border-[color:var(--app-state-neutral-border)]', hex: '#94a3b8' },
  SCAD_GENERATED: { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400', border: 'border-amber-500/30', hex: '#fbbf24' },
  RENDERED: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', dot: 'bg-cyan-400', border: 'border-cyan-500/30', hex: '#22d3ee' },
  VALIDATED: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-500/30', hex: '#34d399' },
  DELIVERED: { bg: 'bg-lime-500/20', text: 'text-lime-300', dot: 'bg-lime-400', border: 'border-lime-500/30', hex: '#a3e635' },
  DEBUGGING: { bg: 'bg-orange-500/20', text: 'text-orange-300', dot: 'bg-orange-400', border: 'border-orange-500/30', hex: '#fb923c' },
  REPAIRING: { bg: 'bg-orange-500/20', text: 'text-orange-300', dot: 'bg-orange-400', border: 'border-orange-500/30', hex: '#fb923c' },
  VALIDATION_FAILED: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400', border: 'border-rose-500/30', hex: '#fb7185' },
  GEOMETRY_FAILED: { bg: 'bg-red-500/20', text: 'text-red-300', dot: 'bg-red-400', border: 'border-red-500/30', hex: '#f87171' },
  RENDER_FAILED: { bg: 'bg-red-500/20', text: 'text-red-300', dot: 'bg-red-400', border: 'border-red-500/30', hex: '#f87171' },
  HUMAN_REVIEW: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', dot: 'bg-yellow-400', border: 'border-yellow-500/30', hex: '#facc15' },
  CANCELLED: { bg: 'bg-[var(--app-state-neutral-bg)]', text: 'text-[var(--app-state-neutral-text)]', dot: 'bg-[var(--app-state-neutral-dot)]', border: 'border-[color:var(--app-state-neutral-border)]', hex: '#71717a' },
}

export function getStateHex(state: string): string {
  return STATE_COLORS[state]?.hex || '#71717a'
}

export function InboxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

export const PIPELINE_STEPS = [
  { key: 'NEW', label: 'INTAKE', icon: InboxIcon },
  { key: 'SCAD_GENERATED', label: 'GENERATE', icon: Code2 },
  { key: 'RENDERED', label: 'RENDER', icon: Box },
  { key: 'VALIDATED', label: 'VALIDATE', icon: Shield },
  { key: 'DELIVERED', label: 'DELIVER', icon: CheckCircle2 },
]

export const FILTER_STATES = [
  { key: 'ALL', label: 'ALL' },
  { key: 'NEW', label: 'NEW' },
  { key: 'HUMAN_REVIEW', label: 'REVIEW' },
  { key: 'DELIVERED', label: 'DONE' },
  { key: 'FAILED', label: 'BLOCKED', stateKey: 'VALIDATION_FAILED' },
]

export const CANCELABLE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function timeAgo(iso: string) {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export function getStateInfo(state: string) {
  return STATE_COLORS[state] || { bg: 'bg-[var(--app-state-neutral-bg)]', text: 'text-[var(--app-state-neutral-text)]', dot: 'bg-[var(--app-state-neutral-dot)]', border: 'border-[color:var(--app-state-neutral-border)]' }
}

export function parseJSON<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

export function getPipelineProgress(state: string): number {
  const idx = PIPELINE_STEPS.findIndex(s => s.key === state)
  if (idx === -1) return 0
  return Math.round(((idx + 1) / PIPELINE_STEPS.length) * 100)
}

export function safeNum(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !isNaN(val)) return val
  return fallback
}
