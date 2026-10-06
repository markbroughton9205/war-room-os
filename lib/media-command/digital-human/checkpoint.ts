import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { projectVersionsDir } from '../paths'
import { serializeHvsProject } from '../project-format'
import type { HvsProject, ProjectVersion } from '../types'
import { dhId } from './types'

/** Identity enrollment checkpoint. Performance takes must not call this. */
export function checkpointIdentity(project: HvsProject, label: string): ProjectVersion {
  const version: ProjectVersion = {
    id: dhId('ver'),
    projectId: project.id,
    index: project.versions.length + 1,
    label,
    createdAt: new Date().toISOString(),
    createdBy: 'human',
    parentVersionId: project.currentVersionId,
    snapshotPath: '',
    role: 'master',
    description: label,
  }
  project.versions.push(version)
  project.currentVersionId = version.id
  try {
    const file = path.join(projectVersionsDir(project.id), `${version.id}.hvsproj`)
    writeFileSync(file, serializeHvsProject(project), 'utf8')
    version.snapshotPath = file
  } catch {
    version.snapshotPath = ''
  }
  return version
}
