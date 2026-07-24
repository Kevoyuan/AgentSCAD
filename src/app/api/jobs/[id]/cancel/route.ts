import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { toPublicJob } from '@/lib/public-job'

const CANCELABLE_STATES = ['NEW', 'SCAD_GENERATED', 'RENDERED', 'VALIDATED', 'DEBUGGING', 'REPAIRING']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await getJobAccessScope(request)
    if (!access) {
      return NextResponse.json({ error: 'Browser session required' }, { status: 401 })
    }
    const { id } = await params
    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) } })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!CANCELABLE_STATES.includes(job.state)) {
      return NextResponse.json(
        { error: `Cannot cancel job in state ${job.state}` },
        { status: 400 }
      )
    }

    const updated = await db.job.update({
      where: { id },
      data: {
        state: 'CANCELLED',
        completedAt: new Date(),
      },
    })

    return NextResponse.json({ job: toPublicJob(updated) })
  } catch (error) {
    console.error('Cancel job error:', error)
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 })
  }
}
