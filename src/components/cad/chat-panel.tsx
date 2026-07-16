'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Sparkles, MessageSquare, Send, Square, Clock, Copy, Check, ChevronDown, ImagePlus, X, Eye, Brain, Zap, Code2, Star, Wand2, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { ChatMessage, Job } from './types'
import { sendChatMessageStream, fetchModels, ModelInfo } from './api'
import { copyText } from '@/lib/clipboard'

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Smart suggestions based on partFamily
function getSmartSuggestions(partFamily: string | null): string[] {
  const base = ['Optimize wall thickness', 'Suggest improvements']
  const familySuggestions: Record<string, string[]> = {
    spur_gear: ['Best number of teeth for torque?', 'Calculate module for my gear', 'What pressure angle to use?'],
    electronics_enclosure: ['How thick should walls be?', 'Add mounting holes pattern', 'Best tolerance for lid fit?'],
    bracket: ['Minimize material usage', 'Optimize fillet radius', 'Recommended fastener size?'],
    bolt: ['Standard thread pitch?', 'Hex head vs socket head?', 'Best material for M6 bolt?'],
    device_stand: ['Optimal viewing angle?', 'Cable management holes?', 'Anti-slip features?'],
    phone_case: ['Minimum wall for protection?', 'Add camera cutout', 'Wireless charging compatible?'],
  }
  const key = (partFamily || '').toLowerCase()
  const specific = familySuggestions[key] || ['Explain this design', 'What parameters can I adjust?']
  return [...specific, ...base].slice(0, 4)
}

