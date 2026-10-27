import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { toPublicJob } from '@/lib/public-job'
import { appendLog } from '@/lib/stores/job-store'

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
      // The rejectable states are exactly the in-flight ones, so "not
      // cancelable" means "not running" - and that is what the user needs to
      // hear. Naming the state would put an internal enum into user-facing
      // copy, the same rule as never showing a rule id (DESIGN.md §18).
      return NextResponse.json(
        { error: 'This job is not running, so there is nothing to cancel.' },
        { status: 400 }
      )
    }

    const cancelled = await db.job.updateMany({
      where: { id, ...jobAccessFilter(access), state: { in: CANCELABLE_STATES } },
      data: {
        state: 'CANCELLED',
        completedAt: new Date(),
        /*
         * A cancellation used to leave no trace beyond the state itself, so the
         * log could not tell "the user stopped this" from "the run was killed".
         * The reason is the whole point of the entry - without it the ledger
         * records that something ended, not why.
         *
         * What it says deliberately avoids the state enum: what the user needs
         * to know is that they stopped it, and what was kept.
         */
        executionLogs: appendLog(
          job.executionLogs,
          'CANCELLED',
          'Stopped by the user before the part was finished.'
        ),
      },
    })

    if (cancelled.count !== 1) {
      return NextResponse.json({ error: 'Job state changed before cancellation' }, { status: 409 })
    }
    const updated = await db.job.findUniqueOrThrow({ where: { id } })
    return NextResponse.json({ job: toPublicJob(updated) })
  } catch (error) {
    console.error('Cancel job error:', error)
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 })
  }
}
