import {
  CANONICAL_COUNCIL_IDENTITIES,
  CANONICAL_COUNCIL_SEATS,
  canonicalIdentityForSeat,
  identitiesUnchangedAcrossBacking,
  projectCouncilMemberIdentity,
} from '@/lib/council/live-orchestration/councilIdentity'
import { buildCouncilRosterSnapshot, rosterMemberPresentation } from '@/lib/council/live-orchestration/rosterHealth'
import {
  CANONICAL_COUNCIL_MEMBER_IDS,
  NEBULA_AGENTS_BY_ID,
  PRIMARY_COUNCIL_ENTITY_IDS,
  displayNameForSeat,
} from '@/lib/council/nebula/identity'
import { identitiesAreNotProviders, projectCouncilEntityView } from '@/lib/council/nebula/entityPresence'
import { NEBULA_ROLE_CONTRACTS } from '@/lib/council/nebula/roleContracts'
import { identitySurvivesBackendChange, createExecutionRecord } from '@/lib/council/nebula/execution'
import { NEBULA_SHARED_LOCAL_MODEL_ID } from '@/lib/council/nebula/modelProfile'
import { isPrimaryCouncilEntityId } from '@/lib/council/nebula/rosterClassification'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) original[key] = process.env[key]
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export function runCouncilIdentityRestorationValidation(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check(
    'canonical registry is Nebula, not a second Council',
    PRIMARY_COUNCIL_ENTITY_IDS.join(',') === 'aurora,orion,pulsar,lumen'
      && CANONICAL_COUNCIL_IDENTITIES.join(',') === 'AURORA,ORION,PULSAR,LUMEN'
      && identitiesAreNotProviders(),
    PRIMARY_COUNCIL_ENTITY_IDS.join(','),
  ))

  results.push(check(
    'AURORA/ORION/PULSAR/LUMEN are not provider names',
    displayNameForSeat('chatgpt') === 'AURORA'
      && displayNameForSeat('claude') === 'ORION'
      && displayNameForSeat('grok') === 'PULSAR'
      && displayNameForSeat('gemini') === 'LUMEN'
      && displayNameForSeat('chatgpt') !== 'OpenAI'
      && displayNameForSeat('claude') !== 'Anthropic',
    `${displayNameForSeat('chatgpt')}/${displayNameForSeat('claude')}/${displayNameForSeat('grok')}/${displayNameForSeat('gemini')}`,
  ))

  results.push(check(
    'NOVA is a canonical fifth member, not a substitute for the four',
    CANONICAL_COUNCIL_MEMBER_IDS.includes('nova')
      && !isPrimaryCouncilEntityId('nova')
      && NEBULA_AGENTS_BY_ID.nova.name === 'NOVA'
      && NEBULA_AGENTS_BY_ID.nova.role.toLowerCase().includes('strategy'),
    `nova role=${NEBULA_AGENTS_BY_ID.nova.role}`,
  ))

  const localSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: {
      localReady: true,
      localModel: NEBULA_SHARED_LOCAL_MODEL_ID,
      routingPreference: 'AUTO',
      routingModeResolved: 'LOCAL_FIRST',
      terraConnection: 'CONNECTED',
      networkEgress: 'AVAILABLE',
    },
  })

  const four = CANONICAL_COUNCIL_SEATS.map(seat => localSnap.families[seat]!)
  results.push(check(
    'four Council entities remain READY with 0 cloud keys',
    four.length === 4
      && four.every(row => row.memberIdentityStatus === 'READY' && row.uiDetail === 'READY')
      && four.map(row => row.identityName).join(',') === 'AURORA,ORION,PULSAR,LUMEN'
      && localSnap.entityPresentCount === 4
      && localSnap.entityReadyCount === 4
      && localSnap.externalProviderCount.configured === 0,
    four.map(row => `${row.identityName}:${row.uiDetail}`).join('|'),
  ))

  results.push(check(
    'entity presentation is not a vendor line',
    four.every(row => rosterMemberPresentation(row).label === 'READY')
      && four.every(row => (row.backingLine ?? '').includes('Local Shared General'))
      && four.every(row => (rosterMemberPresentation(row).localLine ?? '').includes('Local'))
      && four.every(row => !/openai|anthropic|xai|gemini/i.test(rosterMemberPresentation(row).label)),
    JSON.stringify(rosterMemberPresentation(four[0]!)),
  ))

  results.push(check(
    'optional providers stay optional and do not own identities',
    four.every(row => row.cloudState === 'NOT_CONFIGURED')
      && four.every(row => (row.optionalExternalDetail ?? '').includes('NOT CONFIGURED')),
    four.map(row => row.optionalExternalDetail).join('|'),
  ))

  results.push(check(
    'shared model diversity is truthful',
    localSnap.modelDiversity === 'SHARED LOCAL MODEL'
      && /ROLE.?DIVERSE/i.test(localSnap.reasoningDiversity)
      && localSnap.backingIntelligence.label === 'War Room Local',
    `model=${localSnap.modelDiversity} perspective=${localSnap.reasoningDiversity}`,
  ))

  results.push(check(
    'roles/perspectives preserved from Nebula contracts',
    PRIMARY_COUNCIL_ENTITY_IDS.every(id => NEBULA_ROLE_CONTRACTS[id].name === NEBULA_AGENTS_BY_ID[id].name)
      && NEBULA_ROLE_CONTRACTS.aurora.requiredOutputContract.includes('aurora')
      && NEBULA_ROLE_CONTRACTS.orion.optimizationTarget.length > 0
      && NEBULA_ROLE_CONTRACTS.pulsar.optimizationTarget.length > 0
      && NEBULA_ROLE_CONTRACTS.lumen.optimizationTarget.length > 0,
    'contracts present',
  ))

  const zeroSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: false, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  const zeroFour = CANONICAL_COUNCIL_SEATS.map(seat => zeroSnap.families[seat]!)
  results.push(check(
    'zero-backend identities still exist',
    zeroFour.every(row => Boolean(row.identityName))
      && zeroFour.map(row => row.identityName).join(',') === 'AURORA,ORION,PULSAR,LUMEN'
      && zeroFour.every(row => row.uiDetail === 'BACKEND UNAVAILABLE')
      && zeroFour.every(row => row.memberIdentityStatus === 'PRESENT_BACKEND_UNAVAILABLE')
      && zeroSnap.entityPresentCount === 4
      && zeroSnap.entityReadyCount === 0
      && zeroSnap.entityHeadline.includes('BACKEND UNAVAILABLE'),
    zeroFour.map(row => `${row.identityName}:${row.uiDetail}`).join('|'),
  ))

  results.push(check(
    'backend-swap does not change identities',
    identitiesUnchangedAcrossBacking(NEBULA_SHARED_LOCAL_MODEL_ID, 'qwen2.5-coder:14b')
      && identitySurvivesBackendChange(
        createExecutionRecord({ agentId: 'aurora', model: NEBULA_SHARED_LOCAL_MODEL_ID, backendType: 'LOCAL' }),
        createExecutionRecord({ agentId: 'aurora', model: 'qwen2.5-coder:14b', backendType: 'LOCAL' }),
      ),
    'AURORA remains AURORA',
  ))

  const added = withEnv({ OPENAI_API_KEY: 'sk-TEST-ONLY-NOT-A-REAL-SECRET' }, () =>
    buildCouncilRosterSnapshot({
      configured: { chatgpt: true, claude: false, grok: false, gemini: false },
      continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'HYBRID' },
    }),
  )
  results.push(check(
    'provider addition does not create or rename members',
    added.families.chatgpt?.identityName === 'AURORA'
      && added.entityPresentCount === 4
      && CANONICAL_COUNCIL_SEATS.every(seat => canonicalIdentityForSeat(seat) === added.families[seat]?.identityName)
      && added.externalProviderCount.configured === 1,
    `aurora=${added.families.chatgpt?.identityName} configured=${added.externalProviderCount.configured}`,
  ))

  const restartSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: true },
  })
  results.push(check(
    'restart persistence: identities remain defined after re-projection',
    restartSnap.families.chatgpt?.identityName === 'AURORA'
      && restartSnap.families.claude?.identityName === 'ORION'
      && restartSnap.families.grok?.identityName === 'PULSAR'
      && restartSnap.families.gemini?.identityName === 'LUMEN',
    'registry re-import preserved names',
  ))

  const localView = projectCouncilEntityView({
    agentId: 'aurora',
    backendReady: true,
    backing: 'LOCAL',
    localModel: NEBULA_SHARED_LOCAL_MODEL_ID,
    optionalExternalState: 'NOT_CONFIGURED',
  })
  results.push(check(
    'entity-vs-model/provider separation in projection',
    localView.entityStatus === 'READY'
      && localView.displayName === 'AURORA'
      && localView.currentBrain === 'LOCAL_SHARED_GENERAL'
      && localView.optionalExternal?.state === 'NOT_CONFIGURED'
      && localView.optionalExternal?.name === 'OpenAI',
    JSON.stringify({ entity: localView.displayName, brain: localView.currentBrain, optional: localView.optionalExternal?.line }),
  ))

  results.push(check(
    'historical seat ids remain routing keys, not identity',
    CANONICAL_COUNCIL_SEATS.every(seat => canonicalIdentityForSeat(seat) !== seat),
    CANONICAL_COUNCIL_SEATS.map(seat => `${seat}->${canonicalIdentityForSeat(seat)}`).join('|'),
  ))

  return results
}
