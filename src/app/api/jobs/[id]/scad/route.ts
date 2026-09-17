import { claimJobExecution, canProcessJobState, JobExecutionConflict, JobExecutionStopped, type JobExecution } from '@/lib/pipeline/job-execution'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { trackVersion } from '@/lib/version-tracker'
import { toPublicJob } from '@/lib/public-job'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let execution: JobExecution | undefined
  try {
    const access = await getJobAccessScope(request)
    if (!access) {
      return NextResponse.json({ error: 'Browser session required' }, { status: 401 })
    }
    const { id } = await params
    const body = await request.json()
    const { scadSource } = body

    if (typeof scadSource !== 'string') {
      return NextResponse.json({ error: 'scadSource must be a string' }, { status: 400 })
    }

    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!canProcessJobState(job.state)) throw new JobExecutionConflict()
    execution = await claimJobExecution(job, 'DEBUGGING')
    // Track version history before updating
    await trackVersion(id, 'scadSource', job.scadSource, scadSource)

    const updated = await execution.update({
      where: { id },
      data: {
        scadSource, state: job.state === 'CANCELLED' ? 'CANCELLED' : 'HUMAN_REVIEW',
        stlPath: null, pngPath: null, renderLog: null, reportPath: null,
        validationResults: null, validationReportJson: null, qualityScore: null,
        visualRepairReportJson: null,
      },
    })

    return NextResponse.json({ job: toPublicJob(updated) })
  } catch (error) {
    if (error instanceof JobExecutionConflict || error instanceof JobExecutionStopped) return NextResponse.json({ error: error.message }, { status: 409 })
    if (execution) {
      try { await execution.update({ data: { state: 'HUMAN_REVIEW' } }) } catch { /* Preserve cancellation or deletion. */ }
    }
    console.error('Update SCAD error:', error)
    return NextResponse.json({ error: 'Failed to update SCAD source' }, { status: 500 })
  } finally {
    await execution?.release()
  }
}
