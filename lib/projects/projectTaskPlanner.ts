import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type ProjectLane =
  | 'research'
  | 'architecture'
  | 'engineering'
  | 'design_ui'
  | 'business_revenue'
  | 'legal_compliance'
  | 'risk_review'
  | 'documentation'
  | 'final_synthesis'

export type ProjectAgentId =
  | CouncilOrchestrationFamily
  | 'cursor'
  | 'codex'

export type ProjectTaskStatus =
  | 'planned'
  | 'assigned'
  | 'waiting_approval'
  | 'in_progress'
  | 'completed'
  | 'blocked'

export type ProjectTask = {
  id: string
  lane: ProjectLane
  title: string
  objective: string
  assigned_family: string
  assigned_agent: ProjectAgentId
  assigned_agent_label: string
  required_inputs: string[]
  status: ProjectTaskStatus
  dependencies: string[]
  output_summary: string
  confidence: number
  risks: string[]
  approval_required: boolean
}

export type ProjectIntake = {
  id: string
  sourceDecree: string
  commanderIntent: string
  projectType: string
  createdAt: string
  matchedSignals: string[]
  hardPreserve: string[]
}

export type ProjectIntentDetection = {
  isProjectIntent: boolean
  projectType: string
  matchedSignals: string[]
  commanderIntent: string
}

const EXPLICIT_PROJECT_SIGNALS = [
  /\bproject\b/i,
  /\borchestrat(?:e|ion|or)\b/i,
  /\bend[-\s]?to[-\s]?end\b/i,
  /\bmulti[-\s]?agent\b/i,
  /\bparallel\s+(?:work\s+)?lanes?\b/i,
  /\bphase\s*\d+\b/i,
  /\bworkflow\b/i,
  /\bdecompos(?:e|ition)\b/i,
] as const

const PROJECT_VERBS = /\b(build|launch|improve|repair|write|plan|prepare|audit|research|create|design|document|ship|prototype)\b/i
const PROJECT_OBJECTS = /\b(app|application|business\s+page|landing\s+page|market|campaign|outreach|code|documentation|docs|product|presentation|system|war\s*room|ui|workflow|proposal|feature|site|audit)\b/i

export const PROJECT_HARD_PRESERVE = [
  'Preserve turn discipline.',
  'Preserve continuation permission.',
  'Preserve Commander approval gates.',
  'Preserve engineering bridge boundaries.',
  'Preserve intelligence retrieval before synthesis.',
  'Preserve memory and repair ledger context.',
  'Preserve runtime truth doctrine.',
  'No autonomous execution, commit, push, deploy, external outreach, purchase, or deletion without Commander approval.',
] as const

function normalize(text: string) {
  return text.trim().replace(/\s+/g, ' ')
}

function inferProjectType(text: string): string {
  if (/\bmarket|research|radar|news|competitor\b/i.test(text)) return 'market or intelligence research'
  if (/\bbusiness|revenue|offer|outreach|campaign|landing\s+page\b/i.test(text)) return 'business growth project'
  if (/\bapp|application|feature|code|repair|implement|war\s*room|ui\b/i.test(text)) return 'software delivery project'
  if (/\bdocumentation|docs|presentation|proposal|product\s+plan\b/i.test(text)) return 'knowledge work project'
  if (/\baudit|compliance|legal|risk|system\b/i.test(text)) return 'audit and risk project'
  return 'general coordinated project'
}

export function detectProjectOrchestrationIntent(decree: string): ProjectIntentDetection {
  const clean = normalize(typeof decree === 'string' ? decree : '')
  if (!clean) {
    return { isProjectIntent: false, projectType: 'none', matchedSignals: [], commanderIntent: '' }
  }

  const matchedSignals = EXPLICIT_PROJECT_SIGNALS
    .filter(pattern => pattern.test(clean))
    .map(pattern => pattern.source)

  const hasVerbObjectPair = PROJECT_VERBS.test(clean) && PROJECT_OBJECTS.test(clean)
  const asksForCouncilWorkflow = /\b(assign|lane|synthesis|red\s*team|approval\s+packet|implementation\s+plan)\b/i.test(clean)
  const substantialCommand = clean.split(' ').length >= 7
  const isProjectIntent = matchedSignals.length > 0 || (hasVerbObjectPair && (substantialCommand || asksForCouncilWorkflow))

  return {
    isProjectIntent,
    projectType: isProjectIntent ? inferProjectType(clean) : 'none',
    matchedSignals: [
      ...matchedSignals,
      ...(hasVerbObjectPair ? ['project_verb_object_pair'] : []),
      ...(asksForCouncilWorkflow ? ['council_workflow_terms'] : []),
    ],
    commanderIntent: clean,
  }
}

export function createProjectIntake(decree: string, now = new Date()): ProjectIntake | null {
  const detection = detectProjectOrchestrationIntent(decree)
  if (!detection.isProjectIntent) return null

  const slug = detection.projectType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return {
    id: `proj-${now.getTime()}-${slug || 'orchestration'}`,
    sourceDecree: decree.trim(),
    commanderIntent: detection.commanderIntent,
    projectType: detection.projectType,
    createdAt: now.toISOString(),
    matchedSignals: detection.matchedSignals,
    hardPreserve: [...PROJECT_HARD_PRESERVE],
  }
}
