import {
  commanderProjectKind,
  preferredPreviewPort,
  projectRuntimeStatus,
  type FoundryCommanderProjectCard,
} from './foundryCommanderExperience'
import type { FoundryNewProjectRecord } from './foundryApplicationBuilderTypes'
import { findLiveProjectPreview, probeLoopback } from './foundryProjectProcessRegistry'
import { readProjectDisplayBrand } from './foundryProjectIndexHygiene'

type PersistedProjectExtras = FoundryNewProjectRecord & {
  lastOpenedAt?: string
  lastSuccessAt?: string
  previewPort?: number
}

export async function presentCommanderProjectCard(project: FoundryNewProjectRecord): Promise<FoundryCommanderProjectCard> {
  const extras = project as PersistedProjectExtras
  const owned = await findLiveProjectPreview({
    projectId: project.projectId,
    projectRoot: project.projectRoot,
  })
  const port = owned?.port ?? extras.previewPort ?? preferredPreviewPort(project)
  const previewUrl = `http://127.0.0.1:${port}`
  const httpLive = port ? await probeLoopback(port) : false
  const previewLive = Boolean(owned?.port) || httpLive
  const previewOwnership: FoundryCommanderProjectCard['previewOwnership'] = owned?.port
    ? 'owned'
    : httpLive
      ? 'external'
      : 'none'
  return {
    id: project.projectId,
    name: await readProjectDisplayBrand(project.projectRoot, project.projectName),
    kind: commanderProjectKind(project),
    root: project.projectRoot,
    runtimeStatus: projectRuntimeStatus({
      live: previewLive,
      projectStatus: project.status,
      needsAttention: project.status === 'FAILED' || project.status === 'WAITING_COMMANDER',
    }),
    previewUrl,
    previewPort: port,
    previewLive,
    previewOwnership,
    lastWorkedAt: extras.lastOpenedAt ?? extras.lastSuccessAt ?? project.createdAt,
    systemProject: false,
    applicationProjectId: project.projectId,
  }
}
