/**
 * Commander vs system/test Foundry project visibility.
 * Archives registry metadata for harness workspaces without deleting fixture directories.
 */
import { WAR_ROOM_CANONICAL_WORKSPACE_ID } from './foundryWorkspaceIdentityCore'

export type FoundryProjectRecordLike = {
  id: string
  root: string
  label: string
  name?: string
  path?: string
  projectType?: string
  classification?: FoundryProjectClassification
  classificationEvidence?: string[]
  visibility?: 'commander' | 'system'
  testArtifact?: boolean
  archived?: boolean
}

export const FOUNDRY_PROJECT_CLASSIFICATIONS = [
  'COMMANDER_REAL',
  'SYSTEM_TEST',
  'ACCEPTANCE_FIXTURE',
  'CONTRACT_TEST',
  'INTERNAL',
  'UNKNOWN',
] as const

export type FoundryProjectClassification = (typeof FOUNDRY_PROJECT_CLASSIFICATIONS)[number]
export type FoundryProjectHistoryView = 'commander' | 'system' | 'all'

export const TEST_PROJECT_CLASSES: readonly FoundryProjectClassification[] = [
  'SYSTEM_TEST',
  'ACCEPTANCE_FIXTURE',
  'CONTRACT_TEST',
  'INTERNAL',
]

const KNOWN_HARNESS_NAMES = new Set([
  'escape-box',
  'cancel-box',
  'timeout-box',
  'repair-fixture',
  'task-tracker-app',
  'existing-greeting',
  'session-box',
  'foundry-ui-verify',
])

const HARNESS_PATH = /wr-engineer-e2e|wr-foundry-e2e|scripts\/foundry\/(ops-write-conflict|model-tool-choice|model-replan|model-visual|engineering-depth)/i
const HARNESS_TEMP = /(?:^|[\\/])(?:tmp|temp)[\\/]|appdata[\\/]local[\\/]temp/i
const ACCEPTANCE_PATH = /scripts\/foundry\/(model-tool-choice|model-replan|model-visual|engineering-depth)/i
const CONTRACT_PATH = /scripts\/foundry\/ops-write-conflict/i

export function projectHaystack(project: Pick<FoundryProjectRecordLike, 'id' | 'root' | 'label' | 'name' | 'path'>): string {
  return `${project.id}\n${project.root}\n${project.path ?? ''}\n${project.label}\n${project.name ?? ''}`.toLowerCase()
}

function projectBasename(project: Pick<FoundryProjectRecordLike, 'root' | 'label' | 'name'>): string {
  const fromName = (project.name || project.label || '').trim().toLowerCase()
  if (fromName) return fromName
  const normalized = project.root.replace(/\\/g, '/')
  return (normalized.split('/').filter(Boolean).pop() ?? '').toLowerCase()
}

export function classifyFoundryProject(project: Pick<FoundryProjectRecordLike, 'id' | 'root' | 'label' | 'name' | 'path' | 'projectType' | 'classification'>): {
  classification: FoundryProjectClassification
  evidence: string[]
} {
  if (project.id === WAR_ROOM_CANONICAL_WORKSPACE_ID || project.projectType === 'war_room') {
    return { classification: 'COMMANDER_REAL', evidence: ['canonical WAR ROOM OS workspace'] }
  }
  if (project.classification && TEST_PROJECT_CLASSES.includes(project.classification)) {
    return { classification: project.classification, evidence: ['stored test/internal classification'] }
  }
  const haystack = projectHaystack(project)
  const basename = projectBasename(project)
  const evidence: string[] = []
  if (CONTRACT_PATH.test(haystack)) {
    return { classification: 'CONTRACT_TEST', evidence: ['ops-write-conflict fixture path'] }
  }
  if (ACCEPTANCE_PATH.test(haystack)) {
    return { classification: 'ACCEPTANCE_FIXTURE', evidence: ['model/visual acceptance fixture path'] }
  }
  if (HARNESS_PATH.test(haystack)) evidence.push('validation harness path wr-engineer-e2e / wr-foundry-e2e / scripts/foundry')
  if (HARNESS_TEMP.test(haystack) && KNOWN_HARNESS_NAMES.has(basename)) evidence.push('known fixture name in temp/e2e directory')
  if (KNOWN_HARNESS_NAMES.has(basename) && HARNESS_PATH.test(haystack)) evidence.push(`known harness project name ${basename}`)
  if (KNOWN_HARNESS_NAMES.has(basename) && HARNESS_TEMP.test(haystack)) {
    return { classification: 'SYSTEM_TEST', evidence: evidence.length ? evidence : [`known fixture name ${basename}`] }
  }
  if (HARNESS_PATH.test(haystack)) {
    return { classification: 'SYSTEM_TEST', evidence }
  }
  if (KNOWN_HARNESS_NAMES.has(basename)) {
    return { classification: 'SYSTEM_TEST', evidence: [`known engineer/foundry validation fixture name ${basename}`] }
  }
  if ((basename === 'inventory' || basename === 'expense') && (HARNESS_PATH.test(haystack) || HARNESS_TEMP.test(haystack))) {
    return { classification: 'SYSTEM_TEST', evidence: ['foundry.validation novel e2e project'] }
  }
  if (project.projectType === 'new_project' || project.projectType === 'existing_project' || project.projectType === 'external_repository') {
    return { classification: 'COMMANDER_REAL', evidence: ['user-created or opened project'] }
  }
  return { classification: 'UNKNOWN', evidence: ['no known harness/fixture markers'] }
}

export function isTestProjectClass(classification: FoundryProjectClassification | undefined): boolean {
  return Boolean(classification && TEST_PROJECT_CLASSES.includes(classification))
}

export function isCommanderVisibleProject(project: Pick<FoundryProjectRecordLike, 'archived' | 'visibility' | 'testArtifact' | 'classification' | 'id' | 'projectType'>): boolean {
  if (project.id === WAR_ROOM_CANONICAL_WORKSPACE_ID || project.projectType === 'war_room') return true
  if (project.archived) return false
  if (project.visibility === 'system') return false
  if (project.testArtifact) return false
  if (isTestProjectClass(project.classification)) return false
  return true
}

export function parseFoundryProjectHistoryView(value: string | null | undefined): FoundryProjectHistoryView {
  if (value === 'system' || value === 'all') return value
  return 'commander'
}

export function filterProjectsForView<T extends FoundryProjectRecordLike>(projects: T[], view: FoundryProjectHistoryView = 'commander'): T[] {
  if (view === 'all') return projects
  if (view === 'system') {
    return projects.filter(project => project.id !== WAR_ROOM_CANONICAL_WORKSPACE_ID && (
      isTestProjectClass(project.classification) || project.testArtifact === true || project.visibility === 'system' || project.archived === true
    ))
  }
  return projects.filter(isCommanderVisibleProject)
}

export function decorateProjectVisibility<T extends FoundryProjectRecordLike>(project: T): T {
  const classified = classifyFoundryProject({ ...project, classification: isTestProjectClass(project.classification) ? project.classification : undefined })
  const classification = isTestProjectClass(classified.classification)
    ? classified.classification
    : (project.classification ?? classified.classification)
  const test = isTestProjectClass(classification)
  return {
    ...project,
    classification,
    classificationEvidence: classified.evidence,
    testArtifact: test || project.testArtifact === true,
    visibility: test ? 'system' : (project.visibility ?? 'commander'),
    archived: test ? true : Boolean(project.archived),
  }
}
