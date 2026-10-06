import { NextResponse } from 'next/server'
import { createProject, loadProject, saveProject } from '@/lib/media-command/store'
import { productionAuthorityOk } from '@/lib/media-command/production-ai'
import { HVS } from '@/lib/media-command/hvs-producer-contract'
import { auditCaptureDevices } from '@/lib/media-command/digital-human/devices'
import { auditMotionRuntime } from '@/lib/media-command/digital-human/motion-runtime'
import { auditLandmarkRuntime, commanderFailure, computeBodyCoverage } from '@/lib/media-command/digital-human/landmark-adapter'
import { assessFullBodyReadiness, inferMoveNet, loadPerformanceFrames } from '@/lib/media-command/digital-human/movenet'
import { grabExplicitFrames, HVS_ACCEPTANCE_TAKE_FRAMES, HVS_READINESS_WINDOW_FRAMES } from '@/lib/media-command/digital-human/capture'
import { reuseCrowdMotion } from '@/lib/media-command/digital-human/retarget'
import { selectCaptureDevice } from '@/lib/media-command/digital-human/devices'
import { unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureDigitalHumanStore } from '@/lib/media-command/digital-human/contract'
import { RAEL_CHARACTER_ID } from '@/lib/media-command/digital-human/types'
import { readFileSync, existsSync } from 'node:fs'
import { findAsset } from '@/lib/media-command/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function projectFor(body: { projectId?: string; create?: boolean; name?: string }) {
  if (body.projectId) {
    const existing = await loadProject(body.projectId)
    if (!existing) throw new Error('Project not found.')
    return existing
  }
  if (!body.create) return null
  return createProject({ name: body.name ?? 'HVS Actors', productionMode: 'CUSTOM' })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('audit') === '1') {
    const audit = auditCaptureDevices()
    const landmarks = auditLandmarkRuntime()
    return NextResponse.json({
      ...audit,
      motion: auditMotionRuntime(),
      tracking: landmarks.inferenceReady ? 'READY' : 'MODEL REQUIRED',
      model: landmarks.inferenceReady ? 'READY' : 'MODEL REQUIRED',
      landmarkStatus: landmarks.status,
      streamStarted: false,
    })
  }
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonError('projectId is required.')
  const project = await loadProject(projectId)
  if (!project) return jsonError('Project not found.', 404)
  const store = ensureDigitalHumanStore(project)
  const assetId = url.searchParams.get('frameAssetId')
  if (assetId) {
    const asset = findAsset(project, assetId)
    if (!asset || !existsSync(asset.originalPath)) return jsonError('Capture not found.', 404)
    const bytes = readFileSync(asset.originalPath)
    const end = bytes.indexOf(Buffer.from([0xff, 0xd9]), 2)
    const frame = end > 0 ? bytes.subarray(0, end + 2) : bytes.subarray(0, Math.min(bytes.length, 200000))
    return new NextResponse(new Uint8Array(frame), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
  }
  const selectedTake = [...store.takes].reverse().find(item => item.selected) ?? null
  const raelRef = [...store.references].reverse().find(item => item.characterId === RAEL_CHARACTER_ID) ?? null
  const selectedMotion = store.motions.find(item => item.id === selectedTake?.motionRef)
  const selectedFrames = loadPerformanceFrames(selectedMotion).filter(frame => frame.bodyLandmarks.length > 0)
  return NextResponse.json({
    projectId: project.id,
    rael: store.characters.find(item => item.id === RAEL_CHARACTER_ID) ?? null,
    characters: store.characters,
    populations: store.populations,
    takes: store.takes,
    selectedTake,
    performanceLabel: raelRef ? `Ra'el performance ${raelRef.takeId}` : null,
    motion: {
      ...auditMotionRuntime(),
      landmarkFrames: selectedFrames.length,
      overlay: selectedFrames.map(frame => ({
        i: frame.frameIndex,
        points: frame.bodyLandmarks.map(point => ({
          name: String(point.canonicalName ?? point.name),
          x: point.x,
          y: point.y,
          confidence: point.confidence,
        })),
      })),
    },
    sessions: store.captureSessions,
    bindings: store.sceneBindings,
    warnings: store.warnings,
    tracking: auditLandmarkRuntime().inferenceReady ? 'READY' : 'MODEL REQUIRED',
    model: auditLandmarkRuntime().inferenceReady ? 'READY' : 'MODEL REQUIRED',
    coverage: selectedTake?.frameTrackingCoverage ?? selectedTake?.trackingCoverage ?? selectedMotion?.confidence?.frameTrackingCoverage ?? selectedMotion?.confidence?.trackingCoverage ?? null,
    frameTrackingCoverage: selectedTake?.frameTrackingCoverage ?? selectedMotion?.confidence?.frameTrackingCoverage ?? null,
    fullBodyCoverage: selectedTake?.fullBodyCoverage ?? selectedMotion?.confidence?.fullBodyCoverage ?? null,
    standingReadiness: selectedTake?.standingReadiness ?? null,
    bodyBinding: HVS.resolveCharacterBody(project),
  })
}

