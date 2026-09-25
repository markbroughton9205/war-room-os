import { HVSPROJ_VERSION, type HvsProject } from './types'
import { identityEffectGraphsOr } from './effect-graph'
import { identityColorPipelineOr } from './color-pipeline'
import { identityAudioGraphOr } from './audio-graph'
import { emptyDestructionStore } from './destruction/types'
import { emptyDigitalHumanStore, releaseStaleCaptures } from './digital-human/types'

export function serializeHvsProject(project: HvsProject): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

export function parseHvsProject(raw: string): HvsProject {
  const parsed = JSON.parse(raw) as HvsProject
  if (!parsed || parsed.format !== 'hvsproj') {
    throw new Error('Not a .hvsproj document.')
  }
  if (parsed.formatVersion !== HVSPROJ_VERSION) {
    throw new Error(`Unsupported .hvsproj version ${String(parsed.formatVersion)}.`)
  }
  parsed.kernelSchemaVersion = parsed.kernelSchemaVersion ?? 0
  parsed.sequences = parsed.sequences?.length
    ? parsed.sequences
    : [{ id: 'seq-main', name: 'Sequence 1', timelineId: parsed.timeline?.id ?? 'timeline-main' }]
  parsed.assets = (parsed.assets ?? []).map(asset => ({
    ...asset,
    codec: asset.codec ?? null,
    container: asset.container ?? null,
    pixelFormat: asset.pixelFormat ?? null,
    rotation: asset.rotation ?? null,
    audioStreams: asset.audioStreams ?? [],
    outputOfRenderJobId: asset.outputOfRenderJobId ?? null,
    role: asset.role ?? 'ORIGINAL',
    derivedFromAssetId: asset.derivedFromAssetId ?? null,
    rights: asset.rights && typeof asset.rights === 'object'
      ? {
          state: asset.rights.state ?? 'UNKNOWN',
          commercialOk: asset.rights.state === 'OWNABLE' && asset.rights.commercialOk !== false,
          source: asset.rights.source ?? null,
          notes: asset.rights.notes ?? null,
        }
      : { state: 'UNKNOWN' as const, commercialOk: false, source: null, notes: 'Required rights metadata absent.' },
    provenance: asset.provenance
      ? {
          ...asset.provenance,
          promptHash: asset.provenance.promptHash ?? null,
          parentAssetIds: asset.provenance.parentAssetIds ?? (asset.provenance.parentAssetId ? [asset.provenance.parentAssetId] : []),
          providerJobId: asset.provenance.providerJobId ?? null,
          origin: asset.provenance.origin ?? (asset.generated ? 'generated' : 'unknown'),
          license: asset.provenance.license ?? null,
          externalTransfer: asset.provenance.externalTransfer ?? null,
        }
      : null,
  }))
  parsed.renderJobs = (parsed.renderJobs ?? []).map(job => ({
    ...job,
    outputAssetId: job.outputAssetId ?? null,
    encoder: job.encoder ?? null,
    probe: job.probe ?? null,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    cancelRequested: job.cancelRequested ?? false,
    laneProvenance: job.laneProvenance ?? null,
  }))
  parsed.versions = (parsed.versions ?? []).map(version => ({
    ...version,
    aspect: version.aspect ?? parsed.timeline?.aspect ?? '16:9',
    role: version.role ?? 'master',
    derivedFromVersionId: version.derivedFromVersionId ?? null,
    description: version.description ?? '',
    durationSec: version.durationSec,
    clipCount: version.clipCount,
    thumbnailPath: version.thumbnailPath ?? null,
    restoredFromVersionId: version.restoredFromVersionId ?? null,
  }))
  try {
    parsed.effectGraphs = identityEffectGraphsOr(parsed.effectGraphs, parsed.id)
  } catch {
    parsed.effectGraphs = []
  }
  try {
    parsed.colorPipeline = identityColorPipelineOr(parsed.colorPipeline)
  } catch {
    parsed.colorPipeline = { schemaVersion: 1, nodes: [], outputColorSpace: 'unspecified' }
  }
  try {
    parsed.audioGraph = identityAudioGraphOr(parsed.audioGraph, parsed)
  } catch {
    parsed.audioGraph = identityAudioGraphOr(null, parsed)
  }
  parsed.providerJobs = parsed.providerJobs ?? []
  parsed.renderJobs = parsed.renderJobs ?? []
  parsed.director3d = parsed.director3d ?? {
    activeSceneId: null,
    scenes: [],
    revisions: [],
    approvedBlueprintId: null,
  }
  parsed.director3d.scenes = (parsed.director3d.scenes ?? []).map(scene => ({
    ...scene,
    props: scene.props ?? [],
  }))
  parsed.cinemaDirector = parsed.cinemaDirector ?? {
    schemaVersion: 1,
    activePlanId: null,
    plans: [],
  }
  parsed.destruction = parsed.destruction ?? emptyDestructionStore()
  parsed.digitalHumans = releaseStaleCaptures(parsed.digitalHumans ?? emptyDigitalHumanStore())
  return parsed
}
