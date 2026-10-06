/**
 * Derived Unreal packages live beside other HVS media-command data.
 * They are not written into .hvsproj.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { buildUnrealScenePackage, HVS_UE02_UPROJECT, loadHvsProject, unrealTruthBinding } from './package'
import type { HvsUnrealCharacterBinding, HvsUnrealScenePackage, HvsUnrealTruthBinding } from './types'

export function unrealPackageDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'unreal', projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function unrealPackagePath(projectId: string): string {
  return path.join(unrealPackageDir(projectId), 'scene-package.json')
}

export function unrealBindingPath(projectId: string): string {
  return path.join(unrealPackageDir(projectId), 'binding.json')
}

export function mergeRuntimeBinding(pkg: HvsUnrealScenePackage, stored: HvsUnrealScenePackage | null): HvsUnrealScenePackage {
  const existing = stored?.characters[0]?.binding
  const character = pkg.characters[0]
  if (!existing || existing.assetState !== 'BOUND' || !character) return pkg
  const incoming = character.binding
  const binding: HvsUnrealCharacterBinding = {
    ...incoming,
    ...existing,
    characterId: 'rael-commander',
    adapter: 'GENERIC_UE_HUMANOID',
    metahumanCharacterPath: null,
    assetState: 'BOUND',
    animationSequencePath: incoming.animationSequencePath ?? existing.animationSequencePath,
    controlRigPath: incoming.controlRigPath ?? existing.controlRigPath,
    ikRigPath: incoming.ikRigPath ?? existing.ikRigPath,
    ikRetargeterPath: incoming.ikRetargeterPath ?? existing.ikRetargeterPath,
  }
  return { ...pkg, characters: [{ ...character, binding }] }
}

export function writeUnrealScenePackage(pkg: HvsUnrealScenePackage): { packagePath: string; bindingPath: string; binding: HvsUnrealTruthBinding } {
  const merged = mergeRuntimeBinding(pkg, readUnrealScenePackage(pkg.projectId))
  const packagePath = unrealPackagePath(merged.projectId)
  const bindingPath = unrealBindingPath(merged.projectId)
  const binding = unrealTruthBinding(merged, packagePath)
  writeFileSync(packagePath, `${JSON.stringify(merged, null, 2)}\n`)
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`)
  return { packagePath, bindingPath, binding }
}

export function readUnrealScenePackage(projectId: string): HvsUnrealScenePackage | null {
  const file = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'unreal', projectId, 'scene-package.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as HvsUnrealScenePackage
}

export type HvsUnrealUiStatus = {
  engine: 'DETECTED' | 'NOT_INSTALLED' | 'READY' | 'ERROR'
  characterBinding: 'NOT_BOUND' | 'BOUND'
  scenePackage: 'READY' | 'STALE'
  runtime: 'NOT_INSTALLED' | 'DETECTED' | 'ERROR' | 'READY'
  executionProject: 'MISSING' | 'READY'
  motion: 'PROTOTYPE' | 'TAKE 3 IMPORTED'
  sequencer: 'MISSING' | 'READY'
  version: string | null
  installPath: string | null
  projectId: string | null
}

export function unrealExecutionStatus(projectId: string | null, trace: { installed: 'YES' | 'NO' | 'PARTIAL'; version: string | null; installPath: string | null; error: string | null }): HvsUnrealUiStatus {
  const hvRuntime = existsSync(HVS_UE02_UPROJECT)
  let engine: HvsUnrealUiStatus['engine'] = 'NOT_INSTALLED'
  if (trace.error) engine = 'ERROR'
  else if (trace.installed === 'YES' && hvRuntime) engine = 'READY'
  else if (trace.installed === 'YES' || trace.installed === 'PARTIAL') engine = 'DETECTED'
  const project = projectId ? loadHvsProject(projectId) : null
  const current = project ? buildUnrealScenePackage(project, 'status') : null
  const stored = projectId ? readUnrealScenePackage(projectId) : null
  const scenePackage: HvsUnrealUiStatus['scenePackage'] = current && stored && stored.metadata.sourceHash === current.metadata.sourceHash ? 'READY' : 'STALE'
  const binding = stored?.characters[0]?.binding
  const characterBinding: HvsUnrealUiStatus['characterBinding'] = binding?.assetState === 'BOUND' ? 'BOUND' : 'NOT_BOUND'
  const motion: HvsUnrealUiStatus['motion'] = binding?.animationSequencePath ? 'TAKE 3 IMPORTED' : 'PROTOTYPE'
  const sequencer: HvsUnrealUiStatus['sequencer'] = binding?.levelSequencePath ? 'READY' : 'MISSING'
  const runtime: HvsUnrealUiStatus['runtime'] = engine === 'ERROR' ? 'ERROR' : engine === 'NOT_INSTALLED' ? 'NOT_INSTALLED' : engine === 'READY' ? 'READY' : 'DETECTED'
  return {
    engine,
    characterBinding,
    scenePackage,
    runtime,
    executionProject: hvRuntime ? 'READY' : 'MISSING',
    motion,
    sequencer,
    version: trace.version,
    installPath: trace.installPath,
    projectId,
  }
}
