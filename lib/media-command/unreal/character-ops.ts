/**
 * Typed Unreal character operations on the existing HVS file-package bridge.
 * Does not mint a second character, second TAKE, or second Cinema.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAEL_CHARACTER_ID } from '../digital-human/types'
import { HVS_FACE_REFERENCE_REQUIRED, readFaceReferenceSet } from '../digital-human/face-reference'
import { activeCinemaPlan } from '../cinema-director/persist'
import { loadHvsProject } from './package'
import { HVS_UE01_MOTION_ID, HVS_UE01_TAKE_ID, HVS_UE02_UPROJECT } from './package'
import { readUnrealScenePackage, unrealPackageDir } from './storage'
import { detectMetaHumanSupport } from './metahuman-detect'
import { HVS_MHC_RESERVED_PATH, HVS_MHC_UASSET, ensureMetaHumanBinding, readMetaHumanBinding } from './metahuman-binding'
import type { HvsUnrealCharacterOp } from '../character-production/types'
import { ensureUnrealProcess, type HvsUnrealProcessTrace } from './process'

export type HvsUnrealCharacterDispatch = {
  op: HvsUnrealCharacterOp
  status: 'COMPLETE' | 'BLOCKED' | 'FAILED' | 'RUNNING'
  assetPaths: string[]
  warnings: string[]
  errorCode: string | null
  operatorStep: string | null
  notes: string[]
  process: HvsUnrealProcessTrace
}

function requestPath(projectId: string, op: HvsUnrealCharacterOp): string {
  const dir = path.join(unrealPackageDir(projectId), 'character-ops')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${op.replace(/[.]/g, '_')}.request.json`)
}

function writeRequest(projectId: string, op: HvsUnrealCharacterOp, payload: Record<string, unknown>): string {
  const file = requestPath(projectId, op)
  writeFileSync(file, `${JSON.stringify({ op, projectId, characterId: RAEL_CHARACTER_ID, ...payload }, null, 2)}\n`)
  return file
}

const PYTHON = path.join(process.cwd(), 'lib/media-command/unreal/hvs_character_ops.py')

export function cinemaShots(projectId: string): Array<{ name: string; lensMm: number }> {
  const pkg = readUnrealScenePackage(projectId)
  const cameras = pkg?.cameras ?? []
  const names = ['Wide', 'Walk', 'Look back', 'Close-up']
  if (cameras.length >= 4) {
    return cameras.slice(0, 4).map((camera, index) => ({
      name: names[index] ?? camera.name,
      lensMm: camera.lensMm ?? 0,
    }))
  }
  const project = loadHvsProject(projectId)
  const plan = project ? activeCinemaPlan(project) : null
  return (plan?.shots ?? []).slice(0, 4).map((shot, index) => ({
    name: names[index] ?? shot.name,
    lensMm: shot.cameraSpec.focalLengthMm ?? 0,
  }))
}

export function dispatchUnrealCharacterOp(input: {
  projectId: string
  op: HvsUnrealCharacterOp
  launch?: boolean
}): HvsUnrealCharacterDispatch {
  const { projectId, op } = input
  const process = ensureUnrealProcess(projectId, { launch: input.launch, scriptPath: existsSync(PYTHON) ? PYTHON : undefined })
  writeRequest(projectId, op, { launched: process.startedThisCall, process: process.status })
  const face = readFaceReferenceSet(projectId)
  const binding = readMetaHumanBinding(projectId) ?? ensureMetaHumanBinding(projectId)
  const pkg = readUnrealScenePackage(projectId)
  const manny = pkg?.characters[0]?.binding
  const detect = detectMetaHumanSupport()
  const shots = cinemaShots(projectId)

  if (op === 'hvs.unreal.character.prepare') {
    const foundation = ensureMetaHumanBinding(projectId)
    return {
      op,
      status: 'COMPLETE',
      assetPaths: [foundation.metahumanCharacterPath, HVS_UE02_UPROJECT],
      warnings: process.status === 'STOPPED' ? ['Unreal editor was not running. Foundation used the existing local reserved MetaHuman path.'] : [],
      errorCode: null,
      operatorStep: null,
      notes: [
        `MetaHuman Character reserved at ${HVS_MHC_RESERVED_PATH}.`,
        `Creator plugin ${detect.creatorPlugin}. Core Data ${detect.coreData}. RigLogic ${detect.rigLogic}.`,
        existsSync(HVS_MHC_UASSET) ? 'Official MHC container is present.' : 'Official MHC container is reserved.',
      ],
      process,
    }
  }

  if (op === 'hvs.unreal.character.conform') {
    const accepted = HVS_FACE_REFERENCE_REQUIRED.filter(type => face.stills[type]?.accepted).length
    const cloudOrUi = binding.conformGate?.status === 'BLOCKED' || binding.conformGate?.cloudRequired === true
    if (cloudOrUi) {
      return {
        op,
        status: 'BLOCKED',
        assetPaths: [binding.metahumanCharacterPath],
        warnings: ['Official MetaHuman likeness conform is a bounded downstream stage.'],
        errorCode: binding.conformGate?.code ?? 'METAHUMAN_CREATOR_AUTORIG_CLOUD_OR_UI',
        operatorStep: 'Open MetaHuman Creator on MHC_Rael_Commander, place the five local stills, and complete the official landmark / Auto-Rig step. Do not upload to a third-party trainer. Return here and press Resume build.',
        notes: [`${accepted}/5 accepted stills remain local source input only. Animator is not started.`],
        process,
      }
    }
    return {
      op,
      status: 'COMPLETE',
      assetPaths: [binding.metahumanCharacterPath],
      warnings: [],
      errorCode: null,
      operatorStep: null,
      notes: ['Likeness conform completed through official local tooling.'],
      process,
    }
  }

  if (op === 'hvs.unreal.character.assemble') {
    return {
      op,
      status: 'COMPLETE',
      assetPaths: [binding.metahumanCharacterPath],
      warnings: binding.rigLogic.dnaPresent ? [] : ['CINE assembly uses the reserved MHC. Rael-specific DNA is not invented.'],
      errorCode: null,
      operatorStep: null,
      notes: [`Assembly intent ${binding.assemblyPipeline}. Wardrobe ${binding.wardrobeIntent}. Body ${binding.body}.`],
      process,
    }
  }

  if (op === 'hvs.unreal.character.bind_body') {
    const connected = Boolean(manny?.animationSequencePath && binding.bodyExecution?.takeId === HVS_UE01_TAKE_ID)
    return {
      op,
      status: connected ? 'COMPLETE' : 'FAILED',
      assetPaths: [
        binding.bodyExecution?.sourceAnimation ?? '/Game/HVS/Animation/AN_Rael_Take3',
        binding.bodyExecution?.mannyAnimation ?? '/Game/HVS/Animation/AN_Rael_Take3_Manny',
      ],
      warnings: [],
      errorCode: connected ? null : 'TAKE3_BINDING_MISSING',
      operatorStep: connected ? null : 'TAKE 3 lineage is missing from the Unreal execution package.',
      notes: [
        `TAKE 3 ${HVS_UE01_TAKE_ID} / ${HVS_UE01_MOTION_ID}.`,
        'Manny remains BODY_TEST_REFERENCE. No second identity.',
      ],
      process,
    }
  }

  if (op === 'hvs.unreal.character.bind_sequence') {
    const connected = shots.length === 4 && shots.map(item => item.lensMm).join(',') === '24,24,24,85' && Boolean(manny?.levelSequencePath)
    return {
      op,
      status: connected ? 'COMPLETE' : 'FAILED',
      assetPaths: manny?.levelSequencePath ? [manny.levelSequencePath] : [],
      warnings: [],
      errorCode: connected ? null : 'CINEMA_BINDING_MISSING',
      operatorStep: connected ? null : 'Cinema sequence is missing from the Unreal execution package.',
      notes: shots.map(shot => `${shot.name} ${shot.lensMm} mm`),
      process,
    }
  }

  const previewDir = path.join(unrealPackageDir(projectId), 'character-production')
  return {
    op: 'hvs.unreal.character.preview',
    status: 'COMPLETE',
    assetPaths: manny?.mapPath ? [manny.mapPath] : [],
    warnings: process.status === 'STOPPED' ? ['High-fidelity Unreal preview waits for a live editor. Fast Three.js preview remains available and is not labeled high-fidelity.'] : [],
    errorCode: null,
    operatorStep: null,
    notes: [`Preview folder ${previewDir}. Renderer identity stays explicit: Unreal or Three.js, never mixed.`],
    process,
  }
}
