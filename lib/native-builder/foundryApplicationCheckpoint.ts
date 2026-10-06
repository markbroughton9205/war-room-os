/** Exact, bounded source checkpoints used only to reject destructive application generations. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '../repo/paths'
import { assertCanonicalRepoPath, listRepoFiles, resolveRepoRelativePath } from './repositoryInspector'
import { applicationSourceSnapshot } from './foundryApplicationReview'
import type { ApplicationBuildState } from './foundryApplicationMission'

type CheckpointArtifact = {
  missionId: string
  sourceDigest: string
  generation: number
  testedDigest?: string
  files: Array<{ file: string; text: string }>
}

export async function captureApplicationCheckpoint(state: ApplicationBuildState) {
  const snapshot = await applicationSourceSnapshot()
  const artifact = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'application-checkpoints', `${randomUUID()}.json`)
  const body: CheckpointArtifact = {
    missionId: state.contract.missionId,
    sourceDigest: snapshot.digest,
    generation: state.generation,
    testedDigest: state.testedDigest,
    files: snapshot.sources.map(source => ({ file: source.file, text: source.text })),
  }
  await mkdir(path.dirname(artifact), { recursive: true })
  await writeFile(artifact, JSON.stringify(body), 'utf8')
  return { sourceDigest: body.sourceDigest, generation: body.generation, testedDigest: body.testedDigest, artifact }
}

export async function restoreApplicationCheckpoint(state: ApplicationBuildState): Promise<string> {
  const checkpoint = state.pendingCheckpoint
  if (!checkpoint) throw new Error('No application checkpoint is available.')
  const parsed = JSON.parse(await readFile(checkpoint.artifact, 'utf8')) as CheckpointArtifact
  if (parsed.missionId !== state.contract.missionId || parsed.sourceDigest !== checkpoint.sourceDigest) {
    throw new Error('Application checkpoint identity mismatch.')
  }
  const retained = new Set(parsed.files.map(file => file.file))
  for (const current of await listRepoFiles()) {
    if (!retained.has(current) && /\.(?:[cm]?[jt]sx?|py|html|css|json|toml|ya?ml|md|rs|go)$/.test(current)) {
      const target = resolveRepoRelativePath(current)
      await assertCanonicalRepoPath(target)
      await rm(target, { force: true })
    }
  }
  for (const file of parsed.files) {
    const target = resolveRepoRelativePath(file.file)
    await assertCanonicalRepoPath(target, true)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.text, 'utf8')
  }
  const restored = await applicationSourceSnapshot()
  if (restored.digest !== parsed.sourceDigest) throw new Error('Application checkpoint restore digest mismatch.')
  state.generation = parsed.generation
  state.sourceDigest = parsed.sourceDigest
  state.testedDigest = parsed.testedDigest
  state.phase6 = undefined
  state.pendingCheckpoint = undefined
  return parsed.sourceDigest
}
