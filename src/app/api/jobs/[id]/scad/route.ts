import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
import { trackVersion } from '@/lib/version-tracker'
import { toPublicJob } from '@/lib/public-job'

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
    const body = await request.json()
    const { scadSource } = body

    if (typeof scadSource !== 'string') {
      return NextResponse.json({ error: 'scadSource must be a string' }, { status: 400 })
    }

    const job = await db.job.findFirst({ where: { id, ...jobAccessFilter(access) } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Track version history before updating
    await trackVersion(id, 'scadSource', job.scadSource, scadSource)

    const updated = await db.job.update({
      where: { id },
      data: { scadSource },
    })

    return NextResponse.json({ job: toPublicJob(updated) })
  } catch (error) {
    console.error('Update SCAD error:', error)
    return NextResponse.json({ error: 'Failed to update SCAD source' }, { status: 500 })
  }
}
