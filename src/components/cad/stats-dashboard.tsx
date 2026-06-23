'use client'

/*
 * ─── JUNIOR DESIGNER ASSUMPTIONS & DESIGN DECISIONS ─────────────────────────
 * 1. Responsive Sparkline Viewboxing (Sparkline 响应式折线图)：
 *    将原本使用固定 width={400} 硬编码宽度的 Sparkline 升级为基于 viewBox 的 SVG
 *    响应式比例缩放布局，使其能够根据容器宽度动态伸缩，避免在小屏幕或窄容器中溢出。
 * 2. Metrics Grid Breakpoint Adaptation (指标网格响应式断点适配)：
 *    将看板的 Key Metrics 网格卡片由固定的 grid-cols-4 调整为 grid-cols-2 sm:grid-cols-4
 *    以便在视口不足时优雅折行，维持指标数值与进度环的舒展排版，避免挤压产生横向滚动。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  TrendingUp,
  Zap,
  AlertTriangle,
  XCircle,
  Plus,
  Ban,
  ArrowRight,
} from 'lucide-react'
import {
  fadeInUp,
  fadeInUpTransition,
  staggerContainer,
  staggerChild,
  staggerTransition,
  successPop,
  successPopTransition,
} from './motion-presets'
import { Job, STATE_COLORS, parseJSON, timeAgo } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatsData {
  totalJobs: number
  jobsByState: Record<string, number>
  avgProcessingTimeMs: number
  successRate: number
  jobsCreatedToday: number
  mostCommonPartFamily: string
  recentActivity: Array<{ hour: number; count: number }>
}

interface StatsDashboardProps {
  jobs: Job[]
  onClose?: () => void
}

// ─── Animated Counter ───────────────────────────────────────────────────────

function AnimatedCounter({
  value,
  duration = 1.2,
  className = '',
  decimals = 0,
  prefix = '',
  suffix = '',
}: {
  value: number
  duration?: number
  className?: string
  decimals?: number
  prefix?: string
  suffix?: string
}) {
  const [display, setDisplay] = useState(0)
  const prevValueRef = useRef(0)

  useEffect(() => {
    const startTime = Date.now()
    const startVal = prevValueRef.current
    const diff = value - startVal
    prevValueRef.current = value

    if (Math.abs(diff) < 0.01) return

    const step = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / (duration * 1000), 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(startVal + diff * eased)
      if (progress < 1) {
        requestAnimationFrame(step)
      }
    }

    const frameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameId)
  }, [value, duration])

  return (
    <span className={`tabular-nums ${className}`} aria-live="polite" aria-atomic="true">
      {prefix}
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display)}
      {suffix}
    </span>
  )
}

// ─── Progress Ring ──────────────────────────────────────────────────────────

function ProgressRing({
  value,
  size = 80,
  strokeWidth = 5,
  color = '#8b5cf6',
  label,
  sublabel,
}: {
  value: number // 0-100
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
  sublabel?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (value / 100) * circumference

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={label ? `${label}: ${Math.round(value)}%` : `${Math.round(value)}%`}>
        {/* Background ring with rotating dash pattern */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(63, 63, 70, 0.3)"
          strokeWidth={strokeWidth}
          strokeDasharray="4 6"
          className=""
        />
        {/* Progress ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        />
        {/* Glow effect */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          opacity={0.15}
          filter="blur(3px)"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-[var(--app-text-primary)] tabular-nums">
          <AnimatedCounter value={value} decimals={0} />
          <span className="text-xs text-[var(--app-text-muted)]">%</span>
        </span>
        {label && (
          <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-wider uppercase mt-0.5">
            {label}
          </span>
        )}
      </div>
      {sublabel && (
        <span className="absolute -bottom-4 text-xs font-mono text-[var(--app-text-dim)] tracking-wider">
          {sublabel}
        </span>
      )}
    </div>
  )
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({
  data,
  width = 200,
  height = 40,
  color = '#8b5cf6',
}: {
  data: Array<{ hour: number; count: number }>
  width?: number
  height?: number
  color?: string
}) {
  if (data.length === 0) return null

  const max = Math.max(...data.map((d) => d.count), 1)
  const padding = 2
  const chartW = width - padding * 2
  const chartH = height - padding * 2

  const points = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * chartW
    const y = padding + chartH - (d.count / max) * chartH
    return { x, y }
  })

  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ')

  const areaD =
    pathD +
    ` L ${points[points.length - 1].x} ${height - padding}` +
    ` L ${points[0].x} ${height - padding} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto overflow-visible"
      role="img"
      aria-label={`Activity sparkline: ${data.reduce((a, b) => a + b.count, 0)} jobs in last 24 hours`}
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path
        d={areaD}
        fill="url(#sparkGrad)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      <motion.path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      {/* Current value dot */}
      {points.length > 0 && (
        <motion.circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={2.5}
          fill={color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: 1 }}
        />
      )}
    </svg>
  )
}

// ─── State Distribution Bar ─────────────────────────────────────────────────

function StateDistributionBar({ jobsByState }: { jobsByState: Record<string, number> }) {
  const total = Object.values(jobsByState).reduce((a, b) => a + b, 0)
  if (total === 0) return null

  const stateOrder = [
    'NEW',
    'SCAD_GENERATED',
    'RENDERED',
    'VALIDATED',
    'DELIVERED',
    'VALIDATION_FAILED',
    'GEOMETRY_FAILED',
    'RENDER_FAILED',
    'CANCELLED',
  ]

  const segments = stateOrder
    .filter((s) => (jobsByState[s] || 0) > 0)
    .map((state) => ({
      state,
      count: jobsByState[state] || 0,
      pct: ((jobsByState[state] || 0) / total) * 100,
      color: STATE_COLORS[state]?.dot || 'bg-[var(--app-state-neutral-dot)]',
    }))

  return (
    <div className="space-y-2">
      <div className="h-2 rounded-full overflow-hidden flex bg-[var(--app-surface-hover)]">
        {segments.map((seg) => {
          const colorClass = seg.color.replace('bg-', '')
          const colorMap: Record<string, string> = {
            'slate-400': '#94a3b8',
            'amber-400': '#fbbf24',
            'cyan-400': '#22d3ee',
            'emerald-400': '#34d399',
            'lime-400': '#a3e635',
            'orange-400': '#fb923c',
            'rose-400': '#fb7185',
            'red-400': '#f87171',
            'yellow-400': '#facc15',
            'zinc-500': '#71717a',
            '[var(--app-state-neutral-dot)]': 'var(--app-state-neutral-dot)',
          }
          const hex = colorMap[colorClass] || 'var(--app-state-neutral-dot)'
          return (
            <motion.div
              key={seg.state}
              className="h-full"
              style={{ backgroundColor: hex }}
              initial={{ width: 0 }}
              animate={{ width: `${seg.pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              title={`${seg.state}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((seg) => {
          const colorClass = seg.color.replace('bg-', '')
          const colorMap: Record<string, string> = {
            'slate-400': '#94a3b8',
            'amber-400': '#fbbf24',
            'cyan-400': '#22d3ee',
            'emerald-400': '#34d399',
            'lime-400': '#a3e635',
            'orange-400': '#fb923c',
            'rose-400': '#fb7185',
            'red-400': '#f87171',
            'yellow-400': '#facc15',
            'zinc-500': '#71717a',
            '[var(--app-state-neutral-dot)]': 'var(--app-state-neutral-dot)',
          }
          const hex = colorMap[colorClass] || 'var(--app-state-neutral-dot)'
          return (
            <div key={seg.state} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: hex }}
              />
              <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-wider uppercase">
                {seg.state.replace(/_/g, ' ')}
              </span>
              <span className="text-[13px] text-[var(--app-text-muted)] tabular-nums">{seg.count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      variants={staggerChild}
      className="relative rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] p-3 overflow-hidden linear-surface-hover"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
        <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-widest uppercase">
          {label}
        </span>
      </div>
      {children}
    </motion.div>
  )
}

// ─── Activity Timeline Event ─────────────────────────────────────────────────

interface TimelineEvent {
  id: string
  jobId: string
  jobName: string
  state: string
  action: string
  timestamp: string
  icon: React.ElementType
  iconColor: string
}

function getActionInfo(state: string): { action: string; icon: React.ElementType; iconColor: string } {
  switch (state) {
    case 'NEW':
      return { action: 'Created', icon: Plus, iconColor: 'text-[var(--app-state-neutral-text)]' }
    case 'SCAD_GENERATED':
      return { action: 'SCAD Generated', icon: Zap, iconColor: 'text-amber-400' }
    case 'RENDERED':
      return { action: 'Rendered', icon: Layers, iconColor: 'text-cyan-400' }
    case 'VALIDATED':
      return { action: 'Validated', icon: CheckCircle2, iconColor: 'text-emerald-400' }
    case 'DELIVERED':
      return { action: 'Delivered', icon: CheckCircle2, iconColor: 'text-lime-400' }
    case 'VALIDATION_FAILED':
    case 'GEOMETRY_FAILED':
    case 'RENDER_FAILED':
      return { action: 'Failed', icon: XCircle, iconColor: 'text-rose-400' }
    case 'CANCELLED':
      return { action: 'Cancelled', icon: Ban, iconColor: 'text-[var(--app-text-muted)]' }
    default:
      return { action: state.replace(/_/g, ' '), icon: Activity, iconColor: 'text-[var(--app-text-muted)]' }
  }
}

function ActivityTimeline({ jobs }: { jobs: Job[] }) {
  // Generate timeline events from all jobs
  const events = useMemo<TimelineEvent[]>(() => {
    const allEvents: TimelineEvent[] = []

    for (const job of jobs) {
      // Add "Created" event
      allEvents.push({
        id: `${job.id}-created`,
        jobId: job.id,
        jobName: job.inputRequest,
        state: job.state,
        action: 'Created',
        icon: Plus,
        iconColor: 'text-[var(--app-state-neutral-text)]',
        timestamp: job.createdAt,
      })

      // Add current state event if different from NEW
      if (job.state !== 'NEW') {
        const info = getActionInfo(job.state)
        allEvents.push({
          id: `${job.id}-${job.state}`,
          jobId: job.id,
          jobName: job.inputRequest,
          state: job.state,
          action: info.action,
          icon: info.icon,
          iconColor: info.iconColor,
          timestamp: job.completedAt || job.updatedAt,
        })
      }

      // Parse execution logs for additional events
      const logs = parseJSON<Array<{ timestamp: string; event: string; message: string }>>(
        job.executionLogs,
        []
      )
      for (const log of logs) {
        if (log.event === 'JOB_CREATED') continue // Already added above
        const info = getActionInfo(log.event.replace('JOB_', '').replace('_START', '').replace('_END', ''))
        allEvents.push({
          id: `${job.id}-log-${log.timestamp}`,
          jobId: job.id,
          jobName: job.inputRequest,
          state: job.state,
          action: info.action,
          icon: info.icon,
          iconColor: info.iconColor,
          timestamp: log.timestamp,
        })
      }
    }

    // Sort by timestamp descending, take top 10
    return allEvents
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10)
  }, [jobs])

  // Group events by time period
  const groupedEvents = useMemo(() => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const groups: { label: string; events: TimelineEvent[] }[] = [
      { label: 'Today', events: [] },
      { label: 'Yesterday', events: [] },
      { label: 'Earlier', events: [] },
    ]

    for (const event of events) {
      const eventDate = new Date(event.timestamp)
      if (eventDate >= today) {
        groups[0].events.push(event)
      } else if (eventDate >= yesterday) {
        groups[1].events.push(event)
      } else {
        groups[2].events.push(event)
      }
    }

    return groups.filter(g => g.events.length > 0)
  }, [events])

  if (events.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-[13px] text-[var(--app-text-dim)]">No recent activity</p>
      </div>
    )
  }

  return (
    <div className="max-h-70 overflow-y-auto pr-1">
      {groupedEvents.map((group) => (
        <div key={group.label} className="mb-3 last:mb-0">
          <span className="text-[8px] font-mono text-[var(--app-text-dim)] tracking-widest uppercase block mb-1.5 sticky top-0 bg-[var(--app-surface)] py-0.5 z-10">
            {group.label}
          </span>
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            transition={{ ...staggerTransition, staggerChildren: 0.05 }}
            className="space-y-1"
          >
            {group.events.map((event, eventIndex) => {
              const IconComp = event.icon
              return (
                <motion.div
                  key={event.id}
                  variants={staggerChild}
                  custom={eventIndex}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--app-hover-subtle)] linear-transition"
                >
                  <div className={`shrink-0 ${event.iconColor}`}>
                    <IconComp className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] text-[var(--app-text-secondary)] truncate flex-1">
                        {event.jobName.slice(0, 50)}
                      </p>
                      <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                        STATE_COLORS[event.state]?.bg || 'bg-[var(--app-state-neutral-bg)]'
                      } ${
                        STATE_COLORS[event.state]?.text || 'text-[var(--app-text-muted)]'
                      }`}>
                        {event.action}
                      </span>
                    </div>
                  </div>
                  <span className="text-[8px] text-[var(--app-text-dim)] font-mono shrink-0">
                    {timeAgo(event.timestamp)}
                  </span>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Stats Dashboard ───────────────────────────────────────────────────

export function StatsDashboard({ jobs, onClose }: StatsDashboardProps) {
  const stats = useMemo<StatsData>(() => {
    const totalJobs = jobs.length

    // Jobs by state
    const jobsByState: Record<string, number> = {}
    for (const job of jobs) {
      jobsByState[job.state] = (jobsByState[job.state] || 0) + 1
    }

    // Average processing time (from createdAt to completedAt for delivered jobs)
    const completedJobs = jobs.filter(
      (j) => j.completedAt && j.state === 'DELIVERED'
    )
    let avgProcessingTimeMs = 0
    if (completedJobs.length > 0) {
      const totalTime = completedJobs.reduce((acc, j) => {
        return acc + (new Date(j.completedAt!).getTime() - new Date(j.createdAt).getTime())
      }, 0)
      avgProcessingTimeMs = totalTime / completedJobs.length
    }

    // Success rate (DELIVERED vs failed states)
    const failedStates = ['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED']
    const terminalJobs = jobs.filter(
      (j) => j.state === 'DELIVERED' || failedStates.includes(j.state)
    )
    const successRate =
      terminalJobs.length > 0
        ? ((jobsByState['DELIVERED'] || 0) / terminalJobs.length) * 100
        : 0

    // Jobs created today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const jobsCreatedToday = jobs.filter(
      (j) => new Date(j.createdAt) >= today
    ).length

    // Most common part family
    const familyCounts: Record<string, number> = {}
    for (const job of jobs) {
      if (job.partFamily) {
        familyCounts[job.partFamily] = (familyCounts[job.partFamily] || 0) + 1
      }
    }
    const mostCommonPartFamily =
      Object.entries(familyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'

    // Recent activity (last 24h, bucketed by hour)
    const now = Date.now()
    const hourBuckets: Array<{ hour: number; count: number }> = []
    for (let i = 23; i >= 0; i--) {
      const hourStart = now - i * 3600000
      const hourEnd = hourStart + 3600000
      const h = new Date(hourStart).getHours()
      const count = jobs.filter((j) => {
        const t = new Date(j.createdAt).getTime()
        return t >= hourStart && t < hourEnd
      }).length
      hourBuckets.push({ hour: h, count })
    }

    return {
      totalJobs,
      jobsByState,
      avgProcessingTimeMs,
      successRate,
      jobsCreatedToday,
      mostCommonPartFamily,
      recentActivity: hourBuckets,
    }
  }, [jobs])

  const formatDuration = (ms: number) => {
    if (ms === 0) return 'N/A'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rs = s % 60
    if (m < 60) return `${m}m ${rs}s`
    const h = Math.floor(m / 60)
    const rm = m % 60
    return `${h}h ${rm}m`
  }

  return (
    <motion.div
      className="w-full max-w-2xl mx-auto"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={staggerTransition}
    >
      {/* Screen-reader summary */}
      <div className="sr-only" role="status" aria-live="polite">
        Dashboard showing {stats.totalJobs} total jobs, {stats.successRate.toFixed(0)}% success rate,
        {stats.jobsCreatedToday} jobs created today, most common part family is {stats.mostCommonPartFamily.replace(/_/g, ' ')},
        average processing time {formatDuration(stats.avgProcessingTimeMs)}.
        Job states: {Object.entries(stats.jobsByState).map(([state, count]) => `${state.replace(/_/g, ' ')}: ${count}`).join(', ')}.
      </div>

      {/* Header */}
      <motion.div variants={staggerChild} className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--app-accent-text)]" />
          <h2 className="text-sm font-semibold text-[var(--app-text-primary)] tracking-wide">
            System Analytics
          </h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[13px] font-mono text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)] transition-colors"
          >
            ESC
          </button>
        )}
      </motion.div>

      {/* Top row: Key metrics */}
      <motion.div variants={staggerContainer} className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <StatCard icon={Layers} label="Total Jobs">
          <div className="text-2xl font-mono font-bold tracking-tighter text-[var(--app-text-primary)] tabular-nums">
            <AnimatedCounter value={stats.totalJobs} />
          </div>
          <div className="text-[13px] text-[var(--app-text-dim)] mt-0.5 tabular-nums">
            <AnimatedCounter value={stats.jobsCreatedToday} /> today
          </div>
        </StatCard>

        <StatCard icon={Clock} label="Avg Time">
          <div className="text-xl font-mono font-bold tracking-tighter text-cyan-400 tabular-nums">
            {formatDuration(stats.avgProcessingTimeMs)}
          </div>
          <div className="text-[13px] text-[var(--app-text-dim)] mt-0.5">
            processing time
          </div>
        </StatCard>

        <StatCard icon={CheckCircle2} label="Success">
          <div className="flex justify-center py-1">
            <ProgressRing
              value={stats.successRate}
              size={56}
              strokeWidth={4}
              color="#34d399"
            />
          </div>
        </StatCard>

        <StatCard icon={Zap} label="Top Family">
          <div className="text-sm font-mono font-semibold tracking-tight text-[var(--app-accent-text)] truncate">
            {stats.mostCommonPartFamily.replace(/_/g, ' ')}
          </div>
          <div className="text-[13px] text-[var(--app-text-dim)] mt-0.5">most common</div>
        </StatCard>
      </motion.div>

      {/* State distribution */}
      <motion.div
        variants={staggerChild}
        className="rounded-xl linear-surface linear-border p-3 mb-3"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
          <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-widest uppercase">
            Jobs by State
          </span>
        </div>
        <StateDistributionBar jobsByState={stats.jobsByState} />
      </motion.div>

      {/* Sparkline: Recent activity */}
      <motion.div
        variants={staggerChild}
        className="rounded-xl linear-surface linear-border p-3"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
            <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-widest uppercase">
              Activity (24h)
            </span>
          </div>
          <span className="text-[13px] text-[var(--app-text-muted)] tabular-nums">
            {stats.recentActivity.reduce((a, b) => a + b.count, 0)} jobs
          </span>
        </div>
        <div className="h-[50px] w-full flex items-center justify-center">
          <Sparkline data={stats.recentActivity} width={400} height={50} />
        </div>
      </motion.div>

      {/* Recent Activity Timeline */}
      <motion.div
        variants={staggerChild}
        className="rounded-xl linear-surface linear-border p-3 mt-3"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[var(--app-text-dim)]" />
            <span className="text-xs font-mono text-[var(--app-text-muted)] tracking-widest uppercase">
              Recent Activity
            </span>
          </div>
          <span className="text-xs font-mono text-[var(--app-text-dim)]">
            Last 10 events
          </span>
        </div>
        <ActivityTimeline jobs={jobs} />
      </motion.div>
    </motion.div>
  )
}
