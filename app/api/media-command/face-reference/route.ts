import { NextResponse } from 'next/server'
import { productionAuthorityOk } from '@/lib/media-command/production-ai'
import { auditCaptureDevices } from '@/lib/media-command/digital-human/devices'
import {
  faceStillBytes,
  HVS_FACE_REFERENCE_OPTIONAL,
  HVS_FACE_REFERENCE_REQUIRED,
  isRequiredType,
  readFaceReferenceSet,
  retakeStill,
  saveCapturedStill,
  type HvsFaceReferenceType,
} from '@/lib/media-command/digital-human/face-reference'
import { detectMetaHumanSupport } from '@/lib/media-command/unreal/metahuman-detect'
import { ensureMetaHumanBinding } from '@/lib/media-command/unreal/metahuman-binding'
import { HVS_UE01_PROJECT_ID } from '@/lib/media-command/unreal/package'
import { RAEL_CHARACTER_ID } from '@/lib/media-command/digital-human/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonError(message: string, status = 400, code = 'FACE_REFERENCE_FAILED') {
  return NextResponse.json({ ok: false, code, error: message, message }, { status })
}

function operatorCaptureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/CAPTURE_FAILED|length|undefined|JPEG still is required|no JPEG bytes/i.test(raw)) {
    return 'Could not capture the still. Please try again.'
  }
  return raw
}

function payload(projectId: string) {
  const face = readFaceReferenceSet(projectId)
  const stills = face.stills ?? {}
  const captures = Object.values(stills)
  return {
    ok: true,
    projectId,
    characterId: RAEL_CHARACTER_ID,
    cameraStarted: false,
    cameraDefaultOff: true,
    streamStarted: false,
    detect: detectMetaHumanSupport(),
    binding: ensureMetaHumanBinding(projectId),
    face,
    stills,
    captures,
    acceptedCaptures: captures.filter(item => item.accepted),
    required: HVS_FACE_REFERENCE_REQUIRED,
    optional: HVS_FACE_REFERENCE_OPTIONAL,
    devices: auditCaptureDevices(),
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || HVS_UE01_PROJECT_ID
  const type = url.searchParams.get('image')
  if (type && isRequiredType(type)) {
    const bytes = faceStillBytes(projectId, type)
    if (!bytes) return jsonError('Still not found.', 404)
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' },
    })
  }
  return NextResponse.json(payload(projectId))
}

export async function POST(req: Request) {
  const authority = productionAuthorityOk()
  if (!authority.ok) return jsonError(authority.error, 403)
  let body: {
    action?: string
    projectId?: string
    type?: string
    jpeg?: string
    meanLuma?: number
    centerLuma?: number
    sharpness?: number
    possibleOcclusion?: boolean
    consent?: string
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonError('I could not read that request.')
  }
  const projectId = body.projectId || HVS_UE01_PROJECT_ID
  if (body.action === 'check-camera') {
    const audit = auditCaptureDevices()
    return NextResponse.json({ ...payload(projectId), devices: audit, streamStarted: false, cameraStarted: false })
  }
  if (body.action === 'status' || body.action === 'start-session' || body.action === 'stop-camera') {
    return NextResponse.json(payload(projectId))
  }
  if (body.action === 'retake') {
    if (!body.type || !isRequiredType(body.type)) return jsonError('Unknown still type.')
    retakeStill(projectId, body.type)
    return NextResponse.json(payload(projectId))
  }
  if (body.action === 'capture' || body.action === 'use') {
    if (body.consent !== 'COMMANDER_SELF_AUTHORIZED') {
      return jsonError('Commander self-authorization is required for this capture only.')
    }
    if (!body.type || !isRequiredType(body.type)) return jsonError('Unknown still type.')
    if (!body.jpeg || typeof body.jpeg !== 'string') {
      return jsonError('Could not capture the still. Please try again.', 400, 'CAPTURE_FAILED')
    }
    const raw = body.jpeg.includes(',') ? body.jpeg.slice(body.jpeg.indexOf(',') + 1) : body.jpeg
    const jpeg = Buffer.from(raw, 'base64')
    if (!jpeg.length) {
      return jsonError('Could not capture the still. Please try again.', 400, 'CAPTURE_FAILED')
    }
    try {
      const saved = saveCapturedStill({
        projectId,
        type: body.type as HvsFaceReferenceType,
        jpeg,
        meanLuma: Number(body.meanLuma ?? 0),
        centerLuma: Number(body.centerLuma ?? 0),
        sharpness: Number(body.sharpness ?? 0),
        possibleOcclusion: Boolean(body.possibleOcclusion),
        accept: body.action === 'use',
      })
      const next = payload(projectId)
      return NextResponse.json({
        ...next,
        ok: true,
        code: body.action === 'use' ? 'STILL_ACCEPTED' : 'CAPTURE_REVIEW',
        message: body.action === 'use' ? `${body.type} accepted.` : 'Review the still. Use it or retake.',
        captureType: body.type,
        still: saved.still,
        quality: saved.quality,
        reviewAsset: saved.still.file,
        accepted: saved.still.accepted,
      })
    } catch (error) {
      console.error('[hvs-face-reference]', error)
      return jsonError(operatorCaptureMessage(error), 400, 'CAPTURE_FAILED')
    }
  }
  return jsonError('Unknown action.')
}
