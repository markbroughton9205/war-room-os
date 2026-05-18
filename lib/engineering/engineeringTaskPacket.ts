export type EngineeringIntentKind =
  | 'code_repair'
  | 'build_feature'
  | 'wire_integration'
  | 'ui_update'
  | 'provider_fix'
  | 'code_audit'
  | 'validation'

export type EngineeringTaskStatus = 'prepared' | 'awaiting_commander_approval' | 'approved' | 'completed' | 'blocked'

export type EngineeringValidationCommand =
  | 'pnpm exec tsc --noEmit'
  | 'pnpm exec eslint app components lib --max-warnings=0'
  | 'pnpm run build'

export type EngineeringTaskPacket = {
  id: string
  title: string
  objective: string
  currentIssue: string
  sourceDecree: string
  packetSource: string
  intentKind: EngineeringIntentKind
  assignedExecutorId: 'cursor'
  assignedExecutorLabel: 'Cursor'
  status: EngineeringTaskStatus
  approvalStatus: 'awaiting_commander_approval' | 'approved_for_manual_cursor' | 'rejected'
  filesToInspect: string[]
  constraints: string[]
  approvalBoundaries: string[]
  validationCommands: EngineeringValidationCommand[]
  validationChecklist: string[]
  riskNotes: string[]
  commitMessage: string
  expectedReturnFormat: string[]
  cursorCommand: string
  reviewBy: Array<'claude' | 'red_team'>
  audit: EngineeringAuditEntry
  repairMemory: EngineeringRepairMemoryEntry
  rollbackRecommendation: string
  createdAt: string
}

export type EngineeringAuditEntry = {
  category: 'engineering'
  message: string
  metadata: {
    taskPacketId: string
    executor: 'cursor'
    approvalRequired: true
    canMutateFromWarRoom: false
    source: 'live_council'
  }
}

export type EngineeringRepairMemoryEntry = {
  issue: string
  expectedFiles: string[]
  validationPlan: EngineeringValidationCommand[]
  rollbackNotes: string
  status: 'prepared_not_executed'
}

export type EngineeringIntentDetection = {
  isEngineeringIntent: boolean
  intentKind: EngineeringIntentKind
  matchedTerms: string[]
  filesToInspect: string[]
  title: string
  objective: string
  currentIssue: string
}

const ENGINEERING_TERMS = [
  'fix',
  'build',
  'wire',
  'connect',
  'repair',
  'implement',
  'add provider',
  'update ui',
  'create patch',
  'audit code',
  'run validation',
  'weather provider',
] as const

export const ENGINEERING_VALIDATION_COMMANDS: EngineeringValidationCommand[] = [
  'pnpm exec tsc --noEmit',
  'pnpm exec eslint app components lib --max-warnings=0',
  'pnpm run build',
]

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\u2019/g, "'")
}

function compactTitle(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const withoutCommand = clean.replace(/^(please\s+)?(fix|build|wire|connect|repair|implement|add|update|create|audit|run)\s+/i, '')
  const clipped = withoutCommand.length > 80 ? `${withoutCommand.slice(0, 77)}...` : withoutCommand
  return clipped ? `Engineering task: ${clipped}` : 'Engineering task prepared'
}

function inferIntentKind(text: string): EngineeringIntentKind {
  if (/\bweather\s+provider\b|\bprovider\b/.test(text)) return 'provider_fix'
  if (/\bui\b|\binterface\b|\bpanel\b|\btab\b|\bcard\b/.test(text)) return 'ui_update'
  if (/\baudit\s+code\b|\bcode\s+audit\b|\binspect\b/.test(text)) return 'code_audit'
  if (/\brun\s+validation\b|\btypecheck\b|\blint\b|\bbuild\b/.test(text)) return 'validation'
  if (/\bwire\b|\bconnect\b|\bintegration\b|\bbridge\b/.test(text)) return 'wire_integration'
  if (/\bimplement\b|\bbuild\b|\badd\b/.test(text)) return 'build_feature'
  return 'code_repair'
}

function inferFilesToInspect(raw: string, intentKind: EngineeringIntentKind): string[] {
  const text = normalize(raw)
  const files = new Set<string>(['app/page.tsx'])

  if (text.includes('weather')) {
    files.add('lib/intelligence/environment')
    files.add('components/intelligence/LiveEnvironmentPanel.tsx')
    files.add('app/api')
  }
  if (text.includes('provider')) {
    files.add('lib/ai')
    files.add('lib/council/providerTimeouts.ts')
    files.add('lib/warRoom/providerReadiness.ts')
  }
  if (text.includes('ui') || text.includes('tab') || text.includes('card')) {
    files.add('components/war-room')
  }
  if (text.includes('repair') || text.includes('patch') || text.includes('rollback')) {
    files.add('lib/repair')
    files.add('lib/repo')
  }
  if (intentKind === 'wire_integration') {
    files.add('lib/engine-control')
  }

  return [...files]
}

