import { Job } from './types'

// ─── API Functions ────────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string
  name: string
  type: string
  baseUrl: string
  defaultModel: string
  enabled: boolean
  isDefault: boolean
  hasApiKey: boolean
  apiKeyPreview?: string
}

export interface EnvProviderConfig {
  id: string
  name: string
  enabled: boolean
  envKey: string
}

export async function fetchProviders(): Promise<{ providers: ProviderConfig[]; envProviders: EnvProviderConfig[] }> {
  const res = await fetch('/api/providers')
  if (!res.ok) throw new Error('Failed to fetch providers')
  return res.json()
}

export async function saveProvider(input: {
  id?: string
  preset?: string
  name: string
  type: string
  baseUrl: string
  apiKey?: string
  keepExistingApiKey?: boolean
  defaultModel: string
  enabled: boolean
  isDefault: boolean
}): Promise<{ provider: ProviderConfig }> {
  const res = await fetch('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || 'Failed to save provider')
  }
  return res.json()
}

export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`/api/providers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete provider')
}

export async function testProvider(input: {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string
  defaultModel: string
}): Promise<{ ok: boolean; content?: string; error?: string }> {
  const res = await fetch('/api/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || 'Provider test failed')
  return data
}

export async function fetchJobs(state?: string): Promise<{ jobs: Job[]; pagination: { total: number } }> {
  const url = state ? `/api/jobs?state=${state}&limit=50&summary=true&count=false` : '/api/jobs?limit=50&summary=true&count=false'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch jobs')
  return res.json()
}

export async function fetchJob(id: string): Promise<{ job: Job }> {
  const res = await fetch(`/api/jobs/${id}`)
  if (!res.ok) throw new Error('Failed to fetch job')
  return res.json()
}

export async function createJob(inputRequest: string, customerId?: string, modelId?: string): Promise<{ job: Job }> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputRequest, customerId, modelId }),
  })
  if (!res.ok) throw new Error('Failed to create job')
  return res.json()
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete job')
}

export async function processJob(id: string, onEvent: (data: Record<string, unknown>) => void): Promise<void> {
  const res = await fetch(`/api/jobs/${id}/process`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to start processing')
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          onEvent(data)
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function updateParameters(id: string, parameterValues: Record<string, unknown>): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/parameters`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameterValues }),
  })
  if (!res.ok) {
    let message = 'Failed to update parameters'
    try {
      const errorData = await res.json()
      if (errorData?.error) {
        message = errorData.validationErrors?.length
          ? `${errorData.error}: ${errorData.validationErrors.join(', ')}`
          : errorData.details
            ? `${errorData.error}: ${errorData.details}`
            : errorData.error
      }
    } catch {
      // Keep the generic message when the response body is unavailable.
    }
    throw new Error(message)
  }
  const data = await res.json()
  return data.job
}

export async function repairJob(id: string): Promise<{ job: Job; repaired: boolean; recommendation: string; reason: string }> {
  const res = await fetch(`/api/jobs/${id}/repair`, { method: 'POST' })
  if (!res.ok) {
    let message = 'Failed to repair job'
    try {
      const errorData = await res.json()
      if (errorData?.error) message = errorData.error
    } catch {
      // Keep generic message.
    }
    throw new Error(message)
  }
  return res.json()
}

