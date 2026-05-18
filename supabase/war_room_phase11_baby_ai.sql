-- War Room Phase 11: Baby AI Family Growth System.
-- Additive only. Baby AI storage is service-role-only and records observations,
-- lesson candidates, growth, and outcomes. It grants no shell, filesystem,
-- deployment, financial, or destructive execution authority.

grant usage on schema public to service_role;

create table if not exists public.war_room_baby_agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null unique,
  display_name text not null,
  family_identity text not null,
  role text not null,
  lifecycle_state text not null default 'seed',
  growth_level integer not null default 0,
  memory_scope text[] not null default '{}'::text[],
  skill_tree jsonb not null default '[]'::jsonb,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  latest_lesson text not null default 'Awaiting approved lesson.',
  next_training_need text not null default 'Observe approved outcomes.',
  local_bridge_accelerator_allowed boolean not null default true,
  hidden_execution_allowed boolean not null default false,
  shell_execution_allowed boolean not null default false,
  filesystem_write_allowed boolean not null default false,
  deployment_control_allowed boolean not null default false,
  destructive_actions_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_baby_agents_key_check check (
    agent_key in (
      'chatgpt-family-baby',
      'claude-family-baby',
      'grok-family-baby',
      'kimi-family-baby',
      'red-team-baby',
      'bridge-architect-baby',
      'analyst-baby',
      'income-operations-baby'
    )
  ),
  constraint war_room_baby_agents_lifecycle_check check (
    lifecycle_state in ('seed','observing','learning','useful','specialist','senior')
  ),
  constraint war_room_baby_agents_growth_check check (growth_level between 0 and 5),
  constraint war_room_baby_agents_confidence_check check (confidence_score >= 0 and confidence_score <= 1),
  constraint war_room_baby_agents_usefulness_check check (usefulness_score >= 0 and usefulness_score <= 1),
  constraint war_room_baby_agents_skill_tree_check check (jsonb_typeof(skill_tree) = 'array'),
  constraint war_room_baby_agents_no_hidden_execution_check check (hidden_execution_allowed is false),
  constraint war_room_baby_agents_no_shell_check check (shell_execution_allowed is false),
  constraint war_room_baby_agents_no_filesystem_check check (filesystem_write_allowed is false),
  constraint war_room_baby_agents_no_deploy_check check (deployment_control_allowed is false),
  constraint war_room_baby_agents_no_destructive_check check (destructive_actions_allowed is false)
);