export function detectEngineeringIntentFromDecree(decree: string): EngineeringIntentDetection {
  const text = normalize(decree)
  const matchedTerms = ENGINEERING_TERMS.filter(term => text.includes(term))
  const isEngineeringIntent = matchedTerms.length > 0
  const intentKind = inferIntentKind(text)
  const title = compactTitle(decree)
  const objective = isEngineeringIntent
    ? `Prepare a Commander-approved engineering handoff for: ${decree.trim()}`
    : 'No engineering handoff required.'

  return {
    isEngineeringIntent,
    intentKind,
    matchedTerms,
    filesToInspect: inferFilesToInspect(decree, intentKind),
    title,
    objective,
    currentIssue: decree.trim() || 'No decree supplied.',
  }
}

export function buildCursorHandoffText(packet: EngineeringTaskPacket): string {
  return [
    `Title: ${packet.title}`,
    `Packet source: ${packet.packetSource}`,
    `Approval status: ${packet.approvalStatus}`,
    '',
    `Objective: ${packet.objective}`,
    `Current issue: ${packet.currentIssue}`,
    '',
    'Files to inspect:',
    ...packet.filesToInspect.map(file => `- ${file}`),
    '',
    'Constraints:',
    ...packet.constraints.map(item => `- ${item}`),
    '',
    'Approval boundaries:',
    ...packet.approvalBoundaries.map(item => `- ${item}`),
    '',
    'Validation commands:',
    ...packet.validationCommands.map(command => `- ${command}`),
    '',
    'Validation checklist:',
    ...packet.validationChecklist.map(item => `- ${item}`),
    '',
    'Risk notes:',
    ...packet.riskNotes.map(item => `- ${item}`),
    '',
    `Commit message: ${packet.commitMessage}`,
    '',
    'Expected return format:',
    ...packet.expectedReturnFormat.map(item => `- ${item}`),
  ].join('\n')
}

export function createEngineeringTaskPacket(decree: string, now = new Date()): EngineeringTaskPacket | null {
  const detection = detectEngineeringIntentFromDecree(decree)
  if (!detection.isEngineeringIntent) return null

  const safeSlug = detection.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  const id = `eng-${now.getTime()}-${safeSlug || 'task'}`
  const rollbackRecommendation = 'Create or confirm a rollback checkpoint before applying file changes; do not auto-rollback.'
  const packetBase = {
    id,
    title: detection.title,
    objective: detection.objective,
    currentIssue: detection.currentIssue,
    sourceDecree: decree,
    packetSource: 'Live Council decree',
    intentKind: detection.intentKind,
    assignedExecutorId: 'cursor' as const,
    assignedExecutorLabel: 'Cursor' as const,
    status: 'awaiting_commander_approval' as const,
    approvalStatus: 'awaiting_commander_approval' as const,
    filesToInspect: detection.filesToInspect,
    constraints: [
      'War Room prepares, routes, inspects, summarizes, and proposes only.',
      'Do not modify files, commit, push, deploy, delete, or run destructive actions without Commander approval.',
      'Prefer existing repository patterns and preserve Live Council routing, family responses, memory, repair ledger, Red Sentinel, and configuration sweep.',
    ],
    approvalBoundaries: [
      'Commander approval required before execution outside the task packet.',
      'Cursor is a preferred manual executor, not an API invoked by War Room.',
      'Any file changes require visible diff review and validation results before commit/push approval.',
    ],
    validationCommands: ENGINEERING_VALIDATION_COMMANDS,
    validationChecklist: [
      'Confirm the implementation remains cloud-only and does not add local bridge/connectors.',
      'Confirm no browser path can run shell commands, mutate files, deploy, spend, outreach, or hide actions.',
      'Run typecheck, lint, and production build before any commit.',
    ],
    riskNotes: [
      'Do not expose API key values or server-only secret names in client-facing copy.',
      'Do not claim connected/online unless a live health check or persisted evidence supports it.',
      'Keep the packet copy-only; War Room must not invoke Cursor or mutate the repo.',
    ],
    commitMessage: 'feat(engineering): wire cursor engineering agent bridge into live council',
    expectedReturnFormat: [
      'Files changed',
      'Behavior changed',
      'Validation results',
      'Risks or rollback notes',
      'Commit hash only after Commander-approved commit',
    ],
    reviewBy: ['claude', 'red_team'] as Array<'claude' | 'red_team'>,
    rollbackRecommendation,
    createdAt: now.toISOString(),
  }

  const packetWithoutCursorCommand = {
    ...packetBase,
    cursorCommand: '',
    audit: {
      category: 'engineering' as const,
      message: `Engineering task packet prepared for Cursor: ${detection.title}`,
      metadata: {
        taskPacketId: id,
        executor: 'cursor' as const,
        approvalRequired: true as const,
        canMutateFromWarRoom: false as const,
        source: 'live_council' as const,
      },
    },
    repairMemory: {
      issue: detection.currentIssue,
      expectedFiles: detection.filesToInspect,
      validationPlan: ENGINEERING_VALIDATION_COMMANDS,
      rollbackNotes: rollbackRecommendation,
      status: 'prepared_not_executed' as const,
    },
  } satisfies EngineeringTaskPacket

  return {
    ...packetWithoutCursorCommand,
    cursorCommand: buildCursorHandoffText(packetWithoutCursorCommand),
  }
}

