import { NextResponse } from 'next/server'
import { ingestDocumentForProgram, type IngestDocumentInput } from '@/lib/sovereign-model-lab/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Local-file ingest only — no remote URL is ever accepted or fetched here. localPath is
 * repo-root-contained by documentIngest.ts's resolveContainedPath regardless of what's submitted. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Partial<IngestDocumentInput> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (typeof body.localPath !== 'string' || !body.localPath.trim()) {
    return NextResponse.json({ error: 'localPath (a local repo-relative path) is required. Remote URLs are never accepted here.' }, { status: 400 })
  }
  if (/^[a-z]+:\/\//i.test(body.localPath)) {
    return NextResponse.json({ error: 'localPath must not be a URL — this endpoint never performs network retrieval.' }, { status: 400 })
  }
  if (!body.accessStatus || !body.license || !body.sourceType || !body.publisher || !body.title) {
    return NextResponse.json({ error: 'accessStatus, license, sourceType, publisher, and title are required.' }, { status: 400 })
  }

  const result = await ingestDocumentForProgram(id, body as IngestDocumentInput)
  if (result.error) return NextResponse.json({ error: result.error, program: result.program }, { status: 400 })
  return NextResponse.json(result)
}
