import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import { classifyIntentFromDecree, type IntentKind } from '@/lib/council/intentClassifier'
import { parseCouncilCommand } from '@/lib/council/commandParser'
import { decreeAsksMultiFamilyGreeting } from '@/lib/council/greetingRouting'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import { detectFullTeamRequired } from '@/lib/council/fullTeamGate'

export type WarRoomMode = 'greeting' | 'attendance' | 'recovery' | 'council' | 'deep_analysis' | 'execution'

export type ModeGovernor = {
  mode: WarRoomMode
  maxSentences: number
  continuationAllowed: boolean
  providerAwareness: boolean
  allowCrossFamilyReference: boolean
  fullTeamRequired: boolean
  allowSpeculation: boolean
  allowLongForm: boolean
  renderImmediately: boolean
}

const DEEP_ANALYSIS_DECREE =
  /\b(expand|deep\s*dive|continue\s+analysis|full\s+analysis|go\s+deeper|extended\s+analysis)\b/i

function normDecree(text: string): string {
  return text.trim().toLowerCase().replace(/\u2019/g, "'")
}

function providerStatesNeedRecovery(
  providerStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>,
): boolean {
  if (!providerStates || !Object.keys(providerStates).length) return false
  return Object.values(providerStates).some(
    s => s === 'TIMED_OUT' || s === 'FAILED' || s === 'DEGRADED',
  )
}

function attendanceMissing(
  providerStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined,
  directedFamilies: CouncilOrchestrationFamily[] | undefined,
): boolean {
  if (!providerStates || !directedFamilies?.length) return false
  return directedFamilies.some(f => {
    const s = providerStates[f]
    return !s || s === 'TIMED_OUT' || s === 'FAILED' || s === 'SKIPPED'
  })
}

function basePreset(mode: WarRoomMode, decreeText: string): ModeGovernor {
  switch (mode) {
    case 'greeting':
      return {
        mode,
        maxSentences: 2,
        continuationAllowed: false,
        providerAwareness: false,
        allowCrossFamilyReference: false,
        fullTeamRequired: false,
        allowSpeculation: false,
        allowLongForm: false,
        renderImmediately: !decreeAsksMultiFamilyGreeting(decreeText),
      }
    case 'attendance':
      return {
        mode,
        maxSentences: 1,
        continuationAllowed: false,
        providerAwareness: true,
        allowCrossFamilyReference: true,
        fullTeamRequired: detectFullTeamRequired(decreeText),
        allowSpeculation: false,
        allowLongForm: false,
        renderImmediately: true,
      }
    case 'recovery':
      return {
        mode,
        maxSentences: 1,
        continuationAllowed: false,
        providerAwareness: true,
        allowCrossFamilyReference: false,
        fullTeamRequired: false,
        allowSpeculation: false,
        allowLongForm: false,
        renderImmediately: true,
      }
    case 'deep_analysis':
      return {
        mode,
        maxSentences: 12,
        continuationAllowed: true,
        providerAwareness: true,
        allowCrossFamilyReference: true,
        fullTeamRequired: detectFullTeamRequired(decreeText),
        allowSpeculation: false,
        allowLongForm: true,
        renderImmediately: false,
      }
    case 'execution':
      return {
        mode,
        maxSentences: 6,
        continuationAllowed: false,
        providerAwareness: true,
        allowCrossFamilyReference: false,
        fullTeamRequired: detectFullTeamRequired(decreeText),
        allowSpeculation: false,
        allowLongForm: false,
        renderImmediately: false,
      }
    case 'council':
    default:
      return {
        mode: 'council',
        maxSentences: 5,
        continuationAllowed: true,
        providerAwareness: true,
        allowCrossFamilyReference: true,
        fullTeamRequired: detectFullTeamRequired(decreeText),
        allowSpeculation: true,
        allowLongForm: false,
        renderImmediately: false,
      }
  }
}

function resolveWarRoomMode(args: {
  decreeText: string
  intentKind: IntentKind
  councilCommand: CouncilCommand
  providerStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
  directedFamilies?: CouncilOrchestrationFamily[]
}): WarRoomMode {
  const { decreeText, intentKind, councilCommand, providerStates, directedFamilies } = args

  if (
    providerStatesNeedRecovery(providerStates)
    || (intentKind === 'attendance' && attendanceMissing(providerStates, directedFamilies))
  ) {
    return 'recovery'
  }

  if (DEEP_ANALYSIS_DECREE.test(normDecree(decreeText))) return 'deep_analysis'

  if (intentKind === 'greeting') return 'greeting'
  if (intentKind === 'attendance' || councilCommand.mode === 'attendance') return 'attendance'
  if (intentKind === 'execution' || councilCommand.mode === 'execution') return 'execution'

  return 'council'
}

export type ResolveModeGovernorArgs = {
  decreeText: string
  intentKind?: IntentKind
  councilCommand?: CouncilCommand
  providerStates?: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>>
  directedFamilies?: CouncilOrchestrationFamily[]
}

/**
 * Decree-first mode governor — maps intent/command/provider outcomes into response discipline.
 */
export function resolveModeGovernor(args: ResolveModeGovernorArgs): ModeGovernor {
  const decreeText = typeof args.decreeText === 'string' ? args.decreeText : ''
  const councilCommand = args.councilCommand ?? parseCouncilCommand(decreeText)
  const intentKind = args.intentKind ?? classifyIntentFromDecree(decreeText)
  const warMode = resolveWarRoomMode({
    decreeText,
    intentKind,
    councilCommand,
    providerStates: args.providerStates,
    directedFamilies: args.directedFamilies,
  })
  return basePreset(warMode, decreeText)
}