export function createEngineeringTaskPacketFromSources(input: {
  title: string
  objective: string
  currentIssue: string
  packetSource: string
  filesToInspect: string[]
  riskNotes: string[]
  validationChecklist?: string[]
  commitMessage?: string
  now?: Date
}): EngineeringTaskPacket {
  const now = input.now ?? new Date()
  const safeSlug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
  const id = `eng-${now.getTime()}-${safeSlug || 'task'}`
  const packetWithoutCursorCommand = {
    id,
    title: input.title,
    objective: input.objective,
    currentIssue: input.currentIssue,
    sourceDecree: input.packetSource,
    packetSource: input.packetSource,
    intentKind: 'code_repair' as const,
    assignedExecutorId: 'cursor' as const,
    assignedExecutorLabel: 'Cursor' as const,
    status: 'awaiting_commander_approval' as const,
    approvalStatus: 'awaiting_commander_approval' as const,
    filesToInspect: [...new Set(input.filesToInspect)].slice(0, 12),
    constraints: [
      'Manual Cursor handoff only; War Room must not invoke Cursor APIs or mutate files.',
      'No shell execution, file mutation, deployment, spend, outreach, or hidden action from browser/app surfaces.',
      'Preserve cloud-only provider families and do not reintroduce local connectors or bridges.',
    ],
    approvalBoundaries: [
      'Commander approval required before any repository change.',
      'Copy Packet is the only handoff mechanism in War Room.',
      'Validation results must be returned visibly after manual Cursor work.',
    ],
    validationCommands: ENGINEERING_VALIDATION_COMMANDS,
    validationChecklist: input.validationChecklist ?? [
      'Verify source evidence is visible in the UI before implementation.',
      'Verify statuses are health-derived and truth-labeled.',
      'Verify no privileged server logic is imported by client components.',
    ],
    riskNotes: input.riskNotes,
    commitMessage: input.commitMessage ?? 'chore(engineering): apply cursor task packet',
    expectedReturnFormat: [
      'Files changed',
      'Behavior changed',
      'Validation results',
      'Risks or rollback notes',
      'Commit hash only after Commander-approved commit',
    ],
    reviewBy: ['claude', 'red_team'] as Array<'claude' | 'red_team'>,
    rollbackRecommendation: 'Create or confirm a rollback checkpoint before applying file changes; do not auto-rollback.',
    createdAt: now.toISOString(),
    cursorCommand: '',
    audit: {
      category: 'engineering' as const,
      message: `Engineering task packet prepared for Cursor: ${input.title}`,
      metadata: {
        taskPacketId: id,
        executor: 'cursor' as const,
        approvalRequired: true as const,
        canMutateFromWarRoom: false as const,
        source: 'live_council' as const,
      },
    },
    repairMemory: {
      issue: input.currentIssue,
      expectedFiles: [...new Set(input.filesToInspect)].slice(0, 12),
      validationPlan: ENGINEERING_VALIDATION_COMMANDS,
      rollbackNotes: 'Create or confirm a rollback checkpoint before applying file changes; do not auto-rollback.',
      status: 'prepared_not_executed' as const,
    },
  } satisfies EngineeringTaskPacket

  return {
    ...packetWithoutCursorCommand,
    cursorCommand: buildCursorHandoffText(packetWithoutCursorCommand),
  }
}
