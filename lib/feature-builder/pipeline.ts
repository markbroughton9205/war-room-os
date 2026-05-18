import 'server-only'

import { BABY_AI_AGENTS, type BabyAgent, type BabyAgentKey } from '@/lib/baby-ai/model'
import { buildBabyCouncilPromptAddendum } from '@/lib/baby-ai/councilIntegration'
import { CURSOR_ENGINEERING_AGENT } from '@/lib/engineering/cursorEngineeringAgent'
import {
  FEATURE_BUILDER_VALIDATION_COMMANDS,
  type FeatureBuildPacket,
  type FeatureBuilderRequestInput,
  type FeatureBuilderReview,
  type FeatureFamilyContribution,
} from './model'

const MODULE_HINTS: Array<[string, RegExp]> = [
  ['Baby AI / operational intelligence', /\bbaby|briefing|council|agent|ai family\b/i],
  ['Economic operations', /\bincome|money|monetization|economic|opportunity|freight|logistics\b/i],
  ['War Room dashboard', /\bdashboard|panel|ui|screen|war room|command\b/i],
  ['Memory and persistence', /\bmemory|persist|database|supabase|history|store\b/i],
  ['Engineering bridge', /\bcursor|codex|build|factory|feature|implementation|engineering\b/i],
  ['Automation governance', /\bautomation|approval|workflow|queue|governance\b/i],
]

function compact(value: string, limit = 220): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

function titleFromIdea(idea: string): string {
  const clean = compact(idea, 90).replace(/[.?!]+$/g, '')
  if (!clean) return 'Untitled app feature'
  return clean.replace(/^(build|add|create|make|implement)\s+/i, '')
}

function inferTargetModule(idea: string, explicit?: string | null): string {
  const target = explicit?.trim()
  if (target) return compact(target, 120)
  const match = MODULE_HINTS.find(([, pattern]) => pattern.test(idea))
  return match?.[0] ?? 'War Room app module'
}

function requiredFiles(idea: string, targetModule: string): string[] {
  const text = `${idea} ${targetModule}`
  const files = new Set<string>([
    'app/(dashboard)/war-room/page.tsx',
    'components/war-room',
    'lib/baby-ai',
  ])

  if (/\bbaby|council|agent|ai family\b/i.test(text)) {
    files.add('components/war-room/baby-ai')
    files.add('app/api/baby-ai')
  }
  if (/\bfeature|factory|cursor|build|engineering\b/i.test(text)) {
    files.add('lib/engineering')
    files.add('components/war-room/build-agent')
    files.add('app/api/build-requests')
  }
  if (/\bmemory|persist|database|supabase|store\b/i.test(text)) {
    files.add('lib/war-room/persistence.ts')
    files.add('supabase')
  }
  if (/\bincome|economic|opportunity|freight|logistics|monetization\b/i.test(text)) {
    files.add('lib/economic')
    files.add('components/economic')
  }
  if (/\bapi|route|endpoint\b/i.test(text)) {
    files.add('app/api')
  }

  return [...files]
}

function technicalApproach(idea: string): string[] {
  return [
    'Create a proposal-only feature request record from the Commander idea.',
    'Generate a structured build packet with Baby AI family reviews and explicit approval gates.',
    'Persist packet and review metadata through service-role-only server routes when Supabase is configured.',
    'Expose a lightweight dashboard panel that copies the Cursor handoff prompt manually instead of invoking an executor.',
    /external|live|realtime|trend/i.test(idea)
      ? 'Truth-label live or realtime relevance as unavailable unless an existing configured source provides evidence.'
      : 'Use existing War Room state and static heuristics only; do not claim live external research.',
  ]
}

function databaseChanges(idea: string): string[] {
  if (/\bmemory|persist|database|supabase|store|history|packet|request\b/i.test(idea)) {
    return [
      'Add or inspect service-role-only Supabase tables for feature requests, build packets, family reviews, and outcomes.',
      'Keep RLS enabled with no anon/authenticated public write policies.',
    ]
  }
  return ['No feature-specific database migration is assumed until implementation confirms persistence needs.']
}

function apiRoutes(idea: string): string[] {
  const routes = ['/api/feature-builder']
  if (/\bbaby|briefing|council/i.test(idea)) routes.push('/api/baby-ai/academy', '/api/baby-ai/briefing')
  if (/\bbuild|cursor|factory|feature/i.test(idea)) routes.push('/api/build-requests')
  if (/\beconomic|income|opportunity/i.test(idea)) routes.push('/api/economic/surface')
  return [...new Set(routes)]
}

