import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const COUNCIL_ROSTER_MEMBERSHIP_STATES = [
  'CONFIGURED',
  'ACTIVE',
  'UNAVAILABLE',
  'FAILED_DURING_ROUND',
  'SKIPPED_BY_POLICY',
] as const

export type CouncilRosterMembershipState = (typeof COUNCIL_ROSTER_MEMBERSHIP_STATES)[number]

export const COUNCIL_ROSTER_UNAVAILABLE_REASONS = [
  'UNAVAILABLE_BILLING',
  'UNAVAILABLE_AUTH',
  'UNAVAILABLE_NOT_CONFIGURED',
  'UNAVAILABLE_OTHER',
] as const

export type CouncilRosterUnavailableReason = (typeof COUNCIL_ROSTER_UNAVAILABLE_REASONS)[number]

export type CouncilFamilyRosterEntry = {
  family: CouncilOrchestrationFamily
  configured: boolean
  membership: CouncilRosterMembershipState
  unavailableReason: CouncilRosterUnavailableReason | null
  floorEligible: boolean
  uiStatus: 'READY' | 'UNAVAILABLE'
  uiDetail: string
}

export type CouncilRosterSnapshot = {
  families: Partial<Record<CouncilOrchestrationFamily, CouncilFamilyRosterEntry>>
  activeFloorFamilies: CouncilOrchestrationFamily[]
  intendedPrimaryCount: number
  activePrimaryCount: number
  degradedByRoster: boolean
  degradedLabel: string
  redTeam: 'ACTIVE' | 'SKIPPED_BY_POLICY' | 'UNAVAILABLE'
}

export type RosterPolicyOverride = Partial<Record<CouncilOrchestrationFamily, string>>

const PRIMARY_FAMILIES: CouncilOrchestrationFamily[] = ['chatgpt', 'claude', 'grok', 'gemini']

export function parseRosterOverride(raw: string | undefined | null): string | null {
  if (!raw) return null
  const v = raw.trim().toUpperCase().replace(/\s+/g, '_')
  return v || null
}

export function familyUiLabel(family: CouncilOrchestrationFamily): string {
  if (family === 'chatgpt') return 'ChatGPT'
  if (family === 'claude') return 'Claude'
  if (family === 'grok') return 'Grok'
  if (family === 'gemini') return 'Gemini'
  if (family === 'red_team') return 'Red Team'
  if (family === 'kimi') return 'Kimi'
  if (family === 'baby') return 'Baby'
  return family
}

function entryFromPolicy(input: {
  family: CouncilOrchestrationFamily
  configured: boolean
  override: string | null
}): CouncilFamilyRosterEntry {
  const { family, configured, override } = input
  if (!configured) {
    return {
      family,
      configured: false,
      membership: 'UNAVAILABLE',
      unavailableReason: 'UNAVAILABLE_NOT_CONFIGURED',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: 'Not configured',
    }
  }
  if (override === 'UNAVAILABLE_BILLING') {
    return {
      family,
      configured: true,
      membership: 'UNAVAILABLE',
      unavailableReason: 'UNAVAILABLE_BILLING',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: 'UNAVAILABLE_BILLING',
    }
  }
  if (override === 'UNAVAILABLE_AUTH') {
    return {
      family,
      configured: true,
      membership: 'UNAVAILABLE',
      unavailableReason: 'UNAVAILABLE_AUTH',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: 'UNAVAILABLE_AUTH',
    }
  }
  if (override === 'SKIPPED_BY_POLICY' || override === 'UNAVAILABLE') {
    return {
      family,
      configured: true,
      membership: override === 'SKIPPED_BY_POLICY' ? 'SKIPPED_BY_POLICY' : 'UNAVAILABLE',
      unavailableReason: 'UNAVAILABLE_OTHER',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: override,
    }
  }
  return {
    family,
    configured: true,
    membership: 'ACTIVE',
    unavailableReason: null,
    floorEligible: true,
    uiStatus: 'READY',
    uiDetail: 'READY',
  }
}

