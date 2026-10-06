/**
 * Apply Unreal import proof onto the lightweight HVS binding.
 * Does not write .hvsproj.
 */
import { existsSync, readFileSync } from 'node:fs'
import { HVS_UE01_PROJECT_ID, buildUnrealScenePackage, loadHvsProject } from './package'
import { readUnrealScenePackage, writeUnrealScenePackage } from './storage'

const PROOF = '/home/chosenone/HVSRuntime/Saved/HVS/ue02-import-proof.json'

function main() {
  if (!existsSync(PROOF)) throw new Error('import proof missing')
  const proof = JSON.parse(readFileSync(PROOF, 'utf8')) as Record<string, unknown>
  if (proof.ok !== true) throw new Error(`import failed: ${JSON.stringify(proof.errors ?? proof)}`)
  const project = loadHvsProject(HVS_UE01_PROJECT_ID)
  if (!project) throw new Error('HVS project missing')
  const pkg = buildUnrealScenePackage(project, new Date().toISOString())
  const stored = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
  const character = pkg.characters[0]
  if (!character) throw new Error('no character')
  character.binding = {
    ...character.binding,
    unrealProjectId: 'HVSRuntime',
    unrealActorPath: String(proof.actorName ?? 'BP_Rael_Commander'),
    skeletalMeshPath: String(proof.skeletalMeshPath),
    skeletonPath: String(proof.skeletonPath),
    animationSequencePath: String(proof.animationSequencePath),
    levelSequencePath: String(proof.levelSequencePath),
    mapPath: String(proof.mapPath),
    uprojectPath: String(proof.uprojectPath),
    ikRigPath: proof.ikRigPath ? String(proof.ikRigPath) : null,
    ikRetargeterPath: proof.ikRetargeterPath ? String(proof.ikRetargeterPath) : null,
    metahumanCharacterPath: null,
    assetState: 'BOUND',
  }
  const written = writeUnrealScenePackage({
    ...pkg,
    characters: [character],
  })
  console.log(JSON.stringify({
    ok: true,
    binding: written.bindingPath,
    assetState: written.binding.assetState,
    sourceHashUnchanged: stored?.metadata.sourceHash === pkg.metadata.sourceHash,
    motionImport: written.binding.motionImport,
  }, null, 2))
}

main()
