import { BABY_AI_REPAIR_SQL, SIGNAL_REPAIR_SQL } from '@/lib/schema-sweep/repairSql'

export type SchemaFeatureId =
  | 'baby_ai'
  | 'signals'
  | 'revenue'
  | 'outcomes'
  | 'growth_calendar'
  | 'commander'
  | 'runtime'
  | 'council_repair'
  | 'memory'
  | 'files_evidence'
  | 'approvals'
  | 'operator_deck'
  | 'queues'
  | 'rss'
  | 'classification'
  | 'cognitive_bus'

export type ExpectedColumn = {
  name: string
  type?: string
  nullable?: boolean
}

export type ExpectedTable = {
  name: string
  feature: SchemaFeatureId
  label: string
  migrationFile: string
  columns: ExpectedColumn[]
  indexes: string[]
  constraints: string[]
  rlsRequired: boolean
  serviceRolePolicy: string | null
  exactRepairSql?: string
}

export type ExpectedMigration = {
  file: string
  feature: SchemaFeatureId
  label: string
}

const common = ['id', 'created_at']

function table(input: {
  name: string
  feature: SchemaFeatureId
  label: string
  migrationFile: string
  columns?: string[]
  indexes?: string[]
  constraints?: string[]
  policy?: string | null
  exactRepairSql?: string
}): ExpectedTable {
  return {
    name: input.name,
    feature: input.feature,
    label: input.label,
    migrationFile: input.migrationFile,
    columns: [...new Set(input.columns ?? common)].map(name => ({ name })),
    indexes: input.indexes ?? [],
    constraints: input.constraints ?? [],
    rlsRequired: true,
    serviceRolePolicy: input.policy ?? `${input.name}_service_role_all`,
    exactRepairSql: input.exactRepairSql,
  }
}

export const EXPECTED_MIGRATIONS: ExpectedMigration[] = [
  { file: 'supabase/war_room_phase3.sql', feature: 'approvals', label: 'conversations, approvals, action queue' },
  { file: 'supabase/war_room_phase3b.sql', feature: 'runtime', label: 'audit and sentinel baseline' },
  { file: 'supabase/war_room_phase4_permissions.sql', feature: 'approvals', label: 'standing permissions' },
  { file: 'supabase/war_room_phase4_events.sql', feature: 'council_repair', label: 'system event ledger' },
  { file: 'supabase/war_room_phase6_memory.sql', feature: 'memory', label: 'memory proposals and approved memories' },
  { file: 'supabase/war_room_phase7d_memory_archive.sql', feature: 'memory', label: 'memory archive' },
  { file: 'supabase/war_room_phase11_baby_ai.sql', feature: 'baby_ai', label: 'Baby AI durable memory' },
  { file: 'supabase/war_room_phase13_revenue_engine.sql', feature: 'revenue', label: 'revenue engine' },
  { file: 'supabase/war_room_phase14_signals.sql', feature: 'signals', label: 'signal radar' },
  { file: 'supabase/war_room_phase15_growth_calendar.sql', feature: 'growth_calendar', label: 'growth calendar' },
  { file: 'supabase/war_room_phase15_outcomes_roi.sql', feature: 'outcomes', label: 'outcome and ROI ledger' },
  { file: 'supabase/war_room_phase16_commander_os.sql', feature: 'commander', label: 'Commander OS' },
  { file: 'supabase/war_room_phase18_runtime_reliability.sql', feature: 'runtime', label: 'runtime provider snapshots' },
  { file: 'supabase/war_room_runtime_state.sql', feature: 'runtime', label: 'runtime state' },
  { file: 'supabase/war_room_runtime_integrity_logs.sql', feature: 'runtime', label: 'runtime integrity logs' },
  { file: 'supabase/files.sql', feature: 'files_evidence', label: 'files and evidence' },
  { file: 'supabase/war_room_orchestration_queue.sql', feature: 'queues', label: 'orchestration queue' },
  { file: 'supabase/war_room_phase24_operator_deck.sql', feature: 'operator_deck', label: 'operator command deck' },
  { file: 'supabase/war_room_phase25_queue_intelligence.sql', feature: 'queues', label: 'operator priority queue' },
  { file: 'supabase/war_room_phase28_rss_ingestion.sql', feature: 'rss', label: 'RSS ingestion diagnostics' },
  { file: 'supabase/war_room_phase29_signal_classification.sql', feature: 'classification', label: 'signal classification layer' },
  { file: 'supabase/war_room_phase30_cognitive_bus.sql', feature: 'cognitive_bus', label: 'cognitive bus thread state' },
  { file: 'supabase/war_room_phase31_schema_introspect.sql', feature: 'runtime', label: 'schema sweep catalog RPC (optional)' },
]