export function buildCouncilRosterSnapshot(input: {
  configured: Partial<Record<CouncilOrchestrationFamily, boolean>>
  overrides?: RosterPolicyOverride
}): CouncilRosterSnapshot {
  const families: Partial<Record<CouncilOrchestrationFamily, CouncilFamilyRosterEntry>> = {}
  const claudeOverride = parseRosterOverride(input.overrides?.claude)
  const grokOverride = parseRosterOverride(input.overrides?.grok)
  const chatgptOverride = parseRosterOverride(input.overrides?.chatgpt)
  const geminiOverride = parseRosterOverride(input.overrides?.gemini)
  const redOverride = parseRosterOverride(input.overrides?.red_team)

  families.chatgpt = entryFromPolicy({ family: 'chatgpt', configured: Boolean(input.configured.chatgpt), override: chatgptOverride })
  families.claude = entryFromPolicy({ family: 'claude', configured: Boolean(input.configured.claude), override: claudeOverride })
  families.grok = entryFromPolicy({ family: 'grok', configured: Boolean(input.configured.grok), override: grokOverride })
  families.gemini = entryFromPolicy({ family: 'gemini', configured: Boolean(input.configured.gemini), override: geminiOverride })

  const claudeActive = families.claude?.floorEligible === true
  let redTeam: CouncilRosterSnapshot['redTeam'] = 'UNAVAILABLE'
  if (!input.configured.red_team && !input.configured.claude) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: false, override: null })
    redTeam = 'UNAVAILABLE'
  } else if (redOverride === 'ACTIVE' && claudeActive) {
    families.red_team = entryFromPolicy({ family: 'red_team', configured: true, override: 'ACTIVE' })
    redTeam = 'ACTIVE'
  } else if (!claudeActive) {
    families.red_team = {
      family: 'red_team',
      configured: Boolean(input.configured.red_team ?? input.configured.claude),
      membership: 'SKIPPED_BY_POLICY',
      unavailableReason: families.claude?.unavailableReason ?? 'UNAVAILABLE_OTHER',
      floorEligible: false,
      uiStatus: 'UNAVAILABLE',
      uiDetail: 'SKIPPED_BY_POLICY',
    }
    redTeam = 'SKIPPED_BY_POLICY'
  } else {
    families.red_team = entryFromPolicy({
      family: 'red_team',
      configured: Boolean(input.configured.red_team ?? input.configured.claude),
      override: redOverride,
    })
    redTeam = families.red_team.floorEligible ? 'ACTIVE' : 'UNAVAILABLE'
  }

  const activeFloorFamilies = PRIMARY_FAMILIES.filter(family => families[family]?.floorEligible)
  const intendedPrimaryCount = PRIMARY_FAMILIES.filter(family => families[family]?.configured).length
  const activePrimaryCount = activeFloorFamilies.length
  const degradedByRoster = activePrimaryCount < Math.max(intendedPrimaryCount, 1) || redTeam !== 'ACTIVE'
  const degradedLabel = degradedByRoster
    ? `COUNCIL DEGRADED · ${activePrimaryCount}/${Math.max(intendedPrimaryCount, PRIMARY_FAMILIES.length)} PROVIDERS ACTIVE`
    : 'COUNCIL FULL ROSTER ACTIVE'

  return {
    families,
    activeFloorFamilies,
    intendedPrimaryCount: Math.max(intendedPrimaryCount, PRIMARY_FAMILIES.length),
    activePrimaryCount,
    degradedByRoster,
    degradedLabel,
    redTeam,
  }
}

export function rosterToFloorFlags(snapshot: CouncilRosterSnapshot): {
  configured: Partial<Record<CouncilOrchestrationFamily, boolean>>
  eligible: Partial<Record<CouncilOrchestrationFamily, boolean>>
} {
  const configured: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  const eligible: Partial<Record<CouncilOrchestrationFamily, boolean>> = {}
  for (const family of ['chatgpt', 'claude', 'grok', 'gemini', 'red_team', 'kimi', 'baby'] as CouncilOrchestrationFamily[]) {
    configured[family] = Boolean(snapshot.families[family]?.configured)
    eligible[family] = Boolean(snapshot.families[family]?.floorEligible)
  }
  return { configured, eligible }
}

const DISPLAY_OVERRIDE_FAMILIES: CouncilOrchestrationFamily[] = [...PRIMARY_FAMILIES, 'red_team']

/**
 * Display-only overlay for LOCAL_FIRST/LOCAL_ONLY/HYBRID routing. Cloud-key floor eligibility
 * (used for real external-routing decisions elsewhere) is never mutated by this function — it
 * returns a new snapshot. A family that isn't cloud-eligible but has an enabled local Nebula
 * agent candidate is ALSO treated as present for Commander-facing membership/readiness display,
 * since the Nebula agent genuinely can (and does) serve that seat locally. Exists so the Members
 * panel doesn't report "0/4 PROVIDERS ACTIVE" cloud-key language while a local Nebula Council is
 * actually operating.
 */
export function withNebulaLocalDisplayOverride(
  snapshot: CouncilRosterSnapshot,
  locallyEnabled: Partial<Record<CouncilOrchestrationFamily, boolean>>,
): CouncilRosterSnapshot {
  const families = { ...snapshot.families }
  for (const family of DISPLAY_OVERRIDE_FAMILIES) {
    const row = families[family]
    if (row && !row.floorEligible && locallyEnabled[family]) {
      families[family] = {
        ...row,
        floorEligible: true,
        uiStatus: 'READY',
        uiDetail: 'READY (local Nebula agent)',
      }
    }
  }
  const activeFloorFamilies = PRIMARY_FAMILIES.filter(family => families[family]?.floorEligible)
  const activePrimaryCount = activeFloorFamilies.length
  const redTeam: CouncilRosterSnapshot['redTeam'] = families.red_team?.floorEligible ? 'ACTIVE' : snapshot.redTeam
  const degradedByRoster = activePrimaryCount < Math.max(snapshot.intendedPrimaryCount, 1) || redTeam !== 'ACTIVE'
  const degradedLabel = degradedByRoster
    ? `NEBULA COUNCIL DEGRADED · ${activePrimaryCount}/${Math.max(snapshot.intendedPrimaryCount, PRIMARY_FAMILIES.length)} AGENTS ACTIVE`
    : 'NEBULA COUNCIL FULL ROSTER ACTIVE'
  return { ...snapshot, families, activeFloorFamilies, activePrimaryCount, degradedByRoster, degradedLabel, redTeam }
}

export function compactFamilyRosterLine(snapshot: CouncilRosterSnapshot): string {
  const parts = (['chatgpt', 'claude', 'grok', 'gemini'] as const).map(family => {
    const row = snapshot.families[family]
    return `${familyUiLabel(family)} · ${row?.uiStatus ?? 'UNAVAILABLE'}`
  })
  return `${snapshot.degradedLabel} · ${parts.join(' · ')}`
}