// Copy button for code blocks
function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    copyText(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="code-copy-btn text-xs font-mono text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] bg-[var(--app-surface-raised)] hover:bg-[var(--app-surface-hover)] border border-[color:var(--app-border)] shadow-sm active:scale-[0.97] transition-all cursor-pointer px-2 py-1 rounded flex items-center gap-1.5"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function hasCompleteScadShape(source: string) {
  const hasGeometryDefinition = /\b(module|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(source)
  const hasGeometryCall = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\([^;{}]*\)\s*;\s*$/m.test(source)
  return hasGeometryDefinition && hasGeometryCall
}

function findMatchingBrace(source: string, openIndex: number) {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findLastTopLevelCall(source: string) {
  let last: RegExpMatchArray | null = null
  const callRegex = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\([^;{}]*\)\s*;\s*$/gm
  for (const match of source.matchAll(callRegex)) {
    last = match
  }
  return last
}

function extractModuleBlocks(source: string) {
  const blocks: Array<{ name: string; block: string }> = []
  const moduleRegex = /\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g
  for (const match of source.matchAll(moduleRegex)) {
    const openIndex = (match.index ?? 0) + match[0].lastIndexOf('{')
    const closeIndex = findMatchingBrace(source, openIndex)
    if (closeIndex === -1) continue
    blocks.push({
      name: match[1],
      block: source.slice(match.index, closeIndex + 1),
    })
  }
  return blocks
}

function extractScadCodeBlocks(markdown: string) {
  const blocks: string[] = []
  const fenceRegex = /```(?:openscad|scad)\s*\n([\s\S]*?)```/gi
  for (const match of markdown.matchAll(fenceRegex)) {
    const source = match[1].trim()
    if (source) blocks.push(source)
  }
  return blocks
}

function extractStandaloneCalls(source: string) {
  const moduleNames = new Set(extractModuleBlocks(source).map(block => block.name))
  const calls: string[] = []
  const callRegex = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*;\s*$/gm
  for (const match of source.matchAll(callRegex)) {
    if (moduleNames.has(match[1])) calls.push(match[0].trim())
  }
  return Array.from(new Set(calls))
}

function insertIntoPrintableDifference(source: string, call: string) {
  const printableMatch = /\bmodule\s+printable_[A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.exec(source)
    || /\bmodule\s+[A-Za-z0-9_]*case[A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.exec(source)
  if (!printableMatch || printableMatch.index === undefined) return source

  const moduleOpen = printableMatch.index + printableMatch[0].lastIndexOf('{')
  const moduleClose = findMatchingBrace(source, moduleOpen)
  if (moduleClose === -1) return source

  const moduleBody = source.slice(moduleOpen + 1, moduleClose)
  const differenceMatch = /\bdifference\s*\(\s*\)\s*\{/.exec(moduleBody)
  if (!differenceMatch || differenceMatch.index === undefined) return source

  const differenceOpen = moduleOpen + 1 + differenceMatch.index + differenceMatch[0].lastIndexOf('{')
  const differenceClose = findMatchingBrace(source, differenceOpen)
  if (differenceClose === -1 || differenceClose > moduleClose) return source
  if (source.slice(differenceOpen, differenceClose).includes(call)) return source

  return `${source.slice(0, differenceClose)}        ${call}\n${source.slice(differenceClose)}`
}

function mergeScadPatch(currentSource: string, patchSource: string) {
  let nextSource = currentSource
  const changes: string[] = []

  for (const moduleBlock of extractModuleBlocks(patchSource)) {
    const targetRegex = new RegExp(`\\bmodule\\s+${moduleBlock.name}\\s*\\([^)]*\\)\\s*\\{`, 'g')
    const targetMatch = targetRegex.exec(nextSource)
    if (targetMatch) {
      const openIndex = targetMatch.index + targetMatch[0].lastIndexOf('{')
      const closeIndex = findMatchingBrace(nextSource, openIndex)
      if (closeIndex === -1) continue
      nextSource = `${nextSource.slice(0, targetMatch.index)}${moduleBlock.block}${nextSource.slice(closeIndex + 1)}`
      changes.push(`module ${moduleBlock.name}`)
      continue
    }

    const finalCall = findLastTopLevelCall(nextSource)
    const insertAt = finalCall?.index ?? nextSource.length
    nextSource = `${nextSource.slice(0, insertAt).trimEnd()}\n\n${moduleBlock.block}\n\n${nextSource.slice(insertAt).trimStart()}`
    changes.push(`module ${moduleBlock.name}`)
  }

  const assignmentRegex = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/gm
  for (const match of patchSource.matchAll(assignmentRegex)) {
    const [, , key, value] = match
    const targetRegex = new RegExp(`^(\\s*)${key}\\s*=\\s*([^;]+);`, 'm')
    if (targetRegex.test(nextSource)) {
      nextSource = nextSource.replace(targetRegex, (_full, indent) => `${indent}${key} = ${value.trim()};`)
    } else {
      const firstModule = /\bmodule\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.exec(nextSource)
      const insertAt = firstModule?.index ?? 0
      nextSource = `${nextSource.slice(0, insertAt).trimEnd()}\n${key} = ${value.trim()};\n\n${nextSource.slice(insertAt).trimStart()}`
    }
    changes.push(key)
  }

  for (const call of extractStandaloneCalls(patchSource)) {
    const before = nextSource
    nextSource = insertIntoPrintableDifference(nextSource, call)
    if (nextSource !== before) changes.push(call)
  }

  return {
    source: nextSource,
    changes: Array.from(new Set(changes)),
  }
}

function MessagePatchButton({
  blocks,
  onApply,
  className = '',
}: {
  blocks: string[]
  onApply: (source: string, mode: 'replace' | 'patch') => Promise<void>
  className?: string
}) {
  const [isApplying, setIsApplying] = useState(false)

  const handleApply = useCallback(async () => {
    setIsApplying(true)
    try {
      await onApply(blocks.join('\n\n'), 'patch')
    } finally {
      setIsApplying(false)
    }
  }, [blocks, onApply])

  if (blocks.length < 2) return null

  return (
    <button
      onClick={handleApply}
      disabled={isApplying}
      className={`flex items-center gap-1.5 rounded bg-[var(--app-accent-text)] hover:brightness-110 active:brightness-95 px-2 py-1 font-mono text-xs text-white shadow-sm active:scale-[0.97] transition-all disabled:cursor-wait disabled:opacity-60 cursor-pointer border border-transparent ${className}`}
      title="Apply every SCAD patch block in this assistant message"
    >
      <Wand2 className="h-3 w-3" />
      {isApplying ? 'Rendering...' : 'Apply All & Render'}
    </button>
  )
}

function ScadApplyButton({
  text,
  onApply,
  mode,
}: {
  text: string
  onApply: (source: string, mode: 'replace' | 'patch') => Promise<void>
  mode: 'replace' | 'patch'
}) {
  const [isApplying, setIsApplying] = useState(false)

  const handleApply = useCallback(async () => {
    setIsApplying(true)
    try {
      await onApply(text, mode)
    } finally {
      setIsApplying(false)
    }
  }, [mode, onApply, text])

  return (
    <button
      onClick={handleApply}
      disabled={isApplying}
      className="text-xs font-mono text-white bg-[var(--app-accent-text)] hover:brightness-110 active:brightness-95 shadow-sm active:scale-[0.97] transition-all px-2 py-1 rounded flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait border border-transparent cursor-pointer"
    >
      <Wand2 className="w-3 h-3" />
      {isApplying ? 'Rendering...' : mode === 'replace' ? 'Apply & Render' : 'Patch & Render'}
    </button>
  )
}

// Category badge colors
const CATEGORY_STYLES: Record<string, { icon: React.ReactNode; color: string }> = {
  flagship: { icon: <Star className="w-2.5 h-2.5" />, color: 'text-amber-400' },
  balanced: { icon: <Brain className="w-2.5 h-2.5" />, color: 'text-blue-400' },
  fast: { icon: <Zap className="w-2.5 h-2.5" />, color: 'text-cyan-400' },
  reasoning: { icon: <Brain className="w-2.5 h-2.5" />, color: 'text-violet-400' },
  vision: { icon: <Eye className="w-2.5 h-2.5" />, color: 'text-emerald-400' },
  code: { icon: <Code2 className="w-2.5 h-2.5" />, color: 'text-orange-400' },
}

// Provider display colors
const PROVIDER_COLORS: Record<string, string> = {
  mimo: '#ff6a00',
  openai: '#10a37f',
  anthropic: '#d97706',
  google: '#4285f4',
  deepseek: '#5b6ef7',
  zhipu: '#3b82f6',
  qwen: '#8b5cf6',
  mistral: '#f97316',
}

const DEFAULT_CHAT_MODEL = 'mimo-v2.5-pro'
const DEFAULT_VISION_MODEL = 'mimo-v2.5'

export function ChatPanel({
  job,
  onApplyScad,
}: {
  job: Job
  onApplyScad: (job: Job, scadSource: string) => Promise<void>
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem(`chat-${job.id}`)
      if (!stored) return []
      const parsed = JSON.parse(stored) as Array<{ role: string; content: string; timestamp: string; images?: string[] }>
      return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) })) as ChatMessage[]
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CHAT_MODEL)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [lastAppliedSource, setLastAppliedSource] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<(() => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)


  // Persist chat messages to localStorage per job
  useEffect(() => {
    if (messages.length === 0) return
    try {
      localStorage.setItem(`chat-${job.id}`, JSON.stringify(messages))
    } catch { /* quota exceeded, ignore */ }
  }, [messages, job.id])

  // Load available models
  useEffect(() => {
    fetchModels().then(data => {
      setModels(data.models)
      setSelectedModel(prev => data.models.length > 0 && !data.models.some(model => model.id === prev) ? data.models[0].id : prev)
    }).catch(() => {
      const fallbackModels: ModelInfo[] = [
        { id: 'mimo-v2.5', name: 'MiMo-V2.5', description: 'Xiaomi MiMo multimodal model', provider: 'mimo', providerName: 'Xiaomi MiMo', multimodal: true, reasoning: true, category: 'vision' },
        { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5-Pro', description: 'Xiaomi MiMo default model', provider: 'mimo', providerName: 'Xiaomi MiMo', multimodal: false, reasoning: false, category: 'flagship' },
        { id: 'mimo-v2-omni', name: 'MiMo-V2-Omni', description: 'Xiaomi MiMo full-modal model', provider: 'mimo', providerName: 'Xiaomi MiMo', multimodal: true, reasoning: true, category: 'vision' },
        { id: 'gpt-5.6', name: 'GPT-5.6 Sol', description: 'OpenAI flagship reasoning model', provider: 'openai', providerName: 'OpenAI', multimodal: true, reasoning: true, category: 'flagship' },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Anthropic balanced coding model', provider: 'anthropic', providerName: 'Anthropic', multimodal: true, reasoning: true, category: 'balanced' },
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Google stable multimodal model', provider: 'google', providerName: 'Google', multimodal: true, reasoning: true, category: 'fast' },
      ]
      setModels(fallbackModels)
      setSelectedModel(prev => !fallbackModels.some(model => model.id === prev) ? fallbackModels[0].id : prev)
    })
  }, [])

  // Close model picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    if (showModelPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModelPicker])

  const currentModel = models.find(m => m.id === selectedModel)
  const isMultimodal = currentModel?.multimodal || false

  const ensureVisionModel = useCallback(() => {
    if (isMultimodal) return true
    const firstVisionModel = models.find(model => model.multimodal)
    if (firstVisionModel) {
      setSelectedModel(firstVisionModel.id)
      toast.success('Switched to vision model', {
        description: `${firstVisionModel.name} can inspect pasted screenshots.`,
      })
      return true
    }
    setSelectedModel(DEFAULT_VISION_MODEL)
    toast.success('Switched to vision model', {
      description: 'MiMo-V2.5 can inspect pasted screenshots.',
    })
    return true
  }, [isMultimodal, models, toast])

  const canAttachImages = useCallback(() => {
    if (isMultimodal || selectedModel === DEFAULT_VISION_MODEL) return true
    if (models.length === 0) return selectedModel === DEFAULT_VISION_MODEL
    return models.some(model => model.id === selectedModel && model.multimodal)
  }, [isMultimodal, models, selectedModel])

  const ensureImagesCanSend = useCallback(() => {
    if (canAttachImages()) return true
    toast.error('No vision model available', {
      description: 'Paste support needs a multimodal model that can read images.',
    })
    return false
  }, [canAttachImages, toast])

  const addImageFiles = useCallback((files: File[] | FileList, source: 'paste' | 'drop' | 'upload') => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
    if (imageFiles.length === 0) return false
    if (!ensureVisionModel()) return true

    imageFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result as string
        setPendingImages(prev => [...prev, base64])
      }
      reader.readAsDataURL(file)
    })
    toast.info(`${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''} attached`, {
      description: source === 'paste' ? 'Screenshot pasted into the AI assistant.' : source === 'drop' ? 'Image dropped into the AI assistant.' : 'Image attached to the prompt.',
    })
    return true
  }, [ensureVisionModel, toast])

  // Handle image upload
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    addImageFiles(files, 'upload')
    e.target.value = ''
  }, [addImageFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const filesFromList = Array.from(e.clipboardData.files)
    const filesFromItems = Array.from(e.clipboardData.items)
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    const uniqueFiles = new Map<string, File>()
    for (const file of [...filesFromList, ...filesFromItems]) {
      uniqueFiles.set(`${file.name}:${file.type}:${file.size}:${file.lastModified}`, file)
    }
    const files = Array.from(uniqueFiles.values())
    const handled = addImageFiles(files, 'paste')
    if (handled && files.some(file => file.type.startsWith('image/'))) {
      e.preventDefault()
    }
  }, [addImageFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    addImageFiles(e.dataTransfer.files, 'drop')
  }, [addImageFiles])

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const suggestions = useMemo(() => getSmartSuggestions(job.partFamily), [job.partFamily])

  // Group models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, { provider: string; providerName: string; models: ModelInfo[] }> = {}
    for (const model of models) {
      if (providerFilter && model.provider !== providerFilter) continue
      if (!groups[model.provider]) {
        groups[model.provider] = { provider: model.provider, providerName: model.providerName, models: [] }
      }
      groups[model.provider].models.push(model)
    }
    return Object.values(groups)
  }, [models, providerFilter])

  // Unique providers for filter
  const providers = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of models) {
      if (!seen.has(m.provider)) seen.set(m.provider, m.providerName)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [models])

  // Smooth auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current()
      abortRef.current = null
    }
    if (streamingContent) {
      setMessages(prev => [...prev, { role: 'assistant', content: streamingContent, timestamp: new Date() }])
    }
    setStreamingContent('')
    setIsStreaming(false)
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isStreaming) return
    if (pendingImages.length > 0 && !ensureImagesCanSend()) {
      return
    }

    const imagesToSend = pendingImages
    const content = input.trim() || 'Please inspect the attached image.'
    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: new Date(),
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingImages([])
    setIsStreaming(true)
    setStreamingContent('')

    const chatHistory = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
    let accumulated = ''

    const abort = sendChatMessageStream(
      chatHistory,
      job.id,
      (token) => {
        accumulated += token
        setStreamingContent(accumulated)
      },
      () => {
        if (accumulated) {
          setMessages(prev => [...prev, { role: 'assistant', content: accumulated, timestamp: new Date() }])
        }
        setStreamingContent('')
        setIsStreaming(false)
        abortRef.current = null
      },
      (err) => {
        const errMsg = err || 'Sorry, I encountered an error. Please try again.'
        setMessages(prev => [...prev, { role: 'assistant', content: errMsg, timestamp: new Date() }])
        setStreamingContent('')
        setIsStreaming(false)
        setPendingImages([])
        abortRef.current = null
      },
      selectedModel,
      imagesToSend.length > 0 ? imagesToSend : undefined,
    )
    abortRef.current = abort
  }

  const handleApplyScad = useCallback(async (scadSource: string, mode: 'replace' | 'patch') => {
    try {
      const previousSource = job.scadSource || ''
      if (mode === 'replace') {
        await onApplyScad(job, scadSource)
        if (previousSource) setLastAppliedSource(previousSource)
        toast.success('Applied and rendered', {
          description: 'The current SCAD was applied directly.',
        })
        return
      }

      const currentSource = previousSource
      const patchResult = mergeScadPatch(currentSource, scadSource)
      if (!currentSource || patchResult.changes.length === 0 || patchResult.source === currentSource) {
        toast.warning('Patch needs context', {
          description: 'I could not safely match this snippet to the current file. Ask for a full SCAD block or apply it manually in Code.',
        })
        return
      }

      await onApplyScad(job, patchResult.source)
      setLastAppliedSource(currentSource)
      toast.success('Patched and rendered', {
        description: `Updated ${patchResult.changes.slice(0, 3).join(', ')}${patchResult.changes.length > 3 ? '...' : ''}. No regeneration step was used.`,
      })
    } catch (err) {
      console.error('Failed to apply AI SCAD:', err)
      toast.error('Apply failed', {
        description: err instanceof Error ? err.message : 'Failed to apply SCAD to the current job',
      })
    }
  }, [job, onApplyScad, toast])

  const handleUndoApply = useCallback(async () => {
    if (!lastAppliedSource) return
    const currentSource = job.scadSource || ''
    try {
      await onApplyScad(job, lastAppliedSource)
      setLastAppliedSource(currentSource || null)
      toast.success('Apply reverted', {
        description: 'Restored the previous SCAD source and rendered it again.',
      })
    } catch (err) {
      toast.error('Undo failed', {
        description: err instanceof Error ? err.message : 'Could not restore previous SCAD',
      })
    }
  }, [job, lastAppliedSource, onApplyScad, toast])

  const createMarkdownComponents = useCallback((enableScadApply: boolean) => ({
    code({ className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const isInline = !match
      const codeStr = String(children).replace(/\n$/, '')
      const language = match?.[1]?.toLowerCase()
      const canApplyScad = enableScadApply && (language === 'openscad' || language === 'scad')
      const applyMode = hasCompleteScadShape(codeStr) ? 'replace' : 'patch'
      return isInline ? (
        <code className="bg-[var(--app-surface-raised)] px-1 py-0.5 rounded text-[13px] text-[var(--app-accent-text)]" {...props}>
          {children}
        </code>
      ) : (
        <div className="relative group flex flex-col my-1">
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <CodeCopyButton text={codeStr} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={match?.[1] || 'text'}
            PreTag="div"
            customStyle={{
              fontSize: '10px',
              borderRadius: '6px',
              margin: '0',
              padding: '8px',
            }}
          >
            {codeStr}
          </SyntaxHighlighter>
          {canApplyScad && (
            <div className="mt-1.5 flex justify-end">
              <ScadApplyButton text={codeStr} mode={applyMode} onApply={handleApplyScad} />
            </div>
          )}
        </div>
      )
    },
  }), [handleApplyScad])

  const assistantMarkdownComponents = useMemo(() => createMarkdownComponents(true), [createMarkdownComponents])
  const streamingMarkdownComponents = useMemo(() => createMarkdownComponents(false), [createMarkdownComponents])

  const proseClasses = "prose prose-invert prose-xs max-w-none [&_pre]:rounded-md [&_pre]:bg-[var(--app-bg)] [&_pre]:border [&_pre]:border-[color:var(--app-border)] [&_pre]:p-2 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_code]:text-[var(--app-accent-text)] [&_code]:before:content-none [&_code]:after:content-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-sm [&_strong]:text-[var(--app-text-primary)] [&_a]:text-[var(--app-accent-text)]"

  return (
    <div
      className={`relative flex h-full min-h-0 min-w-0 flex-col ${isDragOver ? 'ring-1 ring-[color:var(--app-accent)]' : ''}`}
      onPaste={handlePaste}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some(item => item.type.startsWith('image/'))) {
          e.preventDefault()
          setIsDragOver(true)
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border border-dashed border-[color:var(--app-accent)] bg-[var(--app-accent-bg)]/80 backdrop-blur-sm">
          <div className="rounded-lg border border-[color:var(--app-accent-border)] bg-[var(--app-surface)] px-3 py-2 text-center shadow-lg">
            <ImagePlus className="mx-auto mb-1 h-5 w-5 text-[var(--app-accent-text)]" />
            <p className="font-mono text-[13px] uppercase tracking-widest text-[var(--app-accent-text)]">Drop screenshot</p>
            <p className="mt-1 text-[13px] text-[var(--app-text-muted)]">Attach it to this CAD conversation</p>
          </div>
        </div>
      )}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[color:var(--app-border)] px-3 py-2">
        <h3 className="flex min-w-0 items-center gap-1.5 truncate text-eyebrow text-[var(--app-text-muted)]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--app-accent-text)]" />AI Assistant
        </h3>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {lastAppliedSource && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[8px] text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]"
              onClick={handleUndoApply}
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Undo apply
            </Button>
          )}
          {/* Model Picker */}
          <div className="relative min-w-0" ref={modelPickerRef}>
            <button
              className="flex max-w-36 items-center gap-1 truncate rounded px-1.5 py-0.5 font-mono text-xs text-[var(--app-text-muted)] transition-all hover:text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] active:scale-[0.97] cursor-pointer"
              onClick={() => setShowModelPicker(!showModelPicker)}
            >
              <span className="truncate">{currentModel?.name || 'MiMo-V2.5-Pro'}</span>
              {isMultimodal && <Eye className="w-2.5 h-2.5 text-[var(--app-accent-text)]" />}
              {currentModel?.reasoning && <Brain className="w-2.5 h-2.5 text-[var(--app-accent-text)]" />}
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {showModelPicker && (
              <div className="absolute right-0 top-full z-50 mt-1 max-h-[400px] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[color:var(--app-border)] bg-[var(--app-surface)] py-1 shadow-xl" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--app-scrollbar-thumb) var(--app-surface)' }}>
                {/* Provider filter tabs */}
                <div className="flex gap-0.5 px-2 py-1.5 border-b border-[color:var(--app-border-separator)] overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  <button
                    className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 transition-colors ${!providerFilter ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]'}`}
                    onClick={() => setProviderFilter(null)}
                  >
                    All
                  </button>
                  {providers.map(p => (
                    <button
                      key={p.id}
                      className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 transition-colors ${providerFilter === p.id ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-secondary)]'}`}
                      onClick={() => setProviderFilter(p.id === providerFilter ? null : p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {/* Model groups by provider */}
                {groupedModels.map(group => (
                  <div key={group.provider}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[8px] font-mono text-[var(--app-text-dim)] uppercase tracking-wider">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[group.provider] || '#71717a' }} />
                      {group.providerName}
                    </div>
                    {group.models.map(model => {
                      const catStyle = CATEGORY_STYLES[model.category] || CATEGORY_STYLES.flagship
                      return (
                        <button
                          key={model.id}
                          className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 transition-colors ${
                            selectedModel === model.id ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-hover-subtle)]'
                          }`}
                          onClick={() => { setSelectedModel(model.id); setShowModelPicker(false) }}
                        >
                          <span className={`flex items-center gap-0.5 ${catStyle.color}`}>
                            {catStyle.icon}
                          </span>
                          <span className="font-mono font-medium">{model.name}</span>
                          {model.multimodal && <Eye className="w-2 h-2 text-emerald-400" />}
                          {model.reasoning && <Brain className="w-2 h-2 text-[var(--app-accent-text)]" />}
                          <span className="text-[8px] text-[var(--app-text-dim)] ml-auto truncate max-w-[80px]">{model.description.slice(0, 20)}...</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-4 text-[8px] text-[var(--app-text-dim)] hover:text-[var(--app-text-muted)]" onClick={() => { setMessages([]); setStreamingContent(''); localStorage.removeItem(`chat-${job.id}`) }}>
              Clear
            </Button>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--app-scrollbar-thumb) var(--app-scrollbar-track)' }}>
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--app-text-dim)] gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--app-accent-bg)] flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-[var(--app-accent)]" />
            </div>
            <div className="text-center">
              <p className="text-xs">Ask about this CAD job</p>
              <p className="text-[13px] text-[var(--app-text-dim)] mt-1">Using {currentModel?.name || 'MiMo-V2.5-Pro'} by {currentModel?.providerName || 'Xiaomi MiMo'}</p>
            </div>
            <div className="mt-1 flex max-w-[280px] flex-wrap justify-center gap-1 px-2">
              {suggestions.map(q => (
                <button
                  key={q}
                  className="text-xs font-mono text-[var(--app-text-dim)] bg-[var(--app-surface-hover)] px-2 py-1 rounded-md hover:text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] transition-colors"
                  onClick={() => setInput(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
              className={`flex min-w-0 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
            <div className={`max-w-[92%] overflow-hidden rounded-lg px-3 py-2 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[var(--app-accent-bg)] text-[var(--app-accent-text)] border border-[color:var(--app-accent-border)]'
                : 'bg-[var(--app-surface-raised)] text-[var(--app-text-secondary)] border border-[color:var(--app-border)]'
            }`}>
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-1 mb-1">
                  <Sparkles className="w-2.5 h-2.5 text-[var(--app-accent-text)]" />
                  <span className="text-[8px] font-mono text-[var(--app-accent-text)]">AgentSCAD</span>
                  <span className="ml-auto text-[8px] font-mono text-[var(--app-text-dim)] flex items-center gap-0.5">
                    <Clock className="w-2 h-2" />{formatTimestamp(msg.timestamp)}
                  </span>
                </div>
              )}
              {msg.role === 'user' && (
                <div className="flex items-center justify-end gap-0.5 mb-1">
                  <span className="text-[8px] font-mono text-[var(--app-accent-text)] flex items-center gap-0.5">
                    <Clock className="w-2 h-2" />{formatTimestamp(msg.timestamp)}
                  </span>
                </div>
              )}
              {msg.role === 'assistant' ? (
                <div className={proseClasses}>
                  <ReactMarkdown components={assistantMarkdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                  <MessagePatchButton
                    blocks={extractScadCodeBlocks(msg.content)}
                    onApply={handleApplyScad}
                    className="mt-2 w-full justify-center py-1"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                      {msg.images.map((img, imageIndex) => (
                        <button
                          key={`${i}-${imageIndex}`}
                          className="group/image overflow-hidden rounded-md border border-[color:var(--app-accent-border)] bg-[var(--app-surface)] p-0.5"
                          onClick={() => window.open(img, '_blank', 'noopener,noreferrer')}
                          title="Open attached screenshot"
                        >
                          <img
                            src={img}
                            alt={`Attached screenshot ${imageIndex + 1}`}
                            className="h-20 w-24 rounded object-cover transition-transform group-hover/image:scale-105"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              )}
            </div>
          </div>
        ))}
        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed bg-[var(--app-surface-raised)] text-[var(--app-text-secondary)] border border-[color:var(--app-border)]">
              <div className="flex items-center gap-1 mb-1">
                <Sparkles className="w-2.5 h-2.5 text-[var(--app-accent-text)] animate-pulse" />
                <span className="text-[8px] font-mono text-[var(--app-accent-text)]">AgentSCAD</span>
                <span className="text-[8px] font-mono text-[var(--app-accent-text)] animate-pulse">generating...</span>
              </div>
              <div className={proseClasses}>
                <ReactMarkdown components={streamingMarkdownComponents}>
                  {streamingContent}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}
        {/* Typing indicator (before first token) */}
        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-[var(--app-surface-raised)] border border-[color:var(--app-border)] rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-[var(--app-accent-text)]" />
                <span className="text-[13px] text-[var(--app-text-muted)]">Thinking...</span>
                <div className="flex gap-1 ml-1">
                  <span className="typing-wave-dot" />
                  <span className="typing-wave-dot" />
                  <span className="typing-wave-dot" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[color:var(--app-border)] p-2">
        {/* Pending images preview */}
        {pendingImages.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img} alt={`Upload ${i + 1}`} className="w-10 h-10 rounded object-cover border border-[color:var(--app-border)]" />
                <button
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeImage(i)}
                >
                  <X className="w-2 h-2" />
                </button>
              </div>
            ))}
            <span className="text-[8px] font-mono text-[var(--app-text-dim)] self-center">{pendingImages.length} image{pendingImages.length > 1 ? 's' : ''}</span>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Image upload button (for multimodal models) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageUpload}
          />
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 w-7 p-0 shrink-0 ${isMultimodal ? 'text-[var(--app-accent-text)] hover:text-[var(--app-accent-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-accent-text)]'}`}
            onClick={() => {
              if (isStreaming) return
              if (!isMultimodal && !ensureVisionModel()) return
              fileInputRef.current?.click()
            }}
            disabled={isStreaming}
            title={isMultimodal ? 'Attach, paste, or drop an image' : 'Switch to a vision model and attach image'}
          >
            <ImagePlus className="w-3.5 h-3.5" />
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={isMultimodal ? 'Paste screenshot or ask about this CAD...' : 'Ask about this design...'}
            className="h-7 min-w-0 bg-[var(--app-bg)] text-sm border-[color:var(--app-border)] placeholder:text-[var(--app-text-dim)]"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button size="sm" className="h-7 w-7 p-0 bg-rose-600 hover:bg-rose-500 shrink-0 stop-btn-pulse" onClick={handleStop}>
              <Square className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button size="sm" className="h-7 w-7 p-0 bg-[var(--app-accent)] hover:bg-[var(--app-accent-hover)] shrink-0" onClick={handleSend} disabled={!input.trim() && pendingImages.length === 0}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
