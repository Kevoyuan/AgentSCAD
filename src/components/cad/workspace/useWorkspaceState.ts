'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  useSensor, useSensors, PointerSensor, KeyboardSensor,
  DragStartEvent, DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'

import {
  Job, CANCELABLE_STATES, timeAgo,
} from '@/components/cad/types'
import {
  fetchJobs, fetchJob, createJob, deleteJob, processJob,
  cancelJob, batchOperation, sendChatMessageStream,
  applyScadSource, repairJob, visualRepairJob,
} from '@/components/cad/api'
import {
  FilterState, DEFAULT_FILTER_STATE, applyFilters,
  filtersToUrlParams, urlParamsToFilters,
} from '@/components/cad/search-filter-panel'
import { buildCustomerId } from '@/components/cad/tag-badges'
import { Notification, NotificationType } from '@/components/cad/notification-center'
import { ActivityEvent, ActivityEventType } from '@/components/cad/job-activity-feed'
import { copyText } from '@/lib/clipboard'

export function useWorkspaceState() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [allJobs, setAllJobs] = useState<Job[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [filterState, setFilterState] = useState<FilterState>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const urlFilters = urlParamsToFilters(params)
      return { ...DEFAULT_FILTER_STATE, ...urlFilters }
    }
    return DEFAULT_FILTER_STATE
  })
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newJobText, setNewJobText] = useState('')
  const [newJobModelId, setNewJobModelId] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState('SPEC')
  const [prevTab, setPrevTab] = useState('SPEC')
  const [tabDirection, setTabDirection] = useState(1)
  const [prevJobId, setPrevJobId] = useState<string | null>(null)
  const [jobCountFlash, setJobCountFlash] = useState(false)
  const [isFirstLoadComplete, setFirstLoadComplete] = useState(false)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [dependencyCount, setDependencyCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [newJobTags, setNewJobTags] = useState('')
  const [isAiEnhancing, setIsAiEnhancing] = useState(false)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [showThemePanel, setShowThemePanel] = useState(false)
  const [processingJobId, setProcessingJobId] = useState<string | null>(null)
  const [pipelineEvents, setPipelineEvents] = useState<Array<{ step: string; state: string; message: string; timestamp: string }>>([])

  const startTimeRef = useRef(Date.now())

  useEffect(() => {
    setMounted(true)
  }, [])

  // ── Notification Helper ────────────────────────────────────────────────

  const addNotification = useCallback((type: NotificationType, title: string, description: string) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setNotifications(prev => {
      const next = [{ id, type, title, description, timestamp: new Date(), read: false }, ...prev]
      return next.slice(0, 50)
    })
  }, [])

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }, [])

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const clearAllNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  // ── Activity Feed Helper ─────────────────────────────────────────────

  const addActivityEvent = useCallback((type: ActivityEventType, jobName: string, jobId: string, action: string) => {
    const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setActivityEvents(prev => {
      const next = [{ id, type, jobName, jobId, action, timestamp: new Date() }, ...prev]
      return next.slice(0, 50)
    })
  }, [])

  const clearActivityEvents = useCallback(() => {
    setActivityEvents([])
  }, [])

  // ── Recent Requests (for composer) ────────────────────────────────────

  const recentRequests = useMemo(() => {
    const seen = new Set<string>()
    const unique: string[] = []
    for (const j of [...allJobs].reverse()) {
      const req = j.inputRequest.trim()
      if (req && !seen.has(req.toLowerCase())) {
        seen.add(req.toLowerCase())
        unique.push(req)
        if (unique.length >= 5) break
      }
    }
    return unique
  }, [allJobs])

  // ── DnD Sensors ─────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)

    if (!over || active.id === over.id) return
  }

  const handleDragCancel = () => {
    setActiveDragId(null)
  }

  // ── Data Fetching ─────────────────────────────────────────────────────────

  const selectedJobRef = useRef<Job | null>(null)
  selectedJobRef.current = selectedJob

  const selectJob = useCallback(async (job: Job, tab = 'SPEC') => {
    setSelectedJob(job)
    setActiveTab(tab)
    try {
      const { job: fullJob } = await fetchJob(job.id)
      setSelectedJob(fullJob)
    } catch (err) {
      console.error('Failed to fetch job details:', err)
    }
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchJobs()
      setAllJobs(prev => {
        if (prev.length === data.jobs.length && prev.every((j, i) => j.id === data.jobs[i].id && j.state === data.jobs[i].state && j.updatedAt === data.jobs[i].updatedAt)) {
          return prev
        }
        return data.jobs
      })
      const filtered = applyFilters(data.jobs, filterState)
      setJobs(prev => {
        if (prev.length === filtered.length && prev.every((j, i) => j.id === filtered[i].id && j.state === filtered[i].state)) {
          return prev
        }
        return filtered
      })
      const currentSelected = selectedJobRef.current
      if (currentSelected) {
        const updated = data.jobs.find(j => j.id === currentSelected.id)
        if (updated && (updated.state !== currentSelected.state || updated.updatedAt !== currentSelected.updatedAt)) {
          try {
            const { job: fullJob } = await fetchJob(updated.id)
            setSelectedJob(fullJob)
          } catch {
            setSelectedJob(updated)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load jobs:', err)
    }
  }, [filterState])

  // ── Polling Refresh ─────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    loadJobs().finally(() => {
      if (!cancelled) setFirstLoadComplete(true)
    })
    const interval = setInterval(loadJobs, 15000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [loadJobs])

  // ── Job Actions ───────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newJobText.trim()) return
    setIsCreating(true)
    const request = newJobText.trim()
    try {
      const tagsCustomerId = newJobTags.trim() ? buildCustomerId(newJobTags.split(',').map(t => t.trim()).filter(t => t)) : undefined
      const { job } = await createJob(request, tagsCustomerId, newJobModelId)
      toast.success('CAD generation started', { description: newJobModelId })
      addNotification('parameter_updated', 'CAD generation started', request.slice(0, 60))
      addActivityEvent('created', request.slice(0, 30), job.id.slice(0, 8), 'Created and started')
      setNewJobText('')
      setNewJobModelId('')
      setNewJobTags('')
      setShowComposer(false)
      await loadJobs()
      setSelectedJob(job)
      void handleProcess(job)
    } catch {
      toast.error('Failed to create job')
    } finally {
      setIsCreating(false)
    }
  }

  const handleProcess = async (job: Job) => {
    setIsProcessing(true)
    setProcessingJobId(job.id)
    setPipelineEvents([{
      step: 'queued',
      state: job.state,
      message: 'Queued CAD generation pipeline...',
      timestamp: new Date().toISOString(),
    }])
    setSelectedJob(job)
    try {
      await processJob(job.id, (data) => {
        if (data.message || data.step || data.state) {
          setPipelineEvents(prev => {
            const next = [
              ...prev,
              {
                step: String(data.step || 'update'),
                state: String(data.state || job.state),
                message: String(data.message || 'Pipeline event received'),
                timestamp: new Date().toISOString(),
              },
            ]
            return next.slice(-12)
          })
        }
        setSelectedJob(prev => {
          if (!prev) return prev
          if (data.job) return data.job as Job

          const next = { ...prev }
          if (data.state) next.state = data.state as string
          if (data.scadSource) next.scadSource = data.scadSource as string
          if (data.parameterSchema) next.parameterSchema = typeof data.parameterSchema === 'string' ? data.parameterSchema : JSON.stringify(data.parameterSchema)
          if (data.parameters) next.parameterSchema = typeof data.parameters === 'string' ? data.parameters : JSON.stringify(data.parameters)
          if (data.parameterValues) next.parameterValues = typeof data.parameterValues === 'string' ? data.parameterValues : JSON.stringify(data.parameterValues)
          if (data.partFamily) next.partFamily = data.partFamily as string
          if (data.validationResults) next.validationResults = typeof data.validationResults === 'string' ? data.validationResults : JSON.stringify(data.validationResults)
          if (data.stlPath) next.stlPath = data.stlPath as string
          if (data.pngPath) next.pngPath = data.pngPath as string
          if (data.researchResult) next.researchResult = typeof data.researchResult === 'string' ? data.researchResult : JSON.stringify(data.researchResult)
          if (data.intentResult) next.intentResult = typeof data.intentResult === 'string' ? data.intentResult : JSON.stringify(data.intentResult)
          if (data.designResult) next.designResult = typeof data.designResult === 'string' ? data.designResult : JSON.stringify(data.designResult)
          if (data.renderLog) next.renderLog = typeof data.renderLog === 'string' ? data.renderLog : JSON.stringify(data.renderLog)
          if (data.builderName) next.builderName = data.builderName as string
          if (data.generationPath) next.generationPath = data.generationPath as string
          return next
        })
        const step = data.step as string
        if (step === 'scad_generated') {
          toast.success('SCAD Generated', { description: 'Code generated successfully' })
          addNotification('scad_updated', 'SCAD Generated', `Job ${job.id.slice(0, 8)} - Code generated`)
          addActivityEvent('processed', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'SCAD Generated')
        } else if (step === 'rendered') {
          toast.success('Rendered', { description: '3D model rendered' })
        } else if (step === 'validated') {
          toast.success('Validated', { description: 'Quality checks passed' })
        } else if (step === 'delivered') {
          toast.success('Delivered!', { description: 'All deliverables ready' })
          addNotification('job_completed', 'Job Delivered', `Job ${job.id.slice(0, 8)} - All deliverables ready`)
          addActivityEvent('delivered', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'Delivered')
        } else if (step === 'validation_failed') {
          toast.warning('Rendered for review', { description: 'Preview available; checks failed' })
        }
      })
      await loadJobs()
    } catch {
      toast.error('Processing failed')
      addNotification('job_failed', 'Processing Failed', `Job ${job.id.slice(0, 8)} - An error occurred`)
      addActivityEvent('failed', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'Processing Failed')
    } finally {
      setIsProcessing(false)
      setProcessingJobId(null)
    }
  }

  const handleApplyScad = useCallback(async (job: Job, scadSource: string) => {
    setIsProcessing(true)
    setSelectedJob(job)

    try {
      await applyScadSource(job.id, scadSource, (data) => {
        setSelectedJob(prev => {
          if (!prev) return prev
          if (data.job) return data.job as Job

          const next = { ...prev }
          if (data.state) next.state = data.state as string
          if (data.scadSource) next.scadSource = data.scadSource as string
          if (data.parameterSchema) next.parameterSchema = typeof data.parameterSchema === 'string' ? data.parameterSchema : JSON.stringify(data.parameterSchema)
          if (data.parameterValues) next.parameterValues = typeof data.parameterValues === 'string' ? data.parameterValues : JSON.stringify(data.parameterValues)
          if (data.validationResults) next.validationResults = typeof data.validationResults === 'string' ? data.validationResults : JSON.stringify(data.validationResults)
          if (data.renderLog) next.renderLog = typeof data.renderLog === 'string' ? data.renderLog : JSON.stringify(data.renderLog)
          if (data.stlPath) next.stlPath = data.stlPath as string
          if (data.pngPath) next.pngPath = data.pngPath as string
          if (data.generationPath) next.generationPath = data.generationPath as string
          return next
        })

        const step = data.step as string
        if (step === 'scad_applied') {
          toast.success('SCAD applied', { description: 'Rebuilding render...' })
        } else if (step === 'rendered') {
          toast.success('Rendered', { description: 'Preview updated' })
        } else if (step === 'validated') {
          toast.success('Validated', { description: 'Checks passed' })
        } else if (step === 'delivered') {
          toast.success('Apply complete')
        } else if (step === 'validation_failed') {
          toast.warning('Rendered for review', { description: 'Validation blockers remain' })
        } else if (step === 'render_failed') {
          toast.error('Render failed', { description: String(data.error || 'Check SCAD syntax') })
        }
      })

      await loadJobs()
    } catch (error) {
      toast.error('Apply failed', { description: error instanceof Error ? error.message : 'Failed' })
    } finally {
      setIsProcessing(false)
    }
  }, [loadJobs, toast])

  const handleDelete = async (id: string) => {
    try {
      await deleteJob(id)
      if (selectedJob?.id === id) setSelectedJob(null)
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
      toast.success('Job deleted')
      await loadJobs()
    } catch {
      toast.error('Delete failed')
    }
  }

  const handleDuplicate = async (job: Job) => {
    try {
      const { job: newJob } = await createJob(job.inputRequest, job.customerId ?? undefined, job.modelId ?? undefined)
      toast.success('Job duplicated')
      await loadJobs()
      setSelectedJob(newJob)
    } catch {
      toast.error('Duplicate failed')
    }
  }

  const handleCancel = async (job: Job) => {
    try {
      await cancelJob(job.id)
      toast.success('Job cancelled')
      addNotification('job_cancelled', 'Job Cancelled', `Job ${job.id.slice(0, 8)} - Cancelled by user`)
      addActivityEvent('failed', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'Cancelled')
      setCancelTarget(null)
      await loadJobs()
    } catch {
      toast.error('Cancel failed')
    }
  }

  const handleRepair = async (job: Job) => {
    try {
      const result = await repairJob(job.id)
      setSelectedJob(result.job)
      if (result.repaired) {
        toast.success('Job repaired', { description: result.reason })
        addNotification('job_completed', 'Auto Repair Complete', `Job ${job.id.slice(0, 8)} restored to delivered`)
        addActivityEvent('delivered', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'Auto repaired')
      } else if (result.recommendation === 'retry') {
        toast.info('Retry recommended', { description: result.reason })
      } else {
        toast.info('No repair needed', { description: result.reason })
      }
      await loadJobs()
    } catch (error) {
      toast.error('Auto repair failed', { description: error instanceof Error ? error.message : 'Failed' })
    }
  }

  const handleVisualRepair = async (job: Job) => {
    try {
      toast.info('Running visual repair...', { description: 'Analyzing preview image with VLM' })
      const result = await visualRepairJob(job.id)
      setSelectedJob(result.job)
      if (result.repaired) {
        toast.success('Visual repair complete', {
          description: result.repairSummary || `Match: ${((result.visualReport?.overall_visual_match ?? 0) * 100).toFixed(0)}%`,
        })
        addNotification('job_completed', 'Visual Repair Complete', result.repairSummary || '')
        addActivityEvent('delivered', job.inputRequest.slice(0, 30), job.id.slice(0, 8), 'Visually repaired')
      } else {
        toast.error('Visual repair failed', { description: result.error || 'Unknown error' })
      }
      await loadJobs()
    } catch (error) {
      toast.error('Visual repair failed', { description: error instanceof Error ? error.message : 'Failed' })
    }
  }

  const handleBatchAction = async (action: 'delete' | 'cancel' | 'reprocess') => {
    try {
      const ids = Array.from(selectedIds)
      const { results } = await batchOperation(action, ids)
      toast.success(`Batch ${action}: ${results.success.length} succeeded${results.failed.length > 0 ? `, ${results.failed.length} failed` : ''}`)
      setSelectedIds(new Set())
      await loadJobs()
    } catch {
      toast.error(`Batch ${action} failed`)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleLinkParent = useCallback((job: Job) => {
    selectJob(job, 'DEPS')
  }, [selectJob])

  // ── Filter State Handler ────────────────────────────────────────────────

  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilterState(newFilters)
    const params = filtersToUrlParams(newFilters)
    const url = new URL(window.location.href)
    for (const key of ['q', 'states', 'dr', 'df', 'dt', 'pf', 'bn', 'sort', 'order']) {
      url.searchParams.delete(key)
    }
    params.forEach((value, key) => {
      url.searchParams.set(key, value)
    })
    window.history.replaceState(null, '', url.pathname + (params.toString() ? '?' + params.toString() : ''))
  }, [])

  // ── Quick Action Handlers ──────────────────────────────────────────────

  const handleQuickViewLog = useCallback((job: Job) => {
    selectJob(job, 'LOG')
  }, [selectJob])

  const handleQuickView3D = useCallback(() => {
    toast.info('3D viewer active')
  }, [])

  const handleQuickShare = useCallback((job: Job) => {
    const url = `${window.location.origin}?job=${job.id}`
    copyText(url).then((ok) => {
      if (!ok) throw new Error('Clipboard unavailable')
      toast.success('Link copied to clipboard', { description: `Share link for job ${job.id.slice(0, 8)}` })
    }).catch(() => {
      toast.error('Failed to copy link')
    })
  }, [])

  // ── Computed Values ───────────────────────────────────────────────────────

  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      let cmp = 0
      switch (filterState.sortBy) {
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'state':
          cmp = a.state.localeCompare(b.state)
          break
      }
      return filterState.sortOrder === 'desc' ? -cmp : cmp
    })
  }, [jobs, filterState.sortBy, filterState.sortOrder])

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const j of allJobs) {
      if (['VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(j.state)) {
        counts['FAILED'] = (counts['FAILED'] || 0) + 1
      }
      counts[j.state] = (counts[j.state] || 0) + 1
    }
    return counts
  }, [allJobs])

  const linkedJobCount = useMemo(() => {
    return allJobs.filter(j => j.parentId).length
  }, [allJobs])

  // Uptime counter
  useEffect(() => {
    const interval = setInterval(() => {
      setUptimeSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const uptime = uptimeSeconds

  // ── Download Helpers ──────────────────────────────────────────────────

  const downloadScad = (job: Job) => {
    if (!job.scadSource) return
    const blob = new Blob([job.scadSource], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${job.id.slice(0, 8)}-${job.partFamily || 'part'}.scad`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('SCAD file downloaded')
  }

  const exportAllData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      version: '0.9',
      totalJobs: allJobs.length,
      jobs: allJobs,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agentscad-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Data exported', { description: `${allJobs.length} jobs` })
  }

  const formatUptime = (s: number) => {
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  }

  const successRate = useMemo(() => {
    const finished = allJobs.filter(j =>
      ['DELIVERED', 'VALIDATION_FAILED', 'GEOMETRY_FAILED', 'RENDER_FAILED'].includes(j.state)
    )
    if (finished.length === 0) return 0
    const succeeded = finished.filter(j => j.state === 'DELIVERED').length
    return Math.round((succeeded / finished.length) * 100)
  }, [allJobs])

  // ── Job count flash effect ────────────────────────────────────────────────
  const prevJobCountRef = useRef(allJobs.length)
  useEffect(() => {
    if (allJobs.length !== prevJobCountRef.current) {
      prevJobCountRef.current = allJobs.length
      setJobCountFlash(true)
      const timer = setTimeout(() => setJobCountFlash(false), 500)
      return () => clearTimeout(timer)
    }
  }, [allJobs.length])

  // ── AI Enhancement for Job Request ──────────────────────────────────────
  const handleAiEnhance = useCallback(() => {
    if (!newJobText.trim() || isAiEnhancing) return
    setIsAiEnhancing(true)
    let enhanced = ''
    const abort = sendChatMessageStream(
      [{ role: 'user', content: `Enhance this CAD request to be more specific and detailed for manufacturing. Add dimensions, tolerances, and material specifications where appropriate. Only return the enhanced request, nothing else:\n\n${newJobText}` }],
      undefined,
      (token) => { enhanced += token; setNewJobText(enhanced) },
      () => { setIsAiEnhancing(false) },
      () => { setIsAiEnhancing(false); toast.error('AI enhancement failed') }
    )
    setTimeout(() => { if (isAiEnhancing) abort() }, 15000)
  }, [newJobText, isAiEnhancing])

  // ── Return all state and handlers ─────────────────────────────────────
  return {
    // Theme
    theme, setTheme, resolvedTheme, mounted,
    // Job data
    jobs, allJobs, selectedJob, setSelectedJob, selectJob,
    sortedJobs, stateCounts, linkedJobCount,
    // Filter
    filterState, handleFilterChange,
    // UI state
    showCommandPalette, setShowCommandPalette,
    isCreating, newJobText, setNewJobText,
    newJobModelId, setNewJobModelId,
    isProcessing, showComposer, setShowComposer,
    showShortcuts, setShowShortcuts,
    showStats, setShowStats,
    showCompare, setShowCompare,
    showSettings, setShowSettings,
    cancelTarget, setCancelTarget,
    selectedIds, setSelectedIds,
    activeTab, setActiveTab, prevTab, setPrevTab,
    tabDirection, setTabDirection,
    prevJobId, setPrevJobId,
    jobCountFlash, isFirstLoadComplete,
    uptime, activeDragId,
    notifications, newJobTags, setNewJobTags,
    isAiEnhancing,
    activityEvents,
    showThemePanel, setShowThemePanel,
    processingJobId, pipelineEvents,
    // DnD
    sensors, handleDragStart, handleDragEnd, handleDragCancel,
    sortedJobsForDnd: sortedJobs,
    // Job actions
    handleCreate, handleProcess, handleApplyScad,
    handleDelete, handleDuplicate, handleCancel, handleRepair, handleVisualRepair,
    handleBatchAction, toggleSelect,
    handleLinkParent,
    handleAiEnhance,
    // Quick actions
    handleQuickViewLog,
    handleQuickView3D, handleQuickShare,
    // Notifications
    addNotification, markNotificationRead,
    markAllNotificationsRead, clearAllNotifications,
    // Activity
    addActivityEvent, clearActivityEvents,
    // Downloads
    downloadScad, exportAllData, formatUptime,
    successRate,
    // Misc
    loadJobs, recentRequests,
    CANCELABLE_STATES, timeAgo,
  }
}
