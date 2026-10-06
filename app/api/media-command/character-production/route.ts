import { existsSync, readFileSync } from 'node:fs'
import { NextResponse } from 'next/server'
import { productionAuthorityOk } from '@/lib/media-command/production-ai'
import { hvsCharacterProductionOrchestrator } from '@/lib/media-command/character-production/orchestrator'
import { resolveProductionIntent, resolveUseRael } from '@/lib/media-command/character-production/director'
import { HVS_RAEL_PRODUCTION_PROJECT_ID } from '@/lib/media-command/character-production/types'
import { formatUnrealLaunchCommand } from '@/lib/media-command/unreal/process'
import { RAEL_CHARACTER_ID } from '@/lib/media-command/digital-human/types'
import { readHighFidelityPreview } from '@/lib/media-command/character-production/preview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId') ?? HVS_RAEL_PRODUCTION_PROJECT_ID
  try {
    if (url.searchParams.get('preview') === '1') {
      const preview = readHighFidelityPreview(projectId)
      if (!preview || !existsSync(preview.assetPath)) {
        return jsonError('HIGH-FIDELITY PREVIEW UNAVAILABLE', 404)
      }
      const bytes = readFileSync(preview.assetPath)
      return new NextResponse(bytes, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'no-store',
        },
      })
    }
    const snapshot = hvsCharacterProductionOrchestrator.snapshot(projectId)
    return NextResponse.json({
      ...snapshot,
      director: resolveUseRael(projectId),
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Character production status failed.', 500)
  }
}

export async function POST(request: Request) {
  const body = await request.json() as {
    action?: string
    projectId?: string
    launch?: boolean
    prompt?: string
    stage?: string
  }
  const projectId = body.projectId ?? HVS_RAEL_PRODUCTION_PROJECT_ID
  const authority = productionAuthorityOk()
  if (!authority.ok) return jsonError(authority.error, 403)
  try {
    if (body.action === 'status') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.snapshot(projectId))
    }
    if (body.action === 'build') {
      const snapshot = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: body.launch !== false, executeLive: false })
      return NextResponse.json({
        ...snapshot,
        authorized: true,
        characterId: RAEL_CHARACTER_ID,
      })
    }
    if (body.action === 'resume' || body.action === 'retry') {
      const snapshot = hvsCharacterProductionOrchestrator.build(projectId, { launchUnreal: body.launch !== false, resume: true, executeLive: false })
      return NextResponse.json(snapshot)
    }
    if (body.action === 'continue-rael-build') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.continueRaelBuild(projectId))
    }
    if (body.action === 'keep-local') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.keepLocal(projectId))
    }
    if (body.action === 'authorize-likeness') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.authorizeLikeness(projectId, {
        launchUnreal: body.launch !== false,
        executeLive: true,
      }))
    }
    if (body.action === 'open-required-step') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.openRequiredStep(projectId))
    }
    if (body.action === 'epic-signin') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.signInEpic(projectId))
    }
    if (body.action === 'refresh-preview') {
      return NextResponse.json(hvsCharacterProductionOrchestrator.refreshPreview(projectId, { launchUnreal: body.launch !== false }))
    }
    if (body.action === 'use-in-scene') {
      return NextResponse.json({
        ...hvsCharacterProductionOrchestrator.snapshot(projectId),
        director: resolveUseRael(projectId),
        used: "Use Ra'el",
      })
    }
    if (body.action === 'change-appearance') {
      return NextResponse.json({
        ...hvsCharacterProductionOrchestrator.snapshot(projectId),
        appearance: {
          future: true,
          options: ['Hair', 'Skin', 'Body', 'Wardrobe', 'Style'],
          mutatesUnrealInternals: false,
        },
      })
    }
    if (body.action === 'production-intent') {
      return NextResponse.json({
        ...resolveProductionIntent(body.prompt ?? '', projectId),
        generativeVideo: false,
      })
    }
    if (body.action === 'advanced-launch-command') {
      return NextResponse.json({ command: formatUnrealLaunchCommand() })
    }
    return jsonError('Unknown character production action.')
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Character production failed.'
    return NextResponse.json({
      error: raw.includes('PRIVACY') || raw.includes('IDENTITY') ? raw : 'Build could not finish.',
      message: 'Build could not finish.',
      advanced: raw,
    }, { status: 500 })
  }
}
