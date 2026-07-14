import { readFileSync } from 'node:fs'

export type MemoryAuthorityValidationResult = {
  caseId: string
  category:
    | 'anonymous'
    | 'commander'
    | 'non_commander'
    | 'baby_chat'
    | 'council_proposal'
    | 'memory_panels'
    | 'academy'
    | 'briefing'
    | 'runtime_integrity'
    | 'canonical_status'
    | 'cleanup'
    | 'rollback'
    | 'security_definer'
    | 'ownership'
  expected: string
  observed: string
  result: 'PASS' | 'FAIL'
}

export const MEMORY_AUTHORITY_VALIDATION_MODE = 'static_architecture_validation'

type ValidationCase = {
  caseId: MemoryAuthorityValidationResult['caseId']
  category: MemoryAuthorityValidationResult['category']
  expected: string
  check: () => string | null
}

const FILES = {
  migrationA: 'supabase/war_room_phase46pe_memory_authority_a_schema.sql',
  migrationB: 'supabase/war_room_phase46pe_memory_authority_b_policies.sql',
  migrationC: 'supabase/war_room_phase46pe_memory_authority_c_tightening.sql',
  rollbackA: 'supabase/rollback/war_room_phase46pe_memory_authority_a_schema_rollback.sql',
  rollbackB: 'supabase/rollback/war_room_phase46pe_memory_authority_b_policy_rollback.sql',
  rollbackC: 'supabase/rollback/war_room_phase46pe_memory_authority_c_tightening_rollback.sql',
  babyChat: 'lib/baby-ai/privateChatRoute.ts',
  babyRoute: 'app/api/baby/chat/route.ts',
  toolsMemoryRoute: 'app/api/tools/memory/route.ts',
  legacyMemoryRoute: 'app/api/memory/route.ts',
  proposalsRoute: 'app/api/memory/proposals/route.ts',
  chatRoute: 'app/api/chat/route.ts',
  phase6Panel: 'components/war-room/memory/Phase6MemoryPanels.tsx',
  academyRoute: 'app/api/baby-ai/academy/route.ts',
  briefingRoute: 'app/api/baby-ai/briefing/route.ts',
  runtimeIntegrity: 'lib/runtime/runtimeIntegrityCollect.ts',
  canonicalStatus: 'lib/runtime/canonicalStatus.ts',
  doc: 'docs/architecture/PHASE_46P-E_MEMORY_AUTHORITY.md',
}

function file(path: keyof typeof FILES): string {
  return readFileSync(FILES[path], 'utf8')
}

function has(source: string, ...needles: string[]): boolean {
  return needles.every(needle => source.includes(needle))
}

function result(test: ValidationCase): MemoryAuthorityValidationResult {
  const observed = test.check()
  return {
    caseId: test.caseId,
    category: test.category,
    expected: test.expected,
    observed: observed ?? 'matched',
    result: observed === null ? 'PASS' : 'FAIL',
  }
}

