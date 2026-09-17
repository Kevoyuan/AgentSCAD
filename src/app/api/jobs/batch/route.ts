import { canProcessJobState, executeCadJob } from '@/lib/pipeline/execute-cad-job'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { deleteJobArtifacts } from '@/lib/tools/artifact-store'

export const maxDuration = 300

const CANCELABLE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

export async function POST(request: NextRequest) {
  try {
    const access = await getJobAccessScope(request)
    if (!access) {
      return NextResponse.json({ error: 'Browser session required' }, { status: 401 })
    }
    const accessFilter = jobAccessFilter(access)
    const body = await request.json()
    const { action, jobIds } = body as { action: string; jobIds: string[] }

    if (!action || !Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: 'Invalid request: action and jobIds required' }, { status: 400 })
    }

    let results: { success: string[]; failed: string[] } = { success: [], failed: [] }

    switch (action) {
      case 'delete': {
        const jobs = await db.job.findMany({
          where: { id: { in: jobIds }, ...accessFilter },
          select: { id: true },
        })
        const existingIds = jobs.map(job => job.id)
        await db.job.updateMany({
          where: { id: { in: existingIds }, ...accessFilter },
          data: { state: 'DELETING' },
        })
        const cleanupResults = await Promise.allSettled(
          existingIds.map(async id => {
            await deleteJobArtifacts(id)
            return id
          })
        )
        const cleanedIds = cleanupResults
          .filter(
            (result): result is PromiseFulfilledResult<string> =>
              result.status === 'fulfilled'
          )
          .map(result => result.value)
        if (cleanedIds.length > 0) {
          await db.job.deleteMany({
            where: { id: { in: cleanedIds }, ...accessFilter },
          })
        }
        results.success = cleanedIds
        results.failed = jobIds.filter(id => !cleanedIds.includes(id))
        break
      }

      case 'cancel': {
        await Promise.all([...new Set(jobIds)].map(async id => {
          const updated = await db.job.updateMany({
            where: { id, ...accessFilter, state: { in: CANCELABLE_STATES } },
            data: { state: 'CANCELLED', completedAt: new Date() },
          })
          ;(updated.count === 1 ? results.success : results.failed).push(id)
        }))
        break
      }

      case 'reprocess': {
        await Promise.all([...new Set(jobIds)].map(async id => {
          try {
            const job = await db.job.findFirst({ where: { id, ...accessFilter } })
            if (!job || !canProcessJobState(job.state) ||
              (job.state === 'HUMAN_REVIEW' && job.generationPath === 'intent_clarification')) {
              results.failed.push(id)
              return
            }
            let failed = false
            await executeCadJob(id, event => {
              if (['error', 'render_failed', 'cancelled'].includes(String(event.step))) failed = true
            })
            ;(failed ? results.failed : results.success).push(id)
          } catch {
            results.failed.push(id)
          }
        }))
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Batch operation error:', error)
    return NextResponse.json({ error: 'Batch operation failed' }, { status: 500 })
  }
}
