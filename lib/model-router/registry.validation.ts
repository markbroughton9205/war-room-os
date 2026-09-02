import { pathToFileURL } from 'node:url'
import { FAMILY_CAPABILITY_PROFILES } from '@/lib/council/adaptive-assembly/registry'
import { ALL_PROVIDER_FAMILIES } from '@/lib/council/providerDirectCall'
import { getModelTarget, listModelTargets, WRIM_CANDIDATE_PLACEHOLDER } from './registry'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function testEveryCapabilityProfileMapsToExactlyOneTarget(): CaseResult[] {
  const targets = listModelTargets()
  return [
    check('one_target_per_capability_profile', targets.length === FAMILY_CAPABILITY_PROFILES.length, `${targets.length} vs ${FAMILY_CAPABILITY_PROFILES.length}`),
    check('no_duplicate_provider_families', new Set(targets.map(t => t.providerFamily)).size === targets.length, `${targets.length} targets`),
  ]
}

function testAllProjectedTargetsAreActiveModel(): CaseResult[] {
  const targets = listModelTargets()
  return [check('all_projected_targets_are_active_model', targets.every(t => t.tier === 'ACTIVE_MODEL'), targets.map(t => t.tier).join(','))]
}

function testDispatchabilityMatchesDirectProviderFamilyUnion(): CaseResult[] {
  const targets = listModelTargets()
  const bridgeArchitect = targets.find(t => t.providerFamily === 'bridge_architect')
  const claude = targets.find(t => t.providerFamily === 'claude')
  return [
    check('bridge_architect_honestly_not_dispatchable', bridgeArchitect?.dispatchable === false, String(bridgeArchitect?.dispatchable)),
    check('claude_is_dispatchable', claude?.dispatchable === true, String(claude?.dispatchable)),
    check(
      'dispatchable_flag_matches_direct_provider_family_union_exactly',
      targets.every(t => t.dispatchable === (ALL_PROVIDER_FAMILIES as string[]).includes(t.providerFamily)),
      targets.map(t => `${t.providerFamily}:${t.dispatchable}`).join(','),
    ),
  ]
}

function testGetModelTargetLookup(): CaseResult[] {
  return [
    check('get_model_target_finds_kimi', getModelTarget('kimi')?.providerFamily === 'kimi', String(getModelTarget('kimi'))),
    check('get_model_target_returns_null_for_unknown', getModelTarget('not_a_family') === null, String(getModelTarget('not_a_family'))),
  ]
}

function testCandidatePlaceholderNeverAppearsInLiveRegistry(): CaseResult[] {
  const targets = listModelTargets()
  return [
    check('wrim_placeholder_excluded_from_live_targets', !targets.some(t => t.providerFamily === 'wrim0'), targets.map(t => t.providerFamily).join(',')),
    check('wrim_placeholder_is_candidate_tier', WRIM_CANDIDATE_PLACEHOLDER.tier === 'CANDIDATE_MODEL', WRIM_CANDIDATE_PLACEHOLDER.tier),
    check('wrim_placeholder_not_dispatchable', WRIM_CANDIDATE_PLACEHOLDER.dispatchable === false, String(WRIM_CANDIDATE_PLACEHOLDER.dispatchable)),
  ]
}

export function runModelRouterRegistryValidation(): CaseResult[] {
  return [
    ...testEveryCapabilityProfileMapsToExactlyOneTarget(),
    ...testAllProjectedTargetsAreActiveModel(),
    ...testDispatchabilityMatchesDirectProviderFamilyUnion(),
    ...testGetModelTargetLookup(),
    ...testCandidatePlaceholderNeverAppearsInLiveRegistry(),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runModelRouterRegistryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Model Router registry validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
