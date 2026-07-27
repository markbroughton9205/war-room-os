import { NextResponse } from 'next/server'
import { readCorpusManifest } from '@/lib/sovereign-model-lab/corpusBuilder'
import { buildCorpusForProgram } from '@/lib/sovereign-model-lab/runtime'
import { listCorpusVersions } from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CORPUS_ID = 'WRM-001'

/** Returns the most recently built corpus manifest for CURRENT CORPUS / CORPUS CLASSIFICATION. */
export async function GET() {
  const versions = await listCorpusVersions(CORPUS_ID)
  if (!versions.length) return NextResponse.json({ manifest: null })
  const manifest = await readCorpusManifest(CORPUS_ID, versions.at(-1)!)
  return NextResponse.json({ manifest })
}

/** Backs [ BUILD CORPUS ARTIFACT ]. Only ever includes Commander-approved, admitted documents. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await buildCorpusForProgram(id)
    const manifest = await readCorpusManifest(CORPUS_ID, result.corpusVersion)
    return NextResponse.json({ program: result.program, manifest })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
