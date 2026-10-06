/**
 * Apply UE-04 IK / Control Rig paths onto the lightweight HVS Unreal binding.
 * Does not write .hvsproj.
 */
import { existsSync, readFileSync } from 'node:fs'
import { HVS_UE01_PROJECT_ID, buildUnrealScenePackage, loadHvsProject } from './package'
import { readUnrealScenePackage, writeUnrealScenePackage } from './storage'

const PROOF = '/home/chosenone/HVSRuntime/Saved/HVS/ue04-proof.json'

function main() {
  if (!existsSync(PROOF)) throw new Error('ue04 proof missing')
  const proof = JSON.parse(readFileSync(PROOF, 'utf8')) as Record<string, unknown>
  if (proof.ok !== true && proof.captureComplete !== true) throw new Error(`ue04 incomplete: ${JSON.stringify(proof.errors ?? proof)}`)
  const project = loadHvsProject(HVS_UE01_PROJECT_ID)
  if (!project) throw new Error('HVS project missing')
  const pkg = buildUnrealScenePackage(project, new Date().toISOString())
  const stored = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
  const character = pkg.characters[0]
  if (!character) throw new Error('no character')
  character.binding = {
    ...character.binding,
    ...stored?.characters[0]?.binding,
    unrealProjectId: 'HVSRuntime',
    unrealActorPath: 'BP_Rael_Commander',
    skeletalMeshPath: '/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple',
    skeletonPath: '/Game/Characters/Mannequins/Meshes/SK_Mannequin.SK_Mannequin',
    animationSequencePath: String(proof.derivedAnimationPath ?? '/Game/HVS/Animation/AN_Rael_Take3_Manny'),
    levelSequencePath: '/Game/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a',
    mapPath: '/Game/HVS/Maps/HVS_Execution_Test',
    uprojectPath: '/home/chosenone/HVSRuntime/HVSRuntime.uproject',
    ikRigPath: proof.ikTargetPath ? String(proof.ikTargetPath) : null,
    ikRetargeterPath: proof.ikRetargeterPath ? String(proof.ikRetargeterPath) : null,
    controlRigPath: proof.controlRigPath ? String(proof.controlRigPath) : null,
    metahumanCharacterPath: null,
    assetState: 'BOUND',
  }
  const written = writeUnrealScenePackage({
    ...pkg,
    characters: [character],
  })
  const storedAfter = readUnrealScenePackage(HVS_UE01_PROJECT_ID)?.characters[0]?.binding
  console.log(JSON.stringify({
    ok: true,
    binding: written.bindingPath,
    assetState: written.binding.assetState,
    sourceHashUnchanged: stored?.metadata.sourceHash === pkg.metadata.sourceHash,
    animationSequencePath: storedAfter?.animationSequencePath ?? null,
    ikRigPath: storedAfter?.ikRigPath ?? null,
    ikRetargeterPath: storedAfter?.ikRetargeterPath ?? null,
    controlRigPath: storedAfter?.controlRigPath ?? null,
  }, null, 2))
}

main()
