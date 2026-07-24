import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getJobAccessScope, jobAccessFilter } from '@/lib/job-session'
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
    const accessFilter = jobAccessFilter(access)
    const { id } = await params
    const body = await request.json()
    const { parentId } = body

    const job = await db.job.findFirst({ where: { id, ...accessFilter } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // If parentId is null/empty, unlink
    if (!parentId) {
      const updated = await db.job.update({
        where: { id },
        data: { parentId: null },
      })
      return NextResponse.json({ job: toPublicJob(updated) })
    }

    // Validate parent exists
    const parent = await db.job.findFirst({ where: { id: parentId, ...accessFilter } })
    if (!parent) {
      return NextResponse.json({ error: 'Parent job not found' }, { status: 404 })
    }

    // Prevent circular dependency (a job cannot be its own parent)
    if (parentId === id) {
      return NextResponse.json({ error: 'Cannot link job to itself' }, { status: 400 })
    }

    // Prevent deep circular dependency: check if the parent already has this job as an ancestor
    let currentParent: { id: string; parentId: string | null } | null = parent
    const visited = new Set<string>()
    while (currentParent) {
      if (currentParent.id === id) {
        return NextResponse.json({ error: 'Circular dependency detected' }, { status: 400 })
      }
      if (visited.has(currentParent.id)) break
      visited.add(currentParent.id)
      if (!currentParent.parentId) break
      currentParent = await db.job.findFirst({
        where: { id: currentParent.parentId, ...accessFilter },
      })
    }

    const updated = await db.job.update({
      where: { id },
      data: { parentId },
    })

    return NextResponse.json({ job: toPublicJob(updated) })
  } catch (error) {
    console.error('Link job error:', error)
    return NextResponse.json({ error: 'Failed to link job' }, { status: 500 })
  }
}