const cases: ValidationCase[] = [
  {
    caseId: 'memory_auth_anonymous_removed',
    category: 'anonymous',
    expected: 'Migration B revokes anon access and never grants anon table access.',
    check: () => {
      const source = file('migrationB')
      return has(source, 'revoke all on table public.memories from anon;', 'revoke all on table public.war_room_memory_proposals from anon;') &&
        !/grant\s+(select|insert|update|delete|all).*to\s+anon/i.test(source)
        ? null
        : 'anonymous access removal missing or anon grant present'
    },
  },
  {
    caseId: 'memory_auth_commander_function',
    category: 'commander',
    expected: 'Commander lookup uses active authority rows.',
    check: () => has(file('migrationA'), 'war_room_current_memory_commander_user_id', "authority_role = 'commander'", "status = 'active'")
      ? null
      : 'Commander lookup function missing active Commander predicate',
  },
  {
    caseId: 'memory_auth_non_commander_blocked',
    category: 'non_commander',
    expected: 'Policies require war_room_is_memory_commander(auth.uid()).',
    check: () => has(file('migrationB'), 'public.war_room_is_memory_commander(auth.uid())')
      ? null
      : 'Commander predicate missing from authenticated policies',
  },
  {
    caseId: 'memory_auth_static_baby_chat_owner',
    category: 'baby_chat',
    expected: 'Baby Chat inserts created_by_user_id from authenticated user.',
    check: () => has(file('babyChat'), 'created_by_user_id: user.id', "ownership_authority_basis: 'authenticated_commander_session'")
      ? null
      : 'Baby Chat does not write authenticated owner metadata',
  },
  {
    caseId: 'memory_auth_static_baby_chat_env_first',
    category: 'baby_chat',
    expected: 'Baby Chat route gates live actions before handler execution.',
    check: () => {
      const source = file('babyRoute')
      const gate = source.indexOf('assertLiveActionsAllowed()')
      const handler = source.indexOf('handleBabyChatRequest(req)')
      return gate >= 0 && handler > gate ? null : 'environment gate is not before handler'
    },
  },
  {
    caseId: 'memory_auth_static_council_proposal_service_role_preserved',
    category: 'council_proposal',
    expected: 'Council proposal ingestion remains service-side and no client owner is trusted.',
    check: () => has(file('chatRoute'), 'tryPersistMemoryProposalFromModelOutput', 'sup.ok ? sup.client : null')
      ? null
      : 'Council proposal ingestion path missing',
  },
  {
    caseId: 'memory_auth_static_memory_panel_routes',
    category: 'memory_panels',
    expected: 'Phase 6 panel still uses proposal list/context/approve/reject routes.',
    check: () => has(file('phase6Panel'), '/api/memory/proposals', '/api/memory/context', '/api/memory/approve', '/api/memory/reject')
      ? null
      : 'Phase 6 memory route dependencies changed unexpectedly',
  },
  {
    caseId: 'memory_auth_static_academy_route_preserved',
    category: 'academy',
    expected: 'Academy route remains read-only snapshot path.',
    check: () => has(file('academyRoute'), 'buildBabyAiAcademySnapshot')
      ? null
      : 'Academy route no longer points at snapshot builder',
  },
  {
    caseId: 'memory_auth_static_briefing_route_preserved',
    category: 'briefing',
    expected: 'Briefing route remains read-only briefing path.',
    check: () => has(file('briefingRoute'), 'buildBabyDailyBriefing')
      ? null
      : 'Briefing route no longer points at daily briefing builder',
  },
  {
    caseId: 'memory_auth_static_runtime_integrity_probe_preserved',
    category: 'runtime_integrity',
    expected: 'Runtime integrity still probes memory proposals via service-side probe.',
    check: () => has(file('runtimeIntegrity'), "probeTable('war_room_memory_proposals', 'id')")
      ? null
      : 'runtime integrity memory probe missing',
  },
  {
    caseId: 'memory_auth_static_canonical_status_probe_preserved',
    category: 'canonical_status',
    expected: 'Canonical status still probes war_room_memory_proposals.',
    check: () => has(file('canonicalStatus'), "from('war_room_memory_proposals').select('id').limit(1)")
      ? null
      : 'canonical status memory probe missing',
  },
  {
    caseId: 'memory_auth_static_cleanup_no_residue',
    category: 'cleanup',
    expected: 'Migration C blocks tightening while ownerless rows remain.',
    check: () => has(file('migrationC'), 'missing_memory_owners', 'missing_proposal_owners', 'raise exception')
      ? null
      : 'tightening migration lacks ownerless-row precheck',
  },
  {
    caseId: 'memory_auth_static_rollback_preserves_history',
    category: 'rollback',
    expected: 'Rollback files do not drop ownership columns or authority table.',
    check: () => {
      const combined = `${file('rollbackA')}\n${file('rollbackB')}\n${file('rollbackC')}`
      return /drop\s+table\s+.*war_room_memory_authorities/i.test(combined) ||
        /drop\s+column\s+.*created_by_user_id/i.test(combined)
        ? 'rollback drops authority records or ownership history'
        : null
    },
  },
  {
    caseId: 'memory_auth_static_security_definer_shape',
    category: 'security_definer',
    expected: 'Security definer function is stable, search_path-restricted, null-safe, and has no dynamic SQL.',
    check: () => {
      const source = file('migrationB')
      const fnStart = source.indexOf('create or replace function public.war_room_is_memory_commander')
      const fnEnd = source.indexOf('comment on function public.war_room_is_memory_commander')
      const fn = fnStart >= 0 && fnEnd > fnStart ? source.slice(fnStart, fnEnd) : ''
      return has(fn, 'security definer', 'stable', 'set search_path = public, pg_temp', 'candidate_user_id is not null') &&
        !/execute\s+/i.test(fn)
        ? null
        : 'SECURITY DEFINER shape is unsafe or incomplete'
    },
  },
  {
    caseId: 'memory_auth_static_created_by_verification',
    category: 'ownership',
    expected: 'Memory write routes use authenticated session ownership metadata.',
    check: () => has(file('toolsMemoryRoute'), 'requireCommanderSession', 'created_by_user_id: commander.userId') &&
      has(file('legacyMemoryRoute'), 'requireCommanderSession', 'created_by_user_id: commander.userId') &&
      has(file('proposalsRoute'), 'created_by_user_id: commander.userId')
      ? null
      : 'one or more write routes does not derive ownership from authenticated session',
  },
  {
    caseId: 'memory_auth_static_route_commander_required',
    category: 'commander',
    expected: 'Target memory routes call requireCommanderSession.',
    check: () => has(file('toolsMemoryRoute'), 'requireCommanderSession') &&
      has(file('legacyMemoryRoute'), 'requireCommanderSession') &&
      has(file('proposalsRoute'), 'requireCommanderSession')
      ? null
      : 'one or more target memory routes does not require Commander session',
  },
  {
    caseId: 'memory_auth_static_privileged_routes_environment_gated',
    category: 'ownership',
    expected: 'Privileged memory routes call assertLiveActionsAllowed before Commander/session checks.',
    check: () => environmentGateBeforeCommander(file('toolsMemoryRoute')) &&
      environmentGateBeforeCommander(file('legacyMemoryRoute')) &&
      environmentGateBeforeCommander(file('proposalsRoute'))
      ? null
      : 'one or more privileged memory routes lacks first environment gate before Commander session',
  },
  {
    caseId: 'memory_auth_static_tools_memory_no_deprecated_alias',
    category: 'ownership',
    expected: 'Tools memory route imports admin client directly, not deprecated supabaseServer alias.',
    check: () => {
      const source = file('toolsMemoryRoute')
      return source.includes('@/lib/supabaseServer') || source.includes('lib/supabaseServer')
        ? 'deprecated supabaseServer alias still used'
        : null
    },
  },
]

export function runMemoryAuthorityValidation(): MemoryAuthorityValidationResult[] {
  return cases.map(result)
}

function environmentGateBeforeCommander(source: string): boolean {
  const gateIndex = source.indexOf('assertLiveActionsAllowed()')
  const commanderIndex = source.indexOf('requireCommanderSession(')
  return gateIndex >= 0 && commanderIndex > gateIndex
}
