/**
 * Roadmap #21 → #22 Ascension input contract.
 * Constrained specification only. Do NOT implement Ascension agents here.
 */

export const ROADMAP_22_INPUT_CONTRACT = Object.freeze({
  roadmap: 22,
  title: 'ASCENSION / AGENT DEVELOPMENT — INPUT CONTRACT FROM #21',
  status: 'NOT_STARTED',
  mustNotStartUntil: '#21 evaluation accepted by Commander',

  agentsMayExist: [
    'RESEARCH_AGENT',
    'ENGINEERING_AGENT',
    'TERRA_INTELLIGENCE_AGENT',
    'OPERATIONS_AGENT',
    'SECURITY_RED_TEAM_AGENT',
    'COUNCIL_VALIDATOR',
    'ASTRA_ORCHESTRATOR',
    'DATA_CORPUS_AGENT',
    'NAVIGATION_AGENT (Phase 12 IMPLEMENTED_BOUNDED)',
    'FUTURE_WORLD_LEARNING_AGENT (deferred)',
  ] as const,

  toolsTheyMayReach: {
    READ_BY_DEFAULT: [
      'TERRA_ORACLE (query/read evidence)',
      'SOVEREIGN_SEARCH / WEB_INTERNET (read/query)',
      'REPOSITORY (read)',
      'GIT metadata (read)',
      'MEMORY (scoped read with ownership)',
      'COUNCIL_SESSION_INTELLIGENCE (read)',
      'LOCAL_MODELS_OLLAMA (inference under routing)',
      'MODEL_PROVIDERS (under ExplicitExecutionApproval where required)',
    ],
    BOUNDED_WITH_APPROVAL: [
      'REPOSITORY write via native-builder patch policy',
      'CRAWLER approved-URL corpus write',
      'MEMORY write proposals / approved writes',
      'SHELL fixed validation commands only',
      'ASTRA mission create/execute (Commander session)',
    ],
    COMMANDER_ONLY_OR_DENIED: [
      'GIT commit/push',
      'DEPLOYMENT / production deploy',
      'PRODUCTION restart/stop',
      'FINANCIAL spend/transfer/trade/wager',
      'EMAIL send / PHONE Twilio',
      'BROWSER computer-use',
      'SQL ALTER / destructive DB',
      'SECURITY destructive ops',
      'secrets_change / external_account',
    ],
  },

  requiresApproval: [
    'Any Tier 3+ mutation',
    'Any Tier 4 action (never blanket permanent)',
    'Crawl expansion',
    'Memory durable write',
    'File modification / rollback',
    'Provider paid calls when ExplicitExecutionApproval applies',
    'ASTRA mission execute (Commander one-action)',
  ],

  cannotBeDelegated: [
    'Commander ultimate authority for governed Tier 4',
    'Self-approval / self-capability grant',
    'Production deploy',
    'Git push',
    'Financial transfer/spend/trade/wager',
    'Destructive DB alter',
    'Changing approval requirements',
  ],

  auditRequired: [
    'Every meaningful agent tool invocation',
    'Every approval grant/deny/expire',
    'Every policy deny vs technical miss classification',
    'ASTRA mission lifecycle events',
    'Memory proposal and write outcomes',
  ],

  terraMayProvide: [
    'World-state evidence with provenance/freshness/confidence',
    'Council handoff packets (origin_type TERRA)',
    'ASTRA terraSeed on Commander-created missions',
  ],

  terraMustNot: [
    'Authorize action',
    'Silently create missions',
    'Act as second Council',
  ],

  astraMayOrchestrate: [
    'Mission plan create (Commander)',
    'Council execute for planned missions',
    'Bounded constellation planning (spawn still deferred until explicit #22 decision)',
  ],

  astraMustNot: [
    'Provide substantive Council answers as a seat',
    'Claim workers spawned when constellationSpawned is false',
    'Autonomous mission create/watch loops',
  ],

  councilMayRecommend: [
    'Interpretation of Terra/Search/Memory',
    'Challenge and synthesis',
    'Investigation recommendations',
  ],

  councilMustNot: [
    'Authorize execution by recommendation alone',
    'Inherit unrestricted executor authority',
    'Approve its own escalations',
  ],

  inheritance: {
    childCapabilityMax: 'parent capability',
    childAuthorityMax: 'parent authority',
    scope: 'mission-scoped + time-bounded',
    amplification: false,
  },

  noSelfEscalation: true,

  capabilityDoesNotEqualAuthority: true,

  currentVsTargetDiscipline:
    'Never describe TARGET_ASCENSION rows as CURRENT_RUNTIME. Never grant powers merely because they are discovered.',

  /** Mandatory opening hardening gates from #21 — findings only; do not grant capability to "fix" during #21. */
  openingHardeningGates: Object.freeze([
    {
      id: 'A_dangerous_kind_route_wiring',
      requirement:
        'Wire remaining DANGEROUS_ACTION_KINDS to actual routes/tools, or document intentional parallel gates. Catalog presence ≠ enforcement.',
    },
    {
      id: 'B_council_auto_research_approval_classification',
      requirement:
        'Classify server-driven live research on research intents as POLICY_AUTO_ALLOWED vs SESSION_APPROVAL (or stricter). Recommendation ≠ authorization.',
    },
    {
      id: 'C_audit_metadata_completeness',
      requirement:
        'Extend war_room_audit_logs metadata so agent/tool/capability/policy/approval decisions are attributable.',
    },
  ] as const),
})