export const EXPECTED_TABLES: ExpectedTable[] = [
  table({ name: 'war_room_conversations', feature: 'approvals', label: 'Conversation persistence', migrationFile: 'supabase/war_room_phase3.sql', columns: ['id', 'title', 'created_at', 'updated_at', 'deleted_at'], indexes: ['war_room_conversations_updated_at_idx'] }),
  table({ name: 'war_room_messages', feature: 'approvals', label: 'Message ledger', migrationFile: 'supabase/war_room_phase3.sql', columns: ['id', 'conversation_id', 'role', 'content', 'created_at'], indexes: ['war_room_messages_conversation_created_idx'] }),
  table({ name: 'war_room_actions', feature: 'approvals', label: 'Approval action queue', migrationFile: 'supabase/war_room_phase3.sql', columns: ['id', 'conversation_id', 'type', 'status', 'payload', 'approval_granted', 'created_at'], indexes: ['war_room_actions_status_idx', 'war_room_actions_conversation_idx'] }),
  table({ name: 'war_room_action_logs', feature: 'approvals', label: 'Action logs', migrationFile: 'supabase/war_room_phase3.sql', columns: ['id', 'action_id', 'event', 'created_at'], indexes: ['war_room_action_logs_action_created_idx'] }),
  table({ name: 'war_room_audit_logs', feature: 'approvals', label: 'Audit logs', migrationFile: 'supabase/war_room_phase3b.sql', columns: ['id', 'category', 'action', 'metadata', 'created_at'], indexes: ['war_room_audit_logs_created_idx'] }),
  table({ name: 'war_room_permissions_state', feature: 'approvals', label: 'Standing permissions', migrationFile: 'supabase/war_room_phase4_permissions.sql', columns: ['id', 'updated_at'] }),
  table({ name: 'war_room_events', feature: 'council_repair', label: 'System event ledger', migrationFile: 'supabase/war_room_phase4_events.sql', columns: ['id', 'type', 'payload', 'source', 'created_at'] }),

  table({ name: 'war_room_memory_proposals', feature: 'memory', label: 'Memory proposals', migrationFile: 'supabase/war_room_phase6_memory.sql', columns: ['id', 'title', 'content', 'status', 'created_at'] }),
  table({ name: 'war_room_approved_memories', feature: 'memory', label: 'Approved memories', migrationFile: 'supabase/war_room_phase6_memory.sql', columns: ['id', 'title', 'content', 'created_at'] }),
  table({ name: 'war_room_archived_transcripts', feature: 'memory', label: 'Archived transcripts', migrationFile: 'supabase/war_room_phase7d_memory_archive.sql', columns: ['id', 'session_id', 'content', 'created_at'], indexes: ['war_room_archived_transcripts_session_idx'] }),
  table({ name: 'war_room_session_summaries', feature: 'memory', label: 'Session summaries', migrationFile: 'supabase/war_room_phase7d_memory_archive.sql', columns: ['id', 'session_id', 'summary', 'created_at'], indexes: ['war_room_session_summaries_session_idx'] }),
  table({ name: 'war_room_strategic_memories', feature: 'memory', label: 'Strategic memories', migrationFile: 'supabase/war_room_phase7d_memory_archive.sql', columns: ['id', 'topic', 'content', 'created_at'], indexes: ['war_room_strategic_memories_topic_idx'] }),

  table({ name: 'war_room_baby_agents', feature: 'baby_ai', label: 'Baby AI agents', migrationFile: 'supabase/war_room_phase11_baby_ai.sql', columns: ['id', 'agent_key', 'display_name', 'family_identity', 'role', 'lifecycle_state', 'growth_level', 'memory_scope', 'skill_tree', 'confidence_score', 'usefulness_score', 'created_at', 'updated_at'], indexes: ['war_room_baby_agents_key_idx'], exactRepairSql: BABY_AI_REPAIR_SQL }),
  table({ name: 'war_room_baby_agent_memories', feature: 'baby_ai', label: 'Baby AI memories', migrationFile: 'supabase/war_room_phase11_baby_ai.sql', columns: ['id', 'baby_agent_id', 'memory_scope', 'source_type', 'lesson', 'lesson_state', 'evidence', 'validation_count', 'created_at', 'updated_at'], indexes: ['war_room_baby_memories_agent_idx', 'war_room_baby_memories_state_idx'], exactRepairSql: BABY_AI_REPAIR_SQL }),
  table({ name: 'war_room_baby_agent_training_events', feature: 'baby_ai', label: 'Baby AI training events', migrationFile: 'supabase/war_room_phase11_baby_ai.sql', columns: ['id', 'baby_agent_id', 'source_type', 'event_kind', 'summary', 'approval_state', 'created_at'], indexes: ['war_room_baby_training_agent_idx'], exactRepairSql: BABY_AI_REPAIR_SQL }),
  table({ name: 'war_room_baby_agent_skill_growth', feature: 'baby_ai', label: 'Baby AI skill growth', migrationFile: 'supabase/war_room_phase11_baby_ai.sql', columns: ['id', 'baby_agent_id', 'skill_key', 'skill_label', 'progress', 'growth_level', 'created_at', 'updated_at'], indexes: ['war_room_baby_skill_agent_idx'], exactRepairSql: BABY_AI_REPAIR_SQL }),
  table({ name: 'war_room_baby_agent_outcomes', feature: 'baby_ai', label: 'Baby AI outcomes', migrationFile: 'supabase/war_room_phase11_baby_ai.sql', columns: ['id', 'baby_agent_id', 'outcome_type', 'result_summary', 'validated', 'validation_count', 'created_at'], indexes: ['war_room_baby_outcomes_agent_idx'], exactRepairSql: BABY_AI_REPAIR_SQL }),

  table({
    name: 'war_room_signal_sources',
    feature: 'signals',
    label: 'Signal sources',
    migrationFile: 'supabase/war_room_phase14_signals.sql',
    columns: ['id', 'label', 'provider', 'kind', 'categories', 'configured', 'reliability_score', 'notes', 'created_at', 'updated_at', 'enabled', 'poll_interval_minutes', 'last_poll_at', 'last_success_at', 'last_error_at', 'last_item_count', 'stale_feed_detection', 'last_error_message'],
    indexes: ['war_room_signal_sources_provider_idx', 'war_room_signal_sources_rss_poll_idx'],
    exactRepairSql: SIGNAL_REPAIR_SQL,
  }),
  table({ name: 'war_room_signal_scans', feature: 'signals', label: 'Signal scans', migrationFile: 'supabase/war_room_phase14_signals.sql', columns: ['id', 'status', 'started_at', 'completed_at', 'source_count', 'result_count', 'provider_diagnostics', 'created_at'], indexes: ['war_room_signal_scans_completed_idx'], exactRepairSql: SIGNAL_REPAIR_SQL }),
  table({
    name: 'war_room_signal_results',
    feature: 'signals',
    label: 'Signal results',
    migrationFile: 'supabase/war_room_phase14_signals.sql',
    columns: ['id', 'scan_id', 'title', 'source', 'provider', 'source_kind', 'url', 'summary', 'category', 'highest_leverage_score', 'approval_status', 'captured_at', 'metadata', 'created_at', 'updated_at', 'intelligence_category', 'operational_class', 'intelligence_severity', 'classification_confidence'],
    indexes: ['war_room_signal_results_leverage_idx', 'war_room_signal_results_operational_class_idx'],
    constraints: ['war_room_signal_results_operational_class_check', 'war_room_signal_results_intelligence_severity_check'],
    exactRepairSql: SIGNAL_REPAIR_SQL,
  }),
  table({ name: 'war_room_signal_scores', feature: 'signals', label: 'Signal scores', migrationFile: 'supabase/war_room_phase14_signals.sql', columns: ['id', 'result_id', 'scan_id', 'category', 'highest_leverage_score', 'approval_required', 'can_execute', 'created_at'], indexes: ['war_room_signal_scores_result_idx'], exactRepairSql: SIGNAL_REPAIR_SQL }),
  table({ name: 'war_room_signal_alerts', feature: 'signals', label: 'Signal alerts', migrationFile: 'supabase/war_room_phase14_signals.sql', columns: ['id', 'scan_id', 'severity', 'title', 'summary', 'source_attribution', 'approval_required', 'can_execute', 'created_at'], indexes: ['war_room_signal_alerts_scan_idx'], exactRepairSql: SIGNAL_REPAIR_SQL }),

  table({ name: 'war_room_revenue_opportunities', feature: 'revenue', label: 'Revenue opportunities', migrationFile: 'supabase/war_room_phase13_revenue_engine.sql', columns: ['id', 'title', 'category', 'status', 'source', 'leverage_score', 'approval_required', 'metadata', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_revenue_outcomes', feature: 'revenue', label: 'Revenue outcomes', migrationFile: 'supabase/war_room_phase13_revenue_engine.sql', columns: ['id', 'opportunity_id', 'outcome_type', 'summary', 'validated', 'evidence', 'created_at'] }),
  table({ name: 'war_room_leverage_scores', feature: 'revenue', label: 'Leverage scores', migrationFile: 'supabase/war_room_phase13_revenue_engine.sql', columns: ['id', 'opportunity_id', 'category', 'leverage_score', 'approval_required', 'can_execute', 'created_at'] }),
  table({ name: 'war_room_execution_patterns', feature: 'revenue', label: 'Execution patterns', migrationFile: 'supabase/war_room_phase13_revenue_engine.sql', columns: ['id', 'category', 'pattern_type', 'title', 'summary', 'approval_required', 'can_execute', 'created_at', 'updated_at'] }),

  table({ name: 'war_room_outcomes', feature: 'outcomes', label: 'Outcome ledger', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'title', 'category', 'result_status', 'recommended_repeat_avoid', 'evidence', 'metadata', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_roi_reviews', feature: 'outcomes', label: 'ROI reviews', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'outcome_id', 'reviewer', 'review_summary', 'approval_required', 'can_execute', 'created_at'] }),
  table({ name: 'war_room_execution_results', feature: 'outcomes', label: 'Execution results', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'outcome_id', 'category', 'shipped', 'made_money', 'created_at'] }),
  table({ name: 'war_room_compounding_patterns', feature: 'outcomes', label: 'Compounding patterns', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'category', 'title', 'summary', 'confidence', 'approval_required', 'can_execute', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_failure_patterns', feature: 'outcomes', label: 'Failure patterns', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'category', 'title', 'summary', 'confidence', 'approval_required', 'can_execute', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_time_waste_patterns', feature: 'outcomes', label: 'Time waste patterns', migrationFile: 'supabase/war_room_phase15_outcomes_roi.sql', columns: ['id', 'category', 'title', 'summary', 'approval_required', 'can_execute', 'created_at', 'updated_at'] }),

  table({ name: 'war_room_growth_calendar_recommendations', feature: 'growth_calendar', label: 'Growth calendar recommendations', migrationFile: 'supabase/war_room_phase15_growth_calendar.sql', columns: ['id', 'title', 'event_type', 'status', 'source', 'leverage_score', 'assigned_family', 'approval_required', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_growth_calendar_events', feature: 'growth_calendar', label: 'Growth calendar events', migrationFile: 'supabase/war_room_phase15_growth_calendar.sql', columns: ['id', 'recommendation_id', 'title', 'event_type', 'status', 'approved_by_commander', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_growth_calendar_reviews', feature: 'growth_calendar', label: 'Growth calendar reviews', migrationFile: 'supabase/war_room_phase15_growth_calendar.sql', columns: ['id', 'recommendation_id', 'event_id', 'review_type', 'summary', 'approval_required', 'can_execute', 'created_at'] }),
  table({ name: 'war_room_growth_calendar_outcomes', feature: 'growth_calendar', label: 'Growth calendar outcomes', migrationFile: 'supabase/war_room_phase15_growth_calendar.sql', columns: ['id', 'event_id', 'recommendation_id', 'outcome_type', 'summary', 'validated', 'evidence', 'created_at'] }),

  table({ name: 'war_room_commander_profile', feature: 'commander', label: 'Commander profile', migrationFile: 'supabase/war_room_phase16_commander_os.sql', columns: ['id', 'active_goals', 'stress_load_score', 'family_impact_score', 'approval_required', 'can_execute', 'evidence', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_commander_metrics', feature: 'commander', label: 'Commander metrics', migrationFile: 'supabase/war_room_phase16_commander_os.sql', columns: ['id', 'leverage_score', 'execution_score', 'momentum_score', 'source_summary', 'evidence', 'generated_at', 'created_at'] }),
  table({ name: 'war_room_commander_patterns', feature: 'commander', label: 'Commander patterns', migrationFile: 'supabase/war_room_phase16_commander_os.sql', columns: ['id', 'kind', 'title', 'summary', 'score', 'severity', 'source', 'created_at', 'updated_at'] }),
  table({ name: 'war_room_commander_reviews', feature: 'commander', label: 'Commander reviews', migrationFile: 'supabase/war_room_phase16_commander_os.sql', columns: ['id', 'period', 'summary', 'approval_required', 'can_execute', 'evidence', 'created_at'] }),
  table({ name: 'war_room_commander_trajectory', feature: 'commander', label: 'Commander trajectory', migrationFile: 'supabase/war_room_phase16_commander_os.sql', columns: ['id', 'period', 'direction', 'leverage_score', 'execution_score', 'summary', 'approval_required', 'can_execute', 'created_at'] }),

  table({ name: 'war_room_runtime_state', feature: 'runtime', label: 'Runtime state', migrationFile: 'supabase/war_room_runtime_state.sql', columns: ['id', 'scope', 'key', 'value', 'created_at', 'updated_at', 'expires_at'], indexes: ['war_room_runtime_state_scope_idx'] }),
  table({ name: 'war_room_provider_snapshots', feature: 'runtime', label: 'Provider snapshots', migrationFile: 'supabase/war_room_phase18_runtime_reliability.sql', columns: ['id', 'provider_id', 'health', 'created_at'] }),
  table({ name: 'war_room_runtime_events', feature: 'runtime', label: 'Runtime events', migrationFile: 'supabase/war_room_phase18_runtime_reliability.sql', columns: ['id', 'event_type', 'payload', 'created_at'] }),
  table({ name: 'war_room_runtime_dependencies', feature: 'runtime', label: 'Runtime dependencies', migrationFile: 'supabase/war_room_phase18_runtime_reliability.sql', columns: ['id', 'source_id', 'target_id', 'created_at'] }),
  table({ name: 'war_room_runtime_failures', feature: 'runtime', label: 'Runtime failures', migrationFile: 'supabase/war_room_phase18_runtime_reliability.sql', columns: ['id', 'system_id', 'reason', 'created_at'] }),
  table({ name: 'war_room_runtime_integrity_logs', feature: 'runtime', label: 'Runtime integrity logs', migrationFile: 'supabase/war_room_runtime_integrity_logs.sql', columns: ['id', 'subsystem', 'status', 'payload', 'created_at'] }),

  table({ name: 'war_room_files', feature: 'files_evidence', label: 'Files and evidence', migrationFile: 'supabase/files.sql', columns: ['id', 'file_name', 'file_type', 'mime_type', 'size_bytes', 'storage_path', 'source_context', 'uploaded_at', 'tags', 'status', 'notes'], indexes: ['war_room_files_uploaded_at_idx'] }),

  table({ name: 'war_room_orchestration_queue', feature: 'queues', label: 'Orchestration queue', migrationFile: 'supabase/war_room_orchestration_queue.sql', columns: ['id', 'type', 'status', 'payload', 'priority', 'created_at', 'updated_at', 'claimed_at', 'completed_at', 'error'], indexes: ['war_room_orchestration_queue_status_created_idx', 'war_room_orchestration_queue_type_created_idx'] }),
  table({ name: 'operator_priority_queue', feature: 'queues', label: 'Operator priority queue', migrationFile: 'supabase/war_room_phase25_queue_intelligence.sql', columns: ['id', 'queue_type', 'title', 'translated_title', 'description', 'source_type', 'severity', 'confidence', 'priority_score', 'created_at'], constraints: ['operator_priority_queue_type_check'] }),

  table({ name: 'war_room_operator_actions', feature: 'operator_deck', label: 'Operator actions', migrationFile: 'supabase/war_room_phase24_operator_deck.sql', columns: ['id', 'title', 'linked_mission', 'source', 'confidence', 'approval_state', 'status', 'truth_label', 'human_approval_required', 'created_at', 'updated_at'], constraints: ['war_room_operator_actions_source_check', 'war_room_operator_actions_status_check'] }),
  table({ name: 'war_room_operator_earnings', feature: 'operator_deck', label: 'Operator earnings', migrationFile: 'supabase/war_room_phase24_operator_deck.sql', columns: ['id', 'title', 'mission_id', 'amount_earned', 'time_spent_minutes', 'truth_label', 'commander_confirmed', 'created_at'] }),
  table({ name: 'war_room_operator_missions', feature: 'operator_deck', label: 'Operator missions overlay', migrationFile: 'supabase/war_room_phase24_operator_deck.sql', columns: ['mission_id', 'key_metric', 'progress', 'momentum', 'truth_label', 'updated_at'] }),
  table({ name: 'war_room_operator_packets', feature: 'operator_deck', label: 'Operator packets', migrationFile: 'supabase/war_room_phase24_operator_deck.sql', columns: ['id', 'title', 'packet_type', 'status', 'body', 'truth_label', 'created_at'] }),
  table({ name: 'war_room_operator_activity', feature: 'operator_deck', label: 'Operator activity', migrationFile: 'supabase/war_room_phase24_operator_deck.sql', columns: ['id', 'activity_type', 'summary', 'truth_label', 'created_at'] }),

  table({
    name: 'war_room_council_thread_events',
    feature: 'cognitive_bus',
    label: 'Council thread events',
    migrationFile: 'supabase/war_room_phase30_cognitive_bus.sql',
    columns: ['id', 'thread_id', 'event_type', 'payload', 'correlation_id', 'created_at'],
    indexes: ['war_room_council_thread_events_thread_created_idx'],
  }),
  table({
    name: 'war_room_council_thread_state',
    feature: 'cognitive_bus',
    label: 'Council thread state',
    migrationFile: 'supabase/war_room_phase30_cognitive_bus.sql',
    columns: ['thread_id', 'phase', 'correlation_id', 'operator_packet', 'inherited_context', 'updated_at'],
    constraints: ['war_room_council_thread_state_phase_check'],
  }),
]

export const CONNECTED_SCHEMA_SURFACES = [
  'Runtime Integrity',
  'Baby AI Observer',
  'Memory tab',
  'Signal Radar',
  'Engineering Lane',
  'Operator Command Deck',
  'Cognitive Bus',
  'Repair Packet system',
]

export const SCHEMA_SWEEP_GUARDRAILS = [
  'Read-only API routes diagnose schema drift and prepare manual SQL only.',
  'The browser never receives service-role secrets and never executes database mutations.',
  'No destructive SQL is included except manual rollback notes.',
  'Repair state remains advisory until validation queries confirm the schema.',
  'Permission and catalog gaps are reported as unavailable, not as repaired.',
]

export const SCHEMA_VALIDATION_CHECKLIST = [
  'Apply reviewed SQL in Supabase SQL editor or through a migration file.',
  'Run validation queries from the repair packet.',
  'Reload PostgREST schema cache with pg_notify when additive DDL is applied.',
  'Refresh Schema Sweep and confirm no missing table/column issues remain.',
  'Verify connected surfaces: Runtime Integrity, Baby AI, Memory, Signal Radar, Engineering Lane, and Operator Deck.',
]
