import { NextResponse } from 'next/server'
import { videoIntelligence, readObservations } from '@/lib/media-command/video-intelligence'
import {
  searchPersistedObservations,
  executeVideoAnalysis,
  parseWave2QueryValue,
  WAVE2_AUDIO_QUERY_VALUES,
  WAVE2_MOTION_QUERY_VALUES,
  type Wave2SearchQuery,
} from '@/lib/media-command/video-analysis'
import { loadProject } from '@/lib/media-command/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? undefined
  const assetId = url.searchParams.get('assetId')
  const q = url.searchParams.get('q')
  const motion = url.searchParams.get('motion')
  const audioState = url.searchParams.get('audioState')
  const timestampSec = url.searchParams.get('t')
  const sceneBoundary = url.searchParams.get('sceneBoundary') === '1'
  const motionQuery = motion == null ? undefined : parseWave2QueryValue(motion, WAVE2_MOTION_QUERY_VALUES)
  if (motionQuery === null) {
    return NextResponse.json({ error: `motion must be one of: ${WAVE2_MOTION_QUERY_VALUES.join(', ')}.` }, { status: 400 })
  }
  const audioStateQuery = audioState == null ? undefined : parseWave2QueryValue(audioState, WAVE2_AUDIO_QUERY_VALUES)
  if (audioStateQuery === null) {
    return NextResponse.json({ error: `audioState must be one of: ${WAVE2_AUDIO_QUERY_VALUES.join(', ')}.` }, { status: 400 })
  }
  const doc = projectId && assetId ? await readObservations(projectId, assetId) : null
  const observations = doc?.observations ?? (assetId ? videoIntelligence.getObservations(assetId) : [])
  const query: Wave2SearchQuery = {
    text: q ?? undefined,
    motion: motionQuery,
    audioState: audioStateQuery,
    timestampSec: timestampSec != null ? Number(timestampSec) : undefined,
    sceneBoundary: sceneBoundary || undefined,
  }
  const hits = doc ? searchPersistedObservations(doc, query) : []
  return NextResponse.json({
    jobs: videoIntelligence.listJobs(projectId),
    observations,
    hits,
    techniques: videoIntelligence.getTechniques(projectId),
    status: doc ? 'COMPLETED' : 'NOT ANALYZED',
    completed: Boolean(doc && doc.observationCount > 0),
    backend: doc?.backend ?? null,
    observationCount: doc?.observationCount ?? 0,
    lastAnalyzed: doc?.createdAt ?? null,
    assetFingerprint: doc?.assetChecksumSha256 ?? null,
    note: 'Video Intelligence analyzes authorized/local video only. Person observation is not identity. Transcript is null until an ASR backend exists.',
  })
}

export async function POST(req: Request) {
  let body: { projectId?: string; assetId?: string; force?: boolean; analysisConfig?: string } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.projectId || !body.assetId) {
    return NextResponse.json({ error: 'projectId and assetId are required.' }, { status: 400 })
  }
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const asset = project.assets.find(a => a.id === body.assetId)
  if (!asset) return NextResponse.json({ error: 'Asset not in project.' }, { status: 404 })
  const executed = await executeVideoAnalysis({ project, assetId: body.assetId, force: Boolean(body.force), analysisConfig: body.analysisConfig })
  return NextResponse.json({
    job: executed.job,
    completed: executed.job.status === 'COMPLETED',
    observationCount: executed.document?.observationCount ?? 0,
    observationsPath: executed.job.outputs.observationsPath ?? null,
    cacheHit: executed.cacheHit,
    error: executed.error,
  }, { status: executed.error ? 500 : 201 })
}