function uiComponents(idea: string): string[] {
  const components = ['components/war-room/feature-builder/FeatureBuilderPanel.tsx']
  if (/\bbaby|agent|council/i.test(idea)) components.push('components/war-room/baby-ai/BabyAiAcademyPanel.tsx')
  if (/\bbuild|factory|cursor/i.test(idea)) components.push('components/war-room/build-agent/BuildAgentDivisionPanel.tsx')
  if (/\beconomic|income|opportunity/i.test(idea)) components.push('components/economic/EconomicOperationsPanel.tsx')
  return components
}

function risks(idea: string): string[] {
  const result = [
    'Scope may be broader than the current module boundary; keep the first implementation small and reviewable.',
    'War Room UI must not mutate repository files, run shell commands, deploy, commit, or push.',
    'Cursor handoff is manual copy/paste only and requires Commander approval before engineering work.',
  ]
  if (/\blive|realtime|trend|market/i.test(idea)) {
    result.push('Realtime or market relevance must be marked unavailable unless a configured source provides evidence.')
  }
  if (/\bdatabase|supabase|persist/i.test(idea)) {
    result.push('Migration changes require idempotent SQL, RLS, and service-role-only access review.')
  }
  return result
}

function rollbackNotes(): string[] {
  return [
    'Keep changes additive and revert by removing the new route/component/module plus migration if not applied.',
    'Do not auto-rollback from War Room; Cursor/manual engineering must provide visible diff and validation results.',
    'If persistence is applied and later rejected, archive or mark rows instead of deleting audit history.',
  ]
}

function monetizationAngle(idea: string): string {
  if (/\bincome|money|monetization|revenue|sales|client|smb|freight|logistics/i.test(idea)) {
    return 'Potential monetization exists if the feature reduces operational labor, packages an SMB workflow, or improves sourced opportunity review; validate before outreach or claims.'
  }
  return 'Business value is indirect: faster internal execution, better auditability, and reusable build packets for future Commander-approved implementation work.'
}

function contributionFor(agent: BabyAgent, idea: string, targetModule: string): FeatureFamilyContribution {
  const contributions: Record<BabyAgentKey, { lane: string; contribution: string }> = {
    'chatgpt-family-baby': {
      lane: 'Synthesis / final product spec',
      contribution: `Frame "${titleFromIdea(idea)}" as a Commander-approved product spec for ${targetModule}.`,
    },
    'claude-family-baby': {
      lane: 'Architecture / implementation risk',
      contribution: 'Check module boundaries, persistence shape, validation blast radius, and approval gates before implementation.',
    },
    'kimi-family-baby': {
      lane: 'Task breakdown / sequencing',
      contribution: 'Sequence work as inspect, model, API, UI, validation, commit, and deployment verification.',
    },
    'red-team-baby': {
      lane: 'Contradiction / risk review',
      contribution: 'Challenge execution-like language and confirm the packet cannot mutate files, run commands, or deploy from War Room.',
    },
    'analyst-baby': {
      lane: 'Market / use-case framing',
      contribution: 'Describe who benefits, what job-to-be-done is served, and which evidence is still missing.',
    },
    'income-operations-baby': {
      lane: 'Monetization / business angle',
      contribution: monetizationAngle(idea),
    },
    'bridge-architect-baby': {
      lane: 'System integration notes',
      contribution: 'Coordinate with War Room persistence, dashboard panels, council visibility, and manual Cursor handoff only.',
    },
    'grok-family-baby': {
      lane: 'Trend / realtime relevance',
      contribution: 'Realtime relevance is not claimed unless configured sources exist; otherwise mark trend evidence unavailable.',
    },
  }

  const mapped = contributions[agent.key]
  return {
    agentKey: agent.key,
    agentName: agent.displayName,
    lane: mapped.lane,
    contribution: mapped.contribution,
    confidence: agent.confidenceScore,
    sourceAttribution: 'Baby AI static profile plus Commander feature idea',
    approvalRequired: true,
    canExecute: false,
  }
}

