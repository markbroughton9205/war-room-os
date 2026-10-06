/**
 * HVS-GENERATIVE-VIDEO-01 — typed `hvs.generate.video` endpoint (local Wan 2.2 only).
 * Covered by the existing middleware/auth like every /api/media-command route.
 * HVS-GENERATIVE-VIDEO-01A: additionally verifies the Commander session in Node (requireCommanderSession), because
 * the edge middleware only checks local-session cookie SHAPE on loopback. A forged cookie must not reach the GPU.
 * No shell, no script, no path, no test hooks are reachable from HTTP. Never auto-downloads.
 */
import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import {
  cancelGeneration,
  generativeVideoStatus,
  getGeneration,
  submitGenerateVideo,
} from '@/lib/media-command/generative/jobs'
import { readGenerationReceipt } from '@/lib/media-command/generative/receipts'
import { parseGenerateVideoUtterance } from '@/lib/media-command/generative/director'
import { isSafeHvsId } from '@/lib/media-command/generative/contract'
import { HVS_GENERATION_FORBIDDEN_KEYS } from '@/lib/media-command/generative/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_BODY_KEYS = ['action', 'request', 'generationId', 'utterance', 'projectId', 'selectedImageAssetId']

export async function GET(req: Request) {
  const commander = await requireCommanderSession('HVS local video generation status')
  if (!commander.ok) return commander.response
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const generationId = url.searchParams.get('generationId')
  if (projectId && !isSafeHvsId(projectId)) return NextResponse.json({ error: 'Invalid projectId.' }, { status: 400 })
  if (generationId) {
    if (!isSafeHvsId(generationId)) return NextResponse.json({ error: 'Invalid generationId.' }, { status: 400 })
    const live = getGeneration(generationId)
    const receipt = projectId ? readGenerationReceipt(projectId, generationId) : null
    return NextResponse.json({ generation: live, receipt })
  }
  return NextResponse.json(generativeVideoStatus(projectId))
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('HVS local video generation')
  if (!commander.ok) return commander.response
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  const forbidden = Object.keys(body).filter(k => (HVS_GENERATION_FORBIDDEN_KEYS as readonly string[]).includes(k) || !ALLOWED_BODY_KEYS.includes(k))
  if (forbidden.length) {
    return NextResponse.json({ error: { code: 'INVALID_GENERATION_REQUEST', message: `Field(s) not accepted: ${forbidden.join(', ')}` } }, { status: 400 })
  }
  if (body.action === 'generate') {
    const result = await submitGenerateVideo(body.request, { createdBy: 'human' })
    const status = result.status === 'QUEUED' ? 202 : result.error?.code === 'INVALID_GENERATION_REQUEST' ? 400 : 200
    return NextResponse.json({ result }, { status })
  }
  if (body.action === 'cancel') {
    if (!isSafeHvsId(body.generationId)) return NextResponse.json({ error: 'Invalid generationId.' }, { status: 400 })
    const result = cancelGeneration(body.generationId)
    return NextResponse.json({ result }, { status: result ? 200 : 404 })
  }
  if (body.action === 'propose') {
    if (typeof body.utterance !== 'string' || body.utterance.length > 2000) return NextResponse.json({ error: 'utterance required.' }, { status: 400 })
    const projectId = isSafeHvsId(body.projectId) ? body.projectId : undefined
    const selectedImageAssetId = isSafeHvsId(body.selectedImageAssetId) ? body.selectedImageAssetId : null
    const parsed = parseGenerateVideoUtterance(body.utterance, { projectId, selectedImageAssetId })
    return NextResponse.json({ proposal: parsed?.op ?? null, notes: parsed?.notes ?? [], executed: false })
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