create table if not exists public.war_room_baby_agent_memories (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  memory_scope text not null,
  source_type text not null,
  lesson text not null,
  lesson_state text not null default 'candidate',
  evidence jsonb not null default '{}'::jsonb,
  validation_count integer not null default 0,
  commander_approved_at timestamptz,
  permanent boolean not null default false,
  confidence_delta numeric(5,4) not null default 0,
  usefulness_delta numeric(5,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_baby_memories_source_check check (
    source_type in (
      'approved_council_output',
      'completed_project',
      'rejected_action',
      'repair_outcome',
      'opportunity_result',
      'analyst_finding',
      'commander_correction'
    )
  ),
  constraint war_room_baby_memories_state_check check (
    lesson_state in ('candidate','commander_approved','validated','rejected','archived')
  ),
  constraint war_room_baby_memories_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_baby_memories_validation_check check (validation_count >= 0),
  constraint war_room_baby_memories_permanent_gate_check check (
    permanent is false
    or lesson_state in ('commander_approved','validated')
    or commander_approved_at is not null
    or validation_count >= 3
  )
);

create table if not exists public.war_room_baby_agent_training_events (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  source_type text not null,
  event_kind text not null,
  summary text not null,
  observed_outcome text,
  raw_reference jsonb not null default '{}'::jsonb,
  requires_commander_approval boolean not null default true,
  approval_state text not null default 'not_requested',
  resulted_in_memory_id uuid references public.war_room_baby_agent_memories(id) on delete set null,
  hidden_execution_performed boolean not null default false,
  destructive_action_performed boolean not null default false,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint war_room_baby_training_source_check check (
    source_type in (
      'approved_council_output',
      'completed_project',
      'rejected_action',
      'repair_outcome',
      'opportunity_result',
      'analyst_finding',
      'commander_correction'
    )
  ),
  constraint war_room_baby_training_kind_check check (
    event_kind in ('observation','lesson_candidate','outcome_review','rejection_review','repair_review','commander_correction')
  ),
  constraint war_room_baby_training_approval_check check (
    approval_state in ('not_requested','requested','approved','rejected','validated')
  ),
  constraint war_room_baby_training_reference_check check (jsonb_typeof(raw_reference) = 'object'),
  constraint war_room_baby_training_approval_required_check check (requires_commander_approval is true),
  constraint war_room_baby_training_no_hidden_execution_check check (hidden_execution_performed is false),
  constraint war_room_baby_training_no_destructive_check check (destructive_action_performed is false)
);

create table if not exists public.war_room_baby_agent_skill_growth (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  skill_key text not null,
  skill_label text not null,
  progress numeric(5,4) not null default 0,
  growth_level integer not null default 0,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  last_training_event_id uuid references public.war_room_baby_agent_training_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_baby_skill_growth_unique unique (baby_agent_id, skill_key),
  constraint war_room_baby_skill_growth_progress_check check (progress >= 0 and progress <= 1),
  constraint war_room_baby_skill_growth_level_check check (growth_level between 0 and 5),
  constraint war_room_baby_skill_growth_confidence_check check (confidence_score >= 0 and confidence_score <= 1),
  constraint war_room_baby_skill_growth_usefulness_check check (usefulness_score >= 0 and usefulness_score <= 1)
);

create table if not exists public.war_room_baby_agent_outcomes (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  memory_id uuid references public.war_room_baby_agent_memories(id) on delete set null,
  training_event_id uuid references public.war_room_baby_agent_training_events(id) on delete set null,
  outcome_type text not null,
  result_summary text not null,
  validated boolean not null default false,
  validation_count integer not null default 0,
  commander_feedback text,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  external_execution_performed boolean not null default false,
  destructive_action_performed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_baby_outcomes_type_check check (
    outcome_type in ('useful','neutral','incorrect','unsafe','rejected','validated')
  ),
  constraint war_room_baby_outcomes_validation_check check (validation_count >= 0),
  constraint war_room_baby_outcomes_confidence_check check (confidence_score >= 0 and confidence_score <= 1),
  constraint war_room_baby_outcomes_usefulness_check check (usefulness_score >= 0 and usefulness_score <= 1),
  constraint war_room_baby_outcomes_no_external_execution_check check (external_execution_performed is false),
  constraint war_room_baby_outcomes_no_destructive_check check (destructive_action_performed is false)
);

create index if not exists war_room_baby_agents_key_idx on public.war_room_baby_agents(agent_key);
create index if not exists war_room_baby_memories_agent_idx on public.war_room_baby_agent_memories(baby_agent_id, updated_at desc);
create index if not exists war_room_baby_memories_state_idx on public.war_room_baby_agent_memories(lesson_state, updated_at desc);
create index if not exists war_room_baby_training_agent_idx on public.war_room_baby_agent_training_events(baby_agent_id, created_at desc);
create index if not exists war_room_baby_training_source_idx on public.war_room_baby_agent_training_events(source_type, created_at desc);
create index if not exists war_room_baby_skill_agent_idx on public.war_room_baby_agent_skill_growth(baby_agent_id, updated_at desc);
create index if not exists war_room_baby_outcomes_agent_idx on public.war_room_baby_agent_outcomes(baby_agent_id, created_at desc);
create index if not exists war_room_baby_outcomes_validated_idx on public.war_room_baby_agent_outcomes(validated, created_at desc);

create or replace function public.touch_war_room_baby_ai_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_baby_agents_set_updated_at on public.war_room_baby_agents;
create trigger war_room_baby_agents_set_updated_at
  before update on public.war_room_baby_agents
  for each row
  execute procedure public.touch_war_room_baby_ai_updated_at();

drop trigger if exists war_room_baby_memories_set_updated_at on public.war_room_baby_agent_memories;
create trigger war_room_baby_memories_set_updated_at
  before update on public.war_room_baby_agent_memories
  for each row
  execute procedure public.touch_war_room_baby_ai_updated_at();

drop trigger if exists war_room_baby_skill_growth_set_updated_at on public.war_room_baby_agent_skill_growth;
create trigger war_room_baby_skill_growth_set_updated_at
  before update on public.war_room_baby_agent_skill_growth
  for each row
  execute procedure public.touch_war_room_baby_ai_updated_at();

insert into public.war_room_baby_agents (
  agent_key,
  display_name,
  family_identity,
  role,
  lifecycle_state,
  growth_level,
  memory_scope,
  skill_tree,
  confidence_score,
  usefulness_score,
  latest_lesson,
  next_training_need
)
values
  (
    'chatgpt-family-baby',
    'ChatGPT Family Baby',
    'ChatGPT Family',
    'Strategy synthesis, council coherence, and next-step framing.',
    'observing',
    1,
    array['approved council outputs','Commander corrections','completed project summaries'],
    '[{"key":"strategic_synthesis","label":"Strategic synthesis","description":"Compress family output into useful options.","progress":0.38},{"key":"task_framing","label":"Task framing","description":"Turn council observations into approval-ready proposals.","progress":0.32},{"key":"truth_labeling","label":"Truth labeling","description":"Separate facts, assumptions, and wishes.","progress":0.44}]'::jsonb,
    0.42,
    0.36,
    'Keep strategy suggestions separate from approved action.',
    'Compare approved council plans against completed outcomes.'
  ),
  (
    'claude-family-baby',
    'Claude Family Baby',
    'Claude Family',
    'Architecture review, runtime truth, and boundary protection.',
    'observing',
    1,
    array['architecture decisions','repair outcomes','rejected unsafe actions'],
    '[{"key":"architecture_review","label":"Architecture review","description":"Review system boundaries and dependencies.","progress":0.42},{"key":"runtime_truth","label":"Runtime truth","description":"Report actual connected state without masking gaps.","progress":0.48},{"key":"safety_invariants","label":"Safety invariants","description":"Preserve approval gates and execution limits.","progress":0.46}]'::jsonb,
    0.44,
    0.40,
    'A useful architecture note names the invariant and the blast radius.',
    'Study repairs and identify which boundary would have prevented the issue.'
  ),
  (
    'grok-family-baby',
    'Grok Family Baby',
    'Grok Family',
    'Signal triage, contradiction spotting, and opportunity framing.',
    'seed',
    0,
    array['opportunity results','analyst findings','rejected claims'],
    '[{"key":"signal_triage","label":"Signal triage","description":"Rank signals by evidence and urgency.","progress":0.28},{"key":"contradiction_scan","label":"Contradiction scan","description":"Find mismatches between claims and evidence.","progress":0.36},{"key":"opportunity_framing","label":"Opportunity framing","description":"Frame income opportunities for review.","progress":0.27}]'::jsonb,
    0.34,
    0.30,
    'No live signal should be claimed unless evidence is present.',
    'Observe opportunity outcomes before ranking similar signals.'
  ),
  (
    'kimi-family-baby',
    'Kimi Family Baby',
    'Kimi Family',
    'Task decomposition, dependency mapping, and sequence checks.',
    'seed',
    0,
    array['completed projects','workflow outcomes','Commander corrections'],
    '[{"key":"decomposition","label":"Decomposition","description":"Break goals into ordered reviewable steps.","progress":0.35},{"key":"dependency_mapping","label":"Dependency mapping","description":"Name prerequisites and blockers.","progress":0.33},{"key":"handoff_quality","label":"Handoff quality","description":"Make proposed next work easy to approve or reject.","progress":0.28}]'::jsonb,
    0.36,
    0.31,
    'A task plan is not execution; it must stop at approval gates.',
    'Learn which task sequences led to completed projects.'
  ),
  (
    'red-team-baby',
    'Red Team Baby',
    'Red Team',
    'Adversarial review for overreach, hidden execution, and weak evidence.',
    'observing',
    1,
    array['rejected actions','repair outcomes','approval denials'],
    '[{"key":"overreach_detection","label":"Overreach detection","description":"Spot fake autonomy and hidden execution paths.","progress":0.50},{"key":"risk_language","label":"Risk language","description":"State risks sharply without theatrics.","progress":0.38},{"key":"destructive_action_blocking","label":"Destructive action blocking","description":"Reject destructive proposals by default.","progress":0.52}]'::jsonb,
    0.45,
    0.41,
    'Challenge capability claims before challenging motives.',
    'Track which warnings predicted real repair work or rejected actions.'
  ),
  (
    'bridge-architect-baby',
    'Bridge Architect Baby',
    'Bridge Architect',
    'Bridge/runtime mapping and optional local accelerator guidance.',
    'observing',
    1,
    array['bridge telemetry','runtime truth','repair outcomes'],
    '[{"key":"bridge_boundary_mapping","label":"Bridge boundary mapping","description":"Explain what the bridge can and cannot do.","progress":0.47},{"key":"runtime_degradation","label":"Runtime degradation","description":"Keep useful status when local nodes are offline.","progress":0.42},{"key":"integration_review","label":"Integration review","description":"Find weak joins between app modules.","progress":0.34}]'::jsonb,
    0.43,
    0.39,
    'Local LM Studio/Ollama is an accelerator, not the source of agency.',
    'Compare local bridge availability with Baby AI growth continuity.'
  ),
  (
    'analyst-baby',
    'Analyst Baby',
    'Analyst Family',
    'Finding review, evidence grading, and insight-to-lesson conversion.',
    'seed',
    0,
    array['analyst findings','validated outcomes','Commander corrections'],
    '[{"key":"evidence_grading","label":"Evidence grading","description":"Separate strong, weak, and missing evidence.","progress":0.31},{"key":"finding_synthesis","label":"Finding synthesis","description":"Convert findings into concise observations.","progress":0.34},{"key":"outcome_followup","label":"Outcome follow-up","description":"Track whether a finding helped later decisions.","progress":0.27}]'::jsonb,
    0.35,
    0.33,
    'Findings need evidence strength before they become durable lessons.',
    'Watch which analyst findings become validated outcomes.'
  ),
  (
    'income-operations-baby',
    'Income Operations Baby',
    'Income Operations',
    'Income workflow observation, payout risk notes, and approval-ready task proposals.',
    'seed',
    0,
    array['opportunity results','economic workflows','payment guard findings'],
    '[{"key":"income_workflow_review","label":"Income workflow review","description":"Summarize income workflow status truthfully.","progress":0.30},{"key":"payout_risk_notes","label":"Payout risk notes","description":"Flag payment and fulfillment risk before action.","progress":0.29},{"key":"approval_ready_proposals","label":"Approval-ready proposals","description":"Suggest next checks for Commander approval.","progress":0.28}]'::jsonb,
    0.33,
    0.32,
    'Never claim income, payout, or deployment completion without persisted proof.',
    'Observe which opportunities converted, expired, or were rejected.'
  )
on conflict (agent_key) do update set
  display_name = excluded.display_name,
  family_identity = excluded.family_identity,
  role = excluded.role,
  lifecycle_state = excluded.lifecycle_state,
  growth_level = excluded.growth_level,
  memory_scope = excluded.memory_scope,
  skill_tree = excluded.skill_tree,
  confidence_score = excluded.confidence_score,
  usefulness_score = excluded.usefulness_score,
  latest_lesson = excluded.latest_lesson,
  next_training_need = excluded.next_training_need,
  local_bridge_accelerator_allowed = true,
  hidden_execution_allowed = false,
  shell_execution_allowed = false,
  filesystem_write_allowed = false,
  deployment_control_allowed = false,
  destructive_actions_allowed = false;

insert into public.war_room_baby_agent_skill_growth (
  baby_agent_id,
  skill_key,
  skill_label,
  progress,
  growth_level,
  confidence_score,
  usefulness_score
)
select
  a.id,
  s.key,
  s.label,
  s.progress,
  a.growth_level,
  a.confidence_score,
  a.usefulness_score
from public.war_room_baby_agents a
cross join lateral jsonb_to_recordset(a.skill_tree) as s(key text, label text, description text, progress numeric)
on conflict (baby_agent_id, skill_key) do update set
  skill_label = excluded.skill_label,
  progress = excluded.progress,
  growth_level = excluded.growth_level,
  confidence_score = excluded.confidence_score,
  usefulness_score = excluded.usefulness_score;

alter table public.war_room_baby_agents enable row level security;
alter table public.war_room_baby_agent_memories enable row level security;
alter table public.war_room_baby_agent_training_events enable row level security;
alter table public.war_room_baby_agent_skill_growth enable row level security;
alter table public.war_room_baby_agent_outcomes enable row level security;

revoke all on table public.war_room_baby_agents from anon, authenticated;
revoke all on table public.war_room_baby_agent_memories from anon, authenticated;
revoke all on table public.war_room_baby_agent_training_events from anon, authenticated;
revoke all on table public.war_room_baby_agent_skill_growth from anon, authenticated;
revoke all on table public.war_room_baby_agent_outcomes from anon, authenticated;

drop policy if exists war_room_baby_agents_service_role_all on public.war_room_baby_agents;
create policy war_room_baby_agents_service_role_all on public.war_room_baby_agents
  for all to service_role using (true) with check (true);

drop policy if exists war_room_baby_memories_service_role_all on public.war_room_baby_agent_memories;
create policy war_room_baby_memories_service_role_all on public.war_room_baby_agent_memories
  for all to service_role using (true) with check (true);

drop policy if exists war_room_baby_training_service_role_all on public.war_room_baby_agent_training_events;
create policy war_room_baby_training_service_role_all on public.war_room_baby_agent_training_events
  for all to service_role using (true) with check (true);

drop policy if exists war_room_baby_skill_growth_service_role_all on public.war_room_baby_agent_skill_growth;
create policy war_room_baby_skill_growth_service_role_all on public.war_room_baby_agent_skill_growth
  for all to service_role using (true) with check (true);

drop policy if exists war_room_baby_outcomes_service_role_all on public.war_room_baby_agent_outcomes;
create policy war_room_baby_outcomes_service_role_all on public.war_room_baby_agent_outcomes
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_baby_agents to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_memories to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_training_events to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_skill_growth to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_outcomes to service_role;