export async function POST(req: Request) {
  const authority = productionAuthorityOk()
  if (!authority.ok) return jsonError(authority.error, 403)
  let body: {
    action?: string
    projectId?: string
    prompt?: string
    characterId?: string
    sessionId?: string
    takeId?: string
    mode?: 'BODY_REFERENCE'
    frames?: number
  } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return jsonError('I could not read that request.')
  }
  try {
    if (body.action === 'frame-check') {
      const audit = auditCaptureDevices()
      const device = selectCaptureDevice(audit.devices)
      if (!device) return jsonError('The camera is not available.')
      const outPath = path.join(os.tmpdir(), `hvs-frame-check-${Date.now()}.mjpg`)
      const grab = grabExplicitFrames({ device: device.node, outPath, frames: HVS_READINESS_WINDOW_FRAMES })
      if (!grab.ok || !grab.path) return jsonError('The framing check could not read the camera.')
      const extracted = inferMoveNet({ mjpgPath: grab.path, fps: 30 })
      try { unlinkSync(grab.path) } catch { /* temp frame already gone */ }
      const readiness = assessFullBodyReadiness(extracted.frames, { meanLuma: extracted.failure === 'LOW_LIGHT' ? 10 : 40 })
      const coverage = computeBodyCoverage(extracted.frames)
      const frame = [...extracted.frames].reverse().find(item => item.bodyLandmarks.length > 0) ?? null
      return NextResponse.json({
        cameraActive: false,
        deviceReleased: true,
        readiness,
        coverage: coverage.frameTrackingCoverage,
        frameTrackingCoverage: coverage.frameTrackingCoverage,
        fullBodyCoverage: coverage.fullBodyCoverage,
        readinessMs: (grab.interFrameMs ?? []).reduce((sum, value) => sum + value, 0) + (grab.firstFrameMs ?? 0),
        tracking: auditLandmarkRuntime().inferenceReady ? 'READY' : 'MODEL REQUIRED',
        model: auditLandmarkRuntime().inferenceReady ? 'READY' : 'MODEL REQUIRED',
        motion: {
          status: extracted.status,
          landmarkFrames: extracted.frames.filter(item => item.bodyLandmarks.length > 0).length,
          overlay: extracted.frames.filter(item => item.bodyLandmarks.length > 0).map(item => ({
            i: item.frameIndex,
            points: item.bodyLandmarks.map(point => ({
              name: String(point.canonicalName ?? point.name),
              x: point.x,
              y: point.y,
              confidence: point.confidence,
            })),
          })),
        },
      })
    }
    const create = body.action === 'authorize-rael' || body.action === 'direct' || body.action === 'foundation'
    const project = await projectFor({ projectId: body.projectId, create, name: 'HVS Actors' })
    if (!project) return jsonError('Open a production first.')
    const store = ensureDigitalHumanStore(project)
    if (body.action === 'authorize-rael' || body.action === 'foundation') {
      HVS.castCharacter(project, { displayName: "Ra'el", roleName: 'lead', roleType: 'LEAD', actor: 'commander' })
    } else if (body.action === 'direct') {
      HVS.directPerformance(project, body.prompt ?? '', 'commander')
    } else if (body.action === 'capture-start') {
      const session = HVS.startPerformanceCapture(project, { characterId: body.characterId ?? RAEL_CHARACTER_ID, mode: body.mode ?? 'BODY_REFERENCE', actor: 'commander' })
      await saveProject(project)
      return NextResponse.json({ projectId: project.id, session, cameraActive: true, devices: store.devices })
    } else if (body.action === 'acceptance-take') {
      const device = selectCaptureDevice(auditCaptureDevices().devices)
      if (!device || device.type !== 'VIDEO_CAPTURE') return jsonError('The camera is not available.')
      const samplePath = path.join(os.tmpdir(), `hvs-acceptance-window-${Date.now()}.mjpg`)
      const sample = grabExplicitFrames({ device: device.node, outPath: samplePath, frames: HVS_READINESS_WINDOW_FRAMES })
      if (!sample.ok || !sample.path) return jsonError('The readiness window could not read the camera.')
      const sampled = inferMoveNet({ mjpgPath: sample.path, fps: 30 })
      try { unlinkSync(sample.path) } catch { /* temp sample already gone */ }
      const readiness = assessFullBodyReadiness(sampled.frames, { meanLuma: sampled.failure === 'LOW_LIGHT' ? 10 : 40 })
      const windowCoverage = computeBodyCoverage(sampled.frames)
      if (readiness.level !== 'FULL BODY READY') {
        return NextResponse.json({
          projectId: project.id,
          acceptance: 'FULL_BODY_FRAMING_NOT_ACHIEVED',
          readiness,
          frameTrackingCoverage: windowCoverage.frameTrackingCoverage,
          fullBodyCoverage: windowCoverage.fullBodyCoverage,
          readinessMs: (sample.interFrameMs ?? []).reduce((sum, value) => sum + value, 0) + (sample.firstFrameMs ?? 0),
          cameraActive: false,
          deviceReleased: true,
          take: null,
        })
      }
      const session = HVS.startPerformanceCapture(project, { characterId: body.characterId ?? RAEL_CHARACTER_ID, mode: 'BODY_REFERENCE', actor: 'commander' })
      const recorded = HVS.recordPerformanceTake(project, session.id, HVS_ACCEPTANCE_TAKE_FRAMES)
      if (session.characterId) {
        HVS.assignPerformanceReference(project, { takeId: recorded.take.id, characterId: session.characterId })
      }
      await saveProject(project)
      return NextResponse.json({
        projectId: project.id,
        acceptance: 'RECORDED',
        readiness,
        session,
        take: recorded.take,
        coverage: recorded.take.frameTrackingCoverage ?? recorded.take.trackingCoverage,
        frameTrackingCoverage: recorded.take.frameTrackingCoverage,
        fullBodyCoverage: recorded.take.fullBodyCoverage,
        motion: {
          status: recorded.motion.extractionStatus,
          failure: recorded.motion.failure ?? null,
          message: recorded.motion.failure ? commanderFailure(recorded.motion.failure) : null,
          landmarkFrames: recorded.motion.landmarkFrames?.length ?? 0,
          overlay: (recorded.motion.landmarkFrames ?? []).filter(frame => frame.bodyLandmarks.length > 0).map(frame => ({
            i: frame.frameIndex,
            points: frame.bodyLandmarks.map(point => ({
              name: String(point.canonicalName ?? point.name),
              x: point.x,
              y: point.y,
              confidence: point.confidence,
            })),
          })),
        },
        cameraActive: false,
        deviceReleased: session.deviceReleased,
      })
    } else if (body.action === 'capture-record') {
      const session = body.sessionId
        ? store.captureSessions.find(item => item.id === body.sessionId) ?? HVS.startPerformanceCapture(project, { characterId: body.characterId ?? null, actor: 'commander' })
        : HVS.startPerformanceCapture(project, { characterId: body.characterId ?? RAEL_CHARACTER_ID, actor: 'commander' })
      const recorded = HVS.recordPerformanceTake(project, session.id, typeof body.frames === 'number' ? body.frames : HVS_ACCEPTANCE_TAKE_FRAMES)
      if (session.characterId) {
        HVS.assignPerformanceReference(project, { takeId: recorded.take.id, characterId: session.characterId })
      }
      await saveProject(project)
      return NextResponse.json({
        projectId: project.id,
        session,
        take: recorded.take,
        coverage: recorded.take.frameTrackingCoverage ?? recorded.take.trackingCoverage,
        frameTrackingCoverage: recorded.take.frameTrackingCoverage,
        fullBodyCoverage: recorded.take.fullBodyCoverage,
        motion: {
          status: recorded.motion.extractionStatus,
          failure: recorded.motion.failure ?? null,
          message: recorded.motion.failure ? commanderFailure(recorded.motion.failure) : null,
          landmarkFrames: recorded.motion.landmarkFrames?.length ?? 0,
          overlay: (recorded.motion.landmarkFrames ?? []).filter(frame => frame.bodyLandmarks.length > 0).map(frame => ({
            i: frame.frameIndex,
            points: frame.bodyLandmarks.map(point => ({
              name: String(point.canonicalName ?? point.name),
              x: point.x,
              y: point.y,
              confidence: point.confidence,
            })),
          })),
        },
        cameraActive: false,
        deviceReleased: session.deviceReleased,
      })
    } else if (body.action === 'preview-performance') {
      if (!body.takeId) return jsonError('Choose a take first.')
      const preview = HVS.previewPerformance(project, body.takeId)
      return NextResponse.json({ projectId: project.id, preview })
    } else if (body.action === 'assign-performance') {
      if (!body.takeId) return jsonError('Choose a take first.')
      const reference = HVS.assignPerformanceReference(project, { takeId: body.takeId, characterId: body.characterId ?? RAEL_CHARACTER_ID })
      await saveProject(project)
      return NextResponse.json({
        projectId: project.id,
        reference,
        rael: store.characters.find(item => item.id === RAEL_CHARACTER_ID) ?? null,
        characters: store.characters,
      })
    } else if (body.action === 'reuse-crowd-motion') {
      const take = store.takes.find(item => item.id === body.takeId) ?? [...store.takes].reverse().find(item => item.selected) ?? store.takes.at(-1)
      if (!take) return jsonError('Capture a take before reusing it on background actors.')
      if (!store.populations[0]) {
        HVS.directPerformance(project, 'Add 12 background people in the alley. Most are walking. Three are standing near the storefront. When the collapse begins, the closest people turn and move away.', 'commander')
      }
      const population = store.populations[0]
      if (!population) return jsonError('Background actors are not available.')
      const uses = reuseCrowdMotion(store, {
        take,
        populationId: population.id,
        instanceIds: population.instances.slice(0, 4).map(item => item.id),
        seed: 11,
      })
      await saveProject(project)
      return NextResponse.json({
        projectId: project.id,
        crowdUses: uses,
        populations: store.populations,
        characters: store.characters,
      })
    } else if (body.action === 'bind-body-rig') {
      const rael = HVS.bindHumanoidRig(project, body.characterId ?? RAEL_CHARACTER_ID)
      await saveProject(project)
      return NextResponse.json({
        projectId: project.id,
        rael,
        characters: store.characters,
        bodyBinding: HVS.resolveCharacterBody(project),
      })
    } else if (body.action === 'preview-body-rig') {
      const bodyPreview = HVS.previewHumanoidBody(project, body.takeId)
      return NextResponse.json({
        projectId: project.id,
        bodyPreview,
        cameraActive: false,
      })
    } else if (body.action === 'capture-stop') {
      if (body.sessionId) HVS.stopPerformanceCapture(project, body.sessionId)
      await saveProject(project)
      return NextResponse.json({ projectId: project.id, cameraActive: false, sessions: store.captureSessions })
    } else {
      return jsonError('Unknown actor action.')
    }
    HVS.runCharacterQc(project)
    await saveProject(project)
    return NextResponse.json({
      projectId: project.id,
      rael: store.characters.find(item => item.id === RAEL_CHARACTER_ID) ?? null,
      characters: store.characters,
      populations: store.populations,
      bindings: store.sceneBindings,
      warnings: store.warnings,
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'HVS could not update the cast.')
  }
}
