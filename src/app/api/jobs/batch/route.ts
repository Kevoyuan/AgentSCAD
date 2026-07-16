import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deleteJobArtifacts } from '@/lib/tools/artifact-store'

const CANCELABLE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, jobIds } = body as { action: string; jobIds: string[] }

    if (!action || !Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: 'Invalid request: action and jobIds required' }, { status: 400 })
    }

    let results: { success: string[]; failed: string[] } = { success: [], failed: [] }

    switch (action) {
      case 'delete': {
        const jobs = await db.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true },
        })
        const existingIds = jobs.map(job => job.id)
        await db.job.updateMany({
          where: { id: { in: existingIds } },
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
            where: { id: { in: cleanedIds } },
          })
        }
        results.success = cleanedIds
        results.failed = jobIds.filter(id => !cleanedIds.includes(id))
        break
      }

      case 'cancel': {
        const jobs = await db.job.findMany({
          where: { id: { in: jobIds } },
        })
        const cancelableIds = jobs
          .filter(j => CANCELABLE_STATES.includes(j.state))
          .map(j => j.id)
        const nonCancelableIds = jobIds.filter(id => !cancelableIds.includes(id))

        if (cancelableIds.length > 0) {
          await db.job.updateMany({
            where: { id: { in: cancelableIds } },
            data: { state: 'CANCELLED', completedAt: new Date() },
          })
        }
        results.success = cancelableIds
        results.failed = nonCancelableIds
        break
      }

      case 'reprocess': {
        const jobs = await db.job.findMany({
          where: { id: { in: jobIds } },
        })
        const reprocessableIds = jobs
          .filter(j => j.state === 'DELIVERED' || j.state === 'CANCELLED' || CANCELABLE_STATES.includes(j.state))
          .map(j => j.id)

        if (reprocessableIds.length > 0) {
          await db.job.updateMany({
            where: { id: { in: reprocessableIds } },
            data: { state: 'NEW', completedAt: null },
          })
        }
        results.success = reprocessableIds
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
