import {
  COUNCIL_REPAIR_GUARDRAILS,
  REPAIR_VALIDATION_COMMANDS,
  type BabyRepairLessonCandidate,
  type CouncilRepairPacket,
  type CouncilRepairRequest,
  type CreateRepairPacketInput,
  type CreateRepairRequestInput,
  type RepairFamilyContribution,
} from './model'
import { classifyRepairRequest, compactRepairText, matchedRepairTriggers } from './classifier'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'repair'
}

function titleFromRequest(request: CouncilRepairRequest): string {
  const clean = compactRepairText(request.decree, 90).replace(/[.?!]+$/g, '')
  const base = clean.replace(/^(please\s+)?(fix|repair|diagnose|create|send|prepare)\s+/i, '')
  return `Repair packet: ${base || request.classification.replace(/_/g, ' ')}`
}

function sourceText(input: CreateRepairRequestInput): string {
  return [input.decree, input.sourceFamily, input.sourceContent].filter(Boolean).join(' ')
}

export function createCouncilRepairRequest(input: CreateRepairRequestInput, now = new Date()): CouncilRepairRequest {
  const decree = compactRepairText(input.decree, 4000)
  const text = sourceText({ ...input, decree })
  const rule = classifyRepairRequest(text)
  return {
    id: `crr-${now.getTime()}-${slug(decree)}`,
    decree,
    sourceMessageId: input.sourceMessageId?.trim() || null,
    sourceFamily: input.sourceFamily?.trim() || null,
    sourceContent: input.sourceContent ? compactRepairText(input.sourceContent, 1200) : null,
    classification: rule.classification,
    matchedTriggers: matchedRepairTriggers(text),
    createdAt: now.toISOString(),
    advisoryOnly: true,
  }
}

function familyContributions(request: CouncilRepairRequest, symptoms: string[], rootCause: string): RepairFamilyContribution[] {
  const symptom = symptoms[0] ?? request.decree
  return [
    {
      family: 'chatgpt',
      label: 'ChatGPT',
      role: 'Synthesis / priority',
      contribution: `Prioritize a narrow repair for "${compactRepairText(symptom, 180)}" and keep the handoff Commander-approved before implementation.`,
      approvalRequired: true,
      canExecute: false,
    },
    {
      family: 'claude',
      label: 'Claude',
      role: 'Architecture / root cause',
      contribution: `Start with the module boundary implied by ${request.classification.replace(/_/g, ' ')}. Suspected root cause: ${rootCause}`,
      approvalRequired: true,
      canExecute: false,
    },
    {
      family: 'grok',
      label: 'Grok',
      role: 'Runtime / signal context',
      contribution: 'Check runtime, Signal Radar, provider, and Commander context for evidence before claiming the issue is fixed or externally caused.',
      approvalRequired: true,
      canExecute: false,
    },
    {
      family: 'gemini',
      label: 'Gemini',
      role: 'Evidence summary',
      contribution: `Evidence currently comes from the Commander decree${request.sourceFamily ? ` and ${request.sourceFamily} response` : ''}; implementation needs file/API inspection and validation output.`,
      approvalRequired: true,
      canExecute: false,
    },
    {
      family: 'red_team',
      label: 'Red Team',
      role: 'Risk / guardrail review',
      contribution: 'Repair packet is advisory only. No browser-side execution, repo mutation, shell command execution, direct Cursor API, auto deploy, or fake completion is allowed.',
      approvalRequired: true,
      canExecute: false,
    },
    {
      family: 'baby_observer',
      label: 'Baby Observer',
      role: 'Lesson candidate',
      contribution: 'Candidate lesson: repairs become useful training data only after Commander review and visible validation evidence.',
      approvalRequired: true,
      canExecute: false,
    },
  ]
}

function observedSymptoms(request: CouncilRepairRequest): string[] {
  return [
    request.decree,
    request.sourceContent
      ? `${request.sourceFamily ?? 'Council response'} context: ${compactRepairText(request.sourceContent, 220)}`
      : 'No specific council response was attached; inspect the latest visible panel state and API response.',
    `Classified as ${request.classification.replace(/_/g, ' ')} from Commander repair language.`,
  ]
}

function connectedSurfaces(classification: CouncilRepairRequest['classification']): string[] {
  const base = ['Runtime Integrity', 'Provider Status', 'Signal Radar', 'Red Sentinel', 'Feature Builder', 'Outcome Ledger', 'Commander OS']
  if (classification === 'supabase_schema_issue') return [...base, 'System Ledger']
  if (classification === 'council_prompt_issue') return [...base, 'Live Council', 'Baby Observer']
  if (classification === 'routing_orchestration_issue') return [...base, 'Engineering Lane']
  return base
}

