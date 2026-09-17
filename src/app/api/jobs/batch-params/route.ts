import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { updateJobParameters } from '@/lib/pipeline/update-job-parameters'

export const maxDuration = 300

/**
 * PATCH /api/jobs/batch-params
 * Batch update parameter values across multiple jobs
 */
export async function PATCH(request: NextRequest) {
  try {
    const access = await getJobAccessScope(request)
    if (!access) {
      return NextResponse.json({ error: 'Browser session required' }, { status: 401 })
    }
    const accessFilter = jobAccessFilter(access)
    const body = await request.json()
    const { jobIds, parameterValues } = body as {
      jobIds: string[]
      parameterValues: Record<string, number>
    }

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json(
        { error: 'jobIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (!parameterValues || typeof parameterValues !== 'object' || Array.isArray(parameterValues)) {
      return NextResponse.json(
        { error: 'parameterValues must be an object with key-value pairs' },
        { status: 400 }
      )
    }

    const success: string[] = []
    const failed: string[] = []

    await Promise.all([...new Set(jobIds)].map(async (jobId) => {
      try {
        const job = await db.job.findFirst({ where: { id: jobId, ...accessFilter } })
        if (!job) {
          failed.push(jobId)
          return
        }

        await updateJobParameters(job, parameterValues)

        success.push(jobId)
      } catch {
        failed.push(jobId)
      }
    }))

    return NextResponse.json({ results: { success, failed } })
  } catch (error) {
    console.error('Batch parameter update error:', error)
    return NextResponse.json(
      { error: 'Failed to update parameters' },
      { status: 500 }
    )
  }
}