export async function visualRepairJob(id: string): Promise<{
  job: Job;
  repaired: boolean;
  visualReport?: {
    visual_issues: Array<{
      requirement: string;
      observed: string;
      severity: string;
      repair_hint: string;
    }>;
    overall_visual_match: number;
    repair_summary: string;
  };
  repairSummary?: string;
  error?: string;
}> {
  const res = await fetch(`/api/jobs/${id}/visual-repair`, { method: "POST" });
  if (!res.ok) {
    let message = "Failed to run visual repair";
    try {
      const errorData = await res.json();
      if (errorData?.error) message = errorData.error;
    } catch {
      // Keep generic message.
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Send a chat message and receive a streaming response via SSE.
 * Calls onToken for each token received, onDone when complete, and onError on failure.
 * Returns an abort function to cancel the stream.
 */
export function sendChatMessageStream(
  messages: Array<{ role: string; content: string }>,
  jobId: string | undefined,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  model?: string,
  images?: string[]
): () => void {
  const controller = new AbortController()

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, jobId, model, images }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onError('Chat request failed')
        return
      }
      const reader = res.body?.getReader()
      if (!reader) {
        onError('No response body')
        return
      }
      const decoder = new TextDecoder()
      let buffer = ''
      let didFinish = false
      const finishOnce = () => {
        if (didFinish) return
        didFinish = true
        onDone()
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'token' && data.content) {
                onToken(data.content)
              } else if (data.type === 'done') {
                finishOnce()
              } else if (data.type === 'error') {
                onError(data.message || 'Stream error')
              }
            } catch { /* skip malformed */ }
          }
        }
      }
      // Ensure done is called if stream ends without explicit done event
      finishOnce()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err instanceof Error ? err.message : 'Unknown error')
      }
    })

  return () => controller.abort()
}

/** Legacy non-streaming chat (kept for backwards compatibility) */
export async function sendChatMessage(messages: Array<{ role: string; content: string }>, jobId?: string, model?: string): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, jobId, model }),
  })
  if (!res.ok) throw new Error('Chat request failed')
  // Handle SSE response - collect all tokens
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          if (data.type === 'token' && data.content) {
            fullContent += data.content
          }
        } catch { /* skip */ }
      }
    }
  }
  return fullContent || 'No response'
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/cancel`, { method: 'PATCH' })
  if (!res.ok) throw new Error('Failed to cancel job')
  const data = await res.json()
  return data.job
}

export async function updateNotes(id: string, notes: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/notes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  })
  if (!res.ok) throw new Error('Failed to update notes')
  const data = await res.json()
  return data.job
}

export async function linkJob(id: string, parentId: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  })
  if (!res.ok) throw new Error('Failed to link job')
  const data = await res.json()
  return data.job
}

export async function unlinkJob(id: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId: null }),
  })
  if (!res.ok) throw new Error('Failed to unlink job')
  const data = await res.json()
  return data.job
}

export async function updateScadSource(id: string, scadSource: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${id}/scad`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scadSource }),
  })
  if (!res.ok) throw new Error('Failed to update SCAD source')
  const data = await res.json()
  return data.job
}

export async function applyScadSource(
  id: string,
  scadSource: string,
  onEvent: (data: Record<string, unknown>) => void
): Promise<void> {
  const res = await fetch(`/api/jobs/${id}/scad/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scadSource }),
  })
  if (!res.ok) throw new Error('Failed to apply SCAD source')

  const reader = res.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        onEvent(data)
      } catch {
        // Ignore malformed SSE frames and keep reading.
      }
    }
  }
}

export async function batchOperation(action: 'delete' | 'cancel' | 'reprocess', jobIds: string[]): Promise<{ results: { success: string[]; failed: string[] } }> {
  const res = await fetch('/api/jobs/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, jobIds }),
  })
  if (!res.ok) throw new Error('Batch operation failed')
  return res.json()
}

export interface JobVersion {
  id: string
  jobId: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
  createdAt: string
}

export async function fetchJobVersions(id: string): Promise<{ versions: JobVersion[] }> {
  const res = await fetch(`/api/jobs/${id}/versions`)
  if (!res.ok) throw new Error('Failed to fetch versions')
  return res.json()
}

export async function batchUpdateParameters(jobIds: string[], parameterValues: Record<string, number>): Promise<{ results: { success: string[]; failed: string[] } }> {
  const res = await fetch('/api/jobs/batch-params', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds, parameterValues }),
  })
  if (!res.ok) throw new Error('Batch parameter update failed')
  return res.json()
}

// ─── Model Selection ──────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string
  name: string
  description: string
  provider: string
  providerName: string
  multimodal: boolean
  reasoning: boolean
  category: "flagship" | "fast" | "reasoning" | "vision" | "code"
}

export async function fetchModels(): Promise<{ models: ModelInfo[] }> {
  const res = await fetch('/api/models')
  if (!res.ok) throw new Error('Failed to fetch models')
  return res.json()
}