function cursorPrompt(packet: Omit<FeatureBuildPacket, 'cursorReadyImplementationPrompt'>): string {
  return [
    `Implement this War Room feature proposal manually in Cursor after Commander approval.`,
    '',
    `Title: ${packet.title}`,
    `Objective: ${packet.objective}`,
    `User story: ${packet.userStory}`,
    `Target app/module: ${packet.targetAppModule}`,
    '',
    'Required files to inspect:',
    ...packet.requiredFilesToInspect.map(file => `- ${file}`),
    '',
    'Technical approach:',
    ...packet.technicalApproach.map(step => `- ${step}`),
    '',
    'Database changes:',
    ...packet.databaseChanges.map(change => `- ${change}`),
    '',
    'API routes:',
    ...packet.apiRoutes.map(route => `- ${route}`),
    '',
    'UI components:',
    ...packet.uiComponents.map(component => `- ${component}`),
    '',
    'Validation commands:',
    ...packet.validationCommands.map(command => `- ${command}`),
    '',
    'Risks:',
    ...packet.risks.map(risk => `- ${risk}`),
    '',
    'Rollback notes:',
    ...packet.rollbackNotes.map(note => `- ${note}`),
    '',
    'Hard boundaries:',
    '- War Room may prepare this packet only.',
    '- Do not execute shell commands, mutate files, commit, push, deploy, or delete without explicit Commander approval in Cursor.',
    '- Keep all changes visible and auditable.',
    '- Preserve cloud-only agents; do not add local connectors.',
    '',
    buildBabyCouncilPromptAddendum(),
  ].join('\n')
}

function reviewTypeFor(agentKey: BabyAgentKey): FeatureBuilderReview['reviewType'] {
  if (agentKey === 'chatgpt-family-baby') return 'synthesis'
  if (agentKey === 'claude-family-baby') return 'architecture'
  if (agentKey === 'kimi-family-baby') return 'decomposition'
  if (agentKey === 'red-team-baby') return 'risk'
  if (agentKey === 'analyst-baby') return 'market'
  if (agentKey === 'income-operations-baby') return 'monetization'
  if (agentKey === 'bridge-architect-baby') return 'integration'
  return 'trend'
}

export function buildFeatureBuildPacket(input: FeatureBuilderRequestInput, now = new Date()): FeatureBuildPacket {
  const idea = compact(input.idea, 4000)
  const targetAppModule = inferTargetModule(idea, input.targetAppModule)
  const title = titleFromIdea(idea)
  const packetId = `fbp-${now.getTime()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'feature'}`
  const requestId = `fr-${now.getTime()}`
  const familyContributions = BABY_AI_AGENTS.map(agent => contributionFor(agent, idea, targetAppModule))

  const packetBase = {
    id: packetId,
    requestId,
    title,
    objective: `Turn the Commander idea into a reviewable, Cursor-ready app feature for ${targetAppModule}: ${idea}`,
    userStory: `As Commander, I want ${title.toLowerCase()} so War Room can improve operational clarity without hidden execution or unapproved repository mutation.`,
    targetAppModule,
    requiredFilesToInspect: requiredFiles(idea, targetAppModule),
    technicalApproach: technicalApproach(idea),
    databaseChanges: databaseChanges(idea),
    apiRoutes: apiRoutes(idea),
    uiComponents: uiComponents(idea),
    validationCommands: FEATURE_BUILDER_VALIDATION_COMMANDS,
    risks: risks(idea),
    rollbackNotes: rollbackNotes(),
    approvalStatus: 'awaiting_commander_approval' as const,
    status: 'reviewed' as const,
    monetizationAngle: monetizationAngle(idea),
    familyContributions,
    liveCouncil: {
      babyContributionsEnabled: true as const,
      executionAllowed: false as const,
      cursorHandoffAllowed: 'manual_copy_only' as const,
      providerDependency: 'cloud_only' as const,
    },
    createdAt: now.toISOString(),
  } satisfies Omit<FeatureBuildPacket, 'cursorReadyImplementationPrompt'>

  return {
    ...packetBase,
    cursorReadyImplementationPrompt: cursorPrompt(packetBase),
  }
}

export function buildFeatureReviews(packet: FeatureBuildPacket): FeatureBuilderReview[] {
  return packet.familyContributions.map(contribution => ({
    id: `${packet.id}:${contribution.agentKey}`,
    packetId: packet.id,
    agentKey: contribution.agentKey,
    agentName: contribution.agentName,
    reviewType: reviewTypeFor(contribution.agentKey),
    summary: contribution.contribution,
    confidence: contribution.confidence,
    approvalRequired: true,
    canExecute: false,
    createdAt: packet.createdAt,
  }))
}

export function buildManualCursorReceiver(packet: FeatureBuildPacket) {
  return {
    executor: CURSOR_ENGINEERING_AGENT,
    handoffText: packet.cursorReadyImplementationPrompt,
    requiredCommanderAction: 'Copy this packet into Cursor manually only after Commander approval. War Room does not invoke Cursor or mutate files.',
  }
}