function cursorPrompt(packet: Omit<CouncilRepairPacket, 'cursorReadyPrompt'>): string {
  return [
    'Prepare this War Room repair manually in Cursor after Commander approval. This packet is advisory only.',
    '',
    `Title: ${packet.title}`,
    `Classification: ${packet.classification}`,
    `Approval status: ${packet.approvalStatus}`,
    `Packet source: ${packet.source.packetSource}`,
    '',
    'Observed symptoms:',
    ...packet.observedSymptoms.map(item => `- ${item}`),
    '',
    `Suspected root cause: ${packet.suspectedRootCause}`,
    '',
    'Files/routes to inspect:',
    ...packet.filesRoutesToInspect.map(item => `- ${item}`),
    '',
    'Recommended fix:',
    ...packet.recommendedFix.map(item => `- ${item}`),
    '',
    'Validation commands:',
    ...packet.validationCommands.map(item => `- ${item}`),
    '',
    'Risk notes:',
    ...packet.riskNotes.map(item => `- ${item}`),
    '',
    'Rollback notes:',
    ...packet.rollbackNotes.map(item => `- ${item}`),
    '',
    'Family contributions:',
    ...packet.familyContributions.map(item => `- ${item.label} (${item.role}): ${item.contribution}`),
    '',
    `Baby Observer lesson candidate: ${packet.babyLessonCandidate.summary}`,
    '',
    'Hard guardrails:',
    '- Approval required before any implementation.',
    '- War Room/browser must not execute code, mutate files, run shell commands, invoke Cursor APIs, deploy, commit, push, or claim repair completion.',
    '- Return visible files changed, validation results, risk/rollback notes, and commit hash only after approved manual work.',
  ].join('\n')
}

export function createCouncilRepairPacket(input: CreateRepairPacketInput, now = new Date()): CouncilRepairPacket {
  const request = input.request ?? createCouncilRepairRequest(input, now)
  const rule = classifyRepairRequest(sourceText({
    decree: request.decree,
    sourceFamily: request.sourceFamily,
    sourceContent: request.sourceContent,
  }))
  const symptoms = observedSymptoms(request)
  const family = familyContributions(request, symptoms, rule.rootCause)
  const babyLessonCandidate: BabyRepairLessonCandidate = {
    id: `${request.id}:baby-lesson`,
    summary: `When ${request.classification.replace(/_/g, ' ')} repair work is requested, preserve evidence, approval gates, and validation output before treating it as a lesson.`,
    source: 'repair_outcome',
    lessonState: 'candidate',
    commanderApprovalRequired: true,
    canExecute: false,
  }
  const packetBase = {
    id: `crp-${now.getTime()}-${slug(request.decree)}`,
    requestId: request.id,
    title: titleFromRequest(request),
    classification: request.classification,
    source: {
      decree: request.decree,
      sourceMessageId: request.sourceMessageId,
      sourceFamily: request.sourceFamily,
      sourceContent: request.sourceContent,
      packetSource: request.sourceFamily
        ? `Live Council response from ${request.sourceFamily}`
        : 'Live Council repair decree',
    },
    observedSymptoms: symptoms,
    suspectedRootCause: rule.rootCause,
    filesRoutesToInspect: [...new Set(rule.files)].slice(0, 12),
    recommendedFix: rule.recommendedFix,
    validationCommands: REPAIR_VALIDATION_COMMANDS,
    riskNotes: [
      ...rule.riskNotes,
      'Repair packet creation is logged for visibility but does not execute the repair.',
      'Manual Cursor copy is a handoff prompt only; approval and implementation happen outside War Room.',
    ],
    rollbackNotes: [
      'Keep implementation changes small and reviewable; rollback by reverting the approved manual Cursor diff.',
      'Do not auto-rollback from War Room or mark repair complete without validation evidence.',
      'If persistence/schema is involved, use additive migrations and preserve audit rows.',
    ],
    approvalStatus: 'awaiting_commander_approval' as const,
    familyContributions: family,
    riskReview: family.find(item => item.family === 'red_team') ?? family[4]!,
    babyLessonCandidate,
    connectedSurfaces: connectedSurfaces(request.classification),
    guardrails: COUNCIL_REPAIR_GUARDRAILS,
    createdAt: now.toISOString(),
  } satisfies Omit<CouncilRepairPacket, 'cursorReadyPrompt'>

  return {
    ...packetBase,
    cursorReadyPrompt: cursorPrompt(packetBase),
  }
}
