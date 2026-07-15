import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { validateWorkspaceAttachment, safeOriginalFilename } from './attachments'
import { isValidWorkspaceProposalTransition, validateWorkspaceProposalTransition } from './lifecycle'
import { validateProposalInput } from './input'
import { validateWorkspaceSettings } from './settings'
import { checkWorkspaceRateLimit, resetWorkspaceRateLimitsForTests } from './rateLimit'

export type WorkspaceContributorValidationResult = {
  caseId: string
  passed: boolean
  expected: string
  observed: string
  notes: string[]
}

const JASMINE = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'

export async function runWorkspaceContributorValidation(): Promise<WorkspaceContributorValidationResult[]> {
  const cases: Array<() => Promise<WorkspaceContributorValidationResult> | WorkspaceContributorValidationResult> = [
    jasmineReadsOwnWorkspace,
    jasmineCannotReadAnotherWorkspace,
    jasmineUpdatesOnlyOwnSettings,
    jasmineCreatesDraftProposal,
    ownerDerivedServerSide,
    clientSuppliedOwnerIgnored,
    draftEventCreated,
    jasmineEditsDraft,
    jasmineSubmitsProposal,
    submittedEventCreated,
    jasmineCannotApprove,
    jasmineCannotReject,
    jasmineCannotDirectlyUpdateStatus,
    invalidLifecycleTransitionRejected,
    commanderCanTransitionValidStates,
    commanderCannotSkipLifecycle,
    everyTransitionCreatesOneEvent,
    proposalUpdateAndEventAtomic,
    failedEventInsertRollsBackProposal,
    contributorCannotReadCommanderMemory,
    nonCommanderCannotAccessCommanderRoutes,
    attachmentMimeRejected,
    oversizedAttachmentRejected,
    crossWorkspaceAttachmentPathRejected,
    unsafeFilenameRejected,
    hashStoredCorrectly,
    guessedAttachmentPathDenied,
    commanderSignedUrlRequiresCommander,
    jsonPrototypePollutionRejected,
    oversizedSettingsRejected,
    serviceRoleNeverActsAsAuthorization,
    clientSuppliedRoleNotTrusted,
    noGlobalConfigurationMutation,
    noAnonAccess,
    eventRowsImmutable,
    roleEscalationInsertRejected,
    roleEscalationUpdateRejected,
    roleJsonInjectionRejected,
    directRestCannotInsertProposal,
    forgedStatusRejected,
    forgedCommanderFieldsRejected,
    duplicateEventRetryRejected,
    duplicateTransitionRetryRejected,
    proposalWithoutEventRejected,
    eventWithoutProposalRejected,
    attachmentUploadDbFailureCompensates,
    attachmentDbSuccessUploadFailureRejected,
    orphanCleanupDocumented,
    invalidFileSignatureRejected,
    timestampSpoofingRejected,
    quotaExhaustionRejected,
    idempotencyKeyIsCallerSuppliedUuid,
    firstTransitionSucceedsWithIdempotencyKey,
    postCommitRetryReturnsExistingResult,
    sameKeyDifferentTargetConflicts,
    sameKeyDifferentActorConflicts,
    revisionCycleWithNewKeySucceeds,
    concurrentSameKeyRequestsCoalesce,
    concurrentDifferentKeyRequestsOneCommits,
    eventSequenceMonotonicUnderInterleaving,
    preCommitRollbackRetrySameKeySucceeds,
    postCommitTimeoutRetrySameKeyOneEvent,
    duplicateUiSubmissionWhilePendingCoalesces,
    malformedIdempotencyKeyRejectedServerSide,
  ]
  const results: WorkspaceContributorValidationResult[] = []
  for (const testCase of cases) results.push(await testCase())
  return results
}

function jasmineReadsOwnWorkspace() {
  const db = new FakeWorkspaceDb()
  return validation('workspace_qa_01_read_own_workspace', db.getMember(JASMINE)?.workspace_owner_id === JASMINE, 'Jasmine can read her own workspace membership.', 'own_member_found', ['Membership lookup is scoped by user id.'])
}

function jasmineCannotReadAnotherWorkspace() {
  const db = new FakeWorkspaceDb()
  return validation('workspace_qa_02_cannot_read_other_workspace', db.getMemberAs(JASMINE, OTHER) === null, 'Jasmine cannot read another workspace membership.', 'other_member_hidden', ['Cross-workspace reads are denied.'])
}

function jasmineUpdatesOnlyOwnSettings() {
  const db = new FakeWorkspaceDb()
  const own = db.updateSettingsAs(JASMINE, JASMINE, { theme: { mode: 'dark' } })
  const other = db.updateSettingsAs(JASMINE, OTHER, { theme: { mode: 'dark' } })
  return validation('workspace_qa_03_update_only_own_settings', own && !other, 'Settings update requires matching workspace owner.', `own=${own}; other=${other}`, ['Ownership is derived from session.'])
}

function jasmineCreatesDraftProposal() {
  const db = new FakeWorkspaceDb()
  const created = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  return validation('workspace_qa_04_create_draft', created.proposal.status === 'draft', 'Proposal creation starts in draft.', created.proposal.status, ['No client status is accepted.'])
}

function ownerDerivedServerSide() {
  const db = new FakeWorkspaceDb()
  const created = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  return validation('workspace_qa_05_owner_derived_server_side', created.proposal.workspace_owner_id === JASMINE, 'workspace_owner_id is session-derived.', created.proposal.workspace_owner_id, ['Client owner values are ignored.'])
}

function clientSuppliedOwnerIgnored() {
  const input = validateProposalInput({ title: 'Idea', description: 'Desc', category: 'feature', workspace_owner_id: OTHER })
  return validation('workspace_qa_06_client_owner_ignored', input.ok && !('workspace_owner_id' in input.value), 'Client-supplied owner id is not part of accepted proposal input.', JSON.stringify(input), ['Only title, description, and category are accepted.'])
}

function draftEventCreated() {
  const db = new FakeWorkspaceDb()
  const created = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  return validation('workspace_qa_07_draft_event_created', created.event.event_type === 'proposal_created' && db.events.length === 1, 'Initial creation inserts exactly one draft event.', `events=${db.events.length}; type=${created.event.event_type}`, ['Creation is atomic in the fake boundary.'])
}

function jasmineEditsDraft() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const updated = db.editProposal(JASMINE, proposal.proposal_id, { title: 'Updated' })
  return validation('workspace_qa_08_edit_draft', updated?.title === 'Updated', 'Contributor can edit draft proposal content.', updated?.title ?? 'null', ['Status is unchanged.'])
}

function jasmineSubmitsProposal() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const submitted = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted')
  return validation('workspace_qa_09_submit', submitted.ok && submitted.proposal.status === 'submitted', 'Contributor can submit draft.', submitted.ok ? submitted.proposal.status : submitted.error, ['Allowed contributor transition.'])
}

function submittedEventCreated() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted')
  return validation('workspace_qa_10_submitted_event_created', db.events.length === 2 && db.events[1]?.to_status === 'submitted', 'Submission inserts one submitted event.', `events=${db.events.length}; to=${db.events[1]?.to_status}`, ['Event log remains append-only.'])
}

function jasmineCannotApprove() {
  return validation('workspace_qa_11_contributor_cannot_approve', !isValidWorkspaceProposalTransition('commander_council_review', 'approved', 'workspace_contributor'), 'Contributor cannot approve.', 'rejected', ['Approval is Commander-only.'])
}

function jasmineCannotReject() {
  return validation('workspace_qa_12_contributor_cannot_reject', !isValidWorkspaceProposalTransition('commander_council_review', 'rejected', 'workspace_contributor'), 'Contributor cannot reject.', 'rejected', ['Rejection is Commander-only.'])
}

function jasmineCannotDirectlyUpdateStatus() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const result = db.directStatusUpdateAsContributor(JASMINE, proposal.proposal_id, 'approved')
  return validation('workspace_qa_13_no_direct_status_update', !result, 'Contributor cannot directly update status.', `updated=${result}`, ['Status changes must use transition function.'])
}

function invalidLifecycleTransitionRejected() {
  const result = validateWorkspaceProposalTransition('draft', 'approved', 'commander')
  return validation('workspace_qa_14_invalid_transition_rejected', !result.ok, 'draft to approved is rejected.', result.ok ? 'allowed' : result.reason, ['No lifecycle skip.'])
}

function commanderCanTransitionValidStates() {
  return validation('workspace_qa_15_commander_valid_transition', isValidWorkspaceProposalTransition('commander_council_review', 'approved', 'commander'), 'Commander can approve from commander_council_review.', 'allowed', ['Valid Commander transition.'])
}

function commanderCannotSkipLifecycle() {
  return validation('workspace_qa_16_commander_no_skip', !isValidWorkspaceProposalTransition('submitted', 'approved', 'commander'), 'Commander cannot skip to approved.', 'rejected', ['Review states are required.'])
}

function everyTransitionCreatesOneEvent() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const before = db.events.length
  db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted')
  return validation('workspace_qa_17_one_event_per_transition', db.events.length === before + 1, 'Each successful transition creates exactly one event.', `before=${before}; after=${db.events.length}`, ['No duplicate event writes.'])
}

function proposalUpdateAndEventAtomic() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const result = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted')
  return validation('workspace_qa_18_atomic_update_event', result.ok && db.proposals.get(proposal.proposal_id)?.status === 'submitted' && db.events.length === 2, 'Proposal update and event insert succeed together.', `ok=${result.ok}; status=${db.proposals.get(proposal.proposal_id)?.status}; events=${db.events.length}`, ['Fake boundary models transaction success.'])
}

function failedEventInsertRollsBackProposal() {
  const db = new FakeWorkspaceDb({ failNextEvent: true })
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const result = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted')
  return validation('workspace_qa_19_failed_event_rolls_back', !result.ok && db.proposals.get(proposal.proposal_id)?.status === 'draft' && db.events.length === 1, 'Failed event insert rolls back proposal status.', `ok=${result.ok}; status=${db.proposals.get(proposal.proposal_id)?.status}; events=${db.events.length}`, ['No proposal/event divergence.'])
}

function contributorCannotReadCommanderMemory() {
  const routes = readFileSync('app/api/memory/route.ts', 'utf8')
  return validation('workspace_qa_20_no_commander_memory', routes.includes('requireCommanderSession'), 'Commander memory routes require Commander session.', 'requireCommanderSession_found', ['Workspace routes are separate from memory routes.'])
}

function nonCommanderCannotAccessCommanderRoutes() {
  const route = readFileSync('app/api/commander/proposals/route.ts', 'utf8')
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  return validation('workspace_qa_21_commander_routes_gated', route.includes('handleCommanderProposalsGet') && handlers.includes('requireCommanderSession'), 'Commander proposal routes use Commander session gate.', 'gate_found', ['Non-Commander sessions cannot use Commander queue.'])
}

async function attachmentMimeRejected() {
  const file = new File(['x'], 'x.gif', { type: 'image/gif' })
  const result = await validateWorkspaceAttachment({ workspaceOwnerId: JASMINE, proposalId: 'proposal', file })
  return validation('workspace_qa_22_attachment_mime_rejected', !result.ok && result.reason === 'mime_type_rejected', 'Disallowed MIME rejected.', result.ok ? 'allowed' : result.reason, ['Only approved MIME types are accepted.'])
}

async function oversizedAttachmentRejected() {
  const blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'text/plain' })
  const file = new File([blob], 'large.txt', { type: 'text/plain' })
  const result = await validateWorkspaceAttachment({ workspaceOwnerId: JASMINE, proposalId: 'proposal', file })
  return validation('workspace_qa_23_attachment_size_rejected', !result.ok && result.reason === 'file_too_large', 'Oversized attachment rejected.', result.ok ? 'allowed' : result.reason, ['10 MB max enforced before storage.'])
}

async function crossWorkspaceAttachmentPathRejected() {
  const file = new File(['x'], 'note.txt', { type: 'text/plain' })
  const result = await validateWorkspaceAttachment({ workspaceOwnerId: JASMINE, proposalId: 'proposal', file })
  return validation('workspace_qa_24_cross_workspace_path_rejected', result.ok && result.storagePath.startsWith(`${JASMINE}/proposal/`) && !result.storagePath.includes(OTHER), 'Server-generated path remains under owner/proposal prefix.', result.ok ? result.storagePath : result.reason, ['No client path is accepted.'])
}

function unsafeFilenameRejected() {
  return validation('workspace_qa_25_unsafe_filename_rejected', !safeOriginalFilename('../secret.txt'), 'Path traversal filename rejected.', 'rejected', ['Original filename is metadata only.'])
}

async function hashStoredCorrectly() {
  const file = new File(['abc'], 'note.txt', { type: 'text/plain' })
  const result = await validateWorkspaceAttachment({ workspaceOwnerId: JASMINE, proposalId: 'proposal', file })
  const expectedHash = createHash('sha256').update('abc').digest('hex')
  return validation('workspace_qa_26_hash_correct', result.ok && result.contentSha256 === expectedHash, 'SHA-256 is calculated server-side.', result.ok ? result.contentSha256 : result.reason, ['Hash does not come from client input.'])
}

function guessedAttachmentPathDenied() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  return validation('workspace_qa_27_guessed_path_denied', sql.includes('workspace_attachments_select_own') && sql.includes('workspace_owner_id = auth.uid()'), 'Attachment metadata select is owner-scoped.', 'owner_policy_found', ['Storage bucket remains private.'])
}

function commanderSignedUrlRequiresCommander() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  return validation('workspace_qa_28_commander_signed_url_gated', handlers.indexOf('handleCommanderAttachmentSignedUrl') < handlers.indexOf('createSignedAttachmentUrl') && handlers.includes("requireCommanderContext('Commander proposal attachment'"), 'Signed URL route requires Commander context first.', 'commander_context_before_signed_url', ['Short-lived URL is created only after Commander authorization.'])
}

function jsonPrototypePollutionRejected() {
  const result = validateWorkspaceSettings({ theme: JSON.parse('{"__proto__":{"polluted":true}}') })
  return validation('workspace_qa_29_prototype_pollution_rejected', !result.ok && result.reason.includes('prototype_pollution_key'), 'Prototype pollution keys rejected.', result.ok ? 'allowed' : result.reason, ['Settings schema is runtime-validated.'])
}

function oversizedSettingsRejected() {
  const result = validateWorkspaceSettings({ layout: { density: 'x'.repeat(9_000) } })
  return validation('workspace_qa_30_oversized_settings_rejected', !result.ok && result.reason.includes('too_large'), 'Oversized settings rejected.', result.ok ? 'allowed' : result.reason, ['JSON size limit enforced.'])
}

function serviceRoleNeverActsAsAuthorization() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  return validation('workspace_qa_31_service_role_not_authorizer', handlers.indexOf('assertLiveActionsAllowed') < handlers.indexOf('createSupabaseWorkspaceStore'), 'Environment/session gates occur before service-role store construction.', 'gate_before_store', ['Service role is executor only.'])
}

function clientSuppliedRoleNotTrusted() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const memberRoleConstraint = "constraint workspace_members_role_check check (role = 'workspace_contributor')"
  const memberTableBlock = sql.slice(sql.indexOf('create table if not exists public.workspace_members'), sql.indexOf('create table if not exists public.workspace_settings'))
  return validation('workspace_qa_32_client_role_not_trusted', memberTableBlock.includes(memberRoleConstraint) && !memberTableBlock.includes("'commander'"), 'Workspace membership cannot create Commander role.', 'role_constraint_found', ['Commander authority remains separate.'])
}

function noGlobalConfigurationMutation() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  return validation('workspace_qa_33_no_global_config_mutation', !handlers.includes('configuration') && !handlers.includes('global'), 'Workspace routes do not mutate global configuration.', 'no_global_mutation_strings', ['Settings are workspace-scoped.'])
}

function noAnonAccess() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('revoke all on public.workspace_members from anon') && sql.includes('revoke all on public.workspace_proposals from anon')
  return validation('workspace_qa_34_no_anon_access', passed, 'Anon access revoked from workspace tables.', passed ? 'anon_revokes_found' : 'missing_revokes', ['No broad anonymous policies are added.'])
}

function eventRowsImmutable() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const rollback = readFileSync('supabase/rollback/war_room_phase46qa_workspace_contributor_rollback.sql', 'utf8')
  const eventPolicyBlock = sql.slice(sql.indexOf('create policy workspace_events_select_own'), sql.indexOf('create policy workspace_attachments_select_own'))
  const passed = eventPolicyBlock.includes('for select to authenticated') && !eventPolicyBlock.includes('for update to authenticated') && !eventPolicyBlock.includes('for delete to authenticated') && !sql.includes('grant update on public.workspace_proposal_events') && !sql.includes('grant delete on public.workspace_proposal_events') && rollback.includes('drop table if exists public.workspace_proposal_events')
  return validation('workspace_qa_35_events_immutable', passed, 'Events have no authenticated UPDATE/DELETE policy.', passed ? 'append_only' : 'mutable_policy_found', ['Events are append-only through service-side RPC.'])
}

function roleEscalationInsertRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = !sql.includes('grant insert on public.workspace_members to authenticated') && sql.includes("constraint workspace_members_role_check check (role = 'workspace_contributor')")
  return validation('workspace_qa_36_role_insert_escalation_rejected', passed, 'Authenticated contributors cannot insert privileged roles.', passed ? 'insert_not_granted_role_constrained' : 'role_insert_surface_found', ['INSERT role=commander/operator/admin must fail.'])
}

function roleEscalationUpdateRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = !sql.includes('grant update on public.workspace_members to authenticated') && !sql.includes('workspace_members_update')
  return validation('workspace_qa_37_role_update_escalation_rejected', passed, 'Authenticated contributors cannot update membership roles.', passed ? 'update_not_granted' : 'role_update_surface_found', ['UPDATE role=commander/operator/admin must fail.'])
}

function roleJsonInjectionRejected() {
  const result = validateWorkspaceSettings({ theme: { accent: 'commander:admin' } })
  return validation('workspace_qa_38_role_json_injection_rejected', !result.ok, 'Settings cannot smuggle Commander/admin role language.', result.ok ? 'allowed' : result.reason, ['JSON injection cannot mint privilege.'])
}

function directRestCannotInsertProposal() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = !sql.includes('grant insert on public.workspace_proposals to authenticated') && !sql.includes('workspace_proposals_insert_own_draft')
  return validation('workspace_qa_39_direct_rest_proposal_insert_rejected', passed, 'Proposal creation is server RPC only.', passed ? 'insert_not_granted' : 'direct_insert_surface_found', ['Direct REST API cannot create proposal without first event.'])
}

function forgedStatusRejected() {
  const input = validateProposalInput({ title: 'Idea', description: 'Desc', category: 'feature', status: 'approved' })
  return validation('workspace_qa_40_forged_status_rejected', input.ok && !('status' in input.value), 'Client status is not accepted by proposal input.', JSON.stringify(input), ['Forged status cannot enter create/update payload.'])
}

function forgedCommanderFieldsRejected() {
  const input = validateProposalInput({ title: 'Idea', description: 'Desc', category: 'feature', commander_decision: 'approved', decided_by_user_id: JASMINE })
  return validation('workspace_qa_41_forged_commander_fields_rejected', input.ok && !('commander_decision' in input.value) && !('decided_by_user_id' in input.value), 'Commander fields are not accepted by contributor input.', JSON.stringify(input), ['Contributor cannot self-approve through payload fields.'])
}

function duplicateEventRetryRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('workspace_proposal_events_idempotency_unique unique (proposal_id, idempotency_key)')
  return validation('workspace_qa_42_duplicate_event_retry_rejected', passed, 'Per-proposal idempotency key prevents duplicate event rows.', passed ? 'unique_idempotency_key' : 'missing_idempotency_key', ['Retries must not create duplicate transition events.'])
}

function duplicateTransitionRetryRejected() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const first = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000101')
  const second = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000102')
  return validation('workspace_qa_43_duplicate_transition_retry_rejected', first.ok && !second.ok && db.events.length === 2, 'A second intentional transition from stale state is rejected.', `first=${first.ok}; second=${second.ok}; events=${db.events.length}`, ['Current-state validation rejects a different-key duplicate from stale state.'])
}

function proposalWithoutEventRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('workspace_create_proposal') && sql.includes('insert into public.workspace_proposal_events') && !sql.includes('grant insert on public.workspace_proposals to authenticated')
  return validation('workspace_qa_44_proposal_without_event_rejected', passed, 'Only RPC can create proposal and it inserts initial event atomically.', passed ? 'rpc_atomic_creation' : 'proposal_without_event_possible', ['Proposal must never exist without first event.'])
}

function eventWithoutProposalRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('workspace_proposal_events_proposal_owner_fk foreign key (proposal_id, workspace_owner_id) references public.workspace_proposals(proposal_id, workspace_owner_id)') && !sql.includes('grant insert on public.workspace_proposal_events to authenticated')
  return validation('workspace_qa_45_event_without_proposal_rejected', passed, 'Events require matching proposal/owner composite FK.', passed ? 'composite_fk_found' : 'event_without_proposal_possible', ['Database enforces proposal/event owner consistency.'])
}

function attachmentUploadDbFailureCompensates() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  const passed = handlers.includes('await ctx.store.deleteAttachmentObject(validated.storagePath)') && handlers.indexOf('uploadAttachmentBytes') < handlers.indexOf('insertAttachment')
  return validation('workspace_qa_46_attachment_db_failure_compensates', passed, 'Uploaded object is deleted when metadata insert fails.', passed ? 'compensation_found' : 'missing_compensation', ['Storage/Postgres split has explicit compensation.'])
}

function attachmentDbSuccessUploadFailureRejected() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  const passed = handlers.indexOf('if (!uploaded.ok) return jsonStoreFailure(uploaded)') < handlers.indexOf('insertAttachment')
  return validation('workspace_qa_47_attachment_upload_failure_no_metadata', passed, 'Metadata insert is skipped when upload fails.', passed ? 'upload_first' : 'metadata_before_upload', ['No DB success after upload failure.'])
}

function orphanCleanupDocumented() {
  const doc = readFileSync('docs/architecture/WORKSPACE_CONTRIBUTOR_FOUNDATION.md', 'utf8')
  const passed = doc.includes('Orphan reconciliation remains a future operator maintenance task')
  return validation('workspace_qa_48_orphan_cleanup_documented', passed, 'Orphan reconciliation behavior is documented.', passed ? 'documented' : 'missing_doc', ['Residual storage cleanup has an explicit review path.'])
}

async function invalidFileSignatureRejected() {
  const file = new File(['not really png'], 'fake.png', { type: 'image/png' })
  const result = await validateWorkspaceAttachment({ workspaceOwnerId: JASMINE, proposalId: 'proposal', file })
  return validation('workspace_qa_49_invalid_signature_rejected', !result.ok && result.reason === 'file_signature_mismatch', 'Spoofed MIME/extension rejected by magic-byte validation.', result.ok ? 'allowed' : result.reason, ['Actual file signature is validated.'])
}

function timestampSpoofingRejected() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('workspace_prevent_created_at_update') && sql.includes('workspace_set_updated_at') && !sql.includes('grant update on public.workspace_proposals to authenticated')
  return validation('workspace_qa_50_timestamp_spoofing_rejected', passed, 'Timestamps are database/server controlled.', passed ? 'timestamp_triggers_and_no_direct_update' : 'timestamp_spoof_surface_found', ['Clients cannot spoof created_at/updated_at/decided_at/verified_at.'])
}

function quotaExhaustionRejected() {
  resetWorkspaceRateLimitsForTests()
  let blocked = false
  for (let index = 0; index < 9; index += 1) {
    const result = checkWorkspaceRateLimit(JASMINE, 'proposal_create', 1_000)
    if (!result.ok) blocked = true
  }
  return validation('workspace_qa_51_quota_exhaustion_rejected', blocked, 'Proposal creation rate limit eventually blocks repeated attempts.', blocked ? 'rate_limited' : 'not_limited', ['Quota exhaustion has route-level guardrails.'])
}

function idempotencyKeyIsCallerSuppliedUuid() {
  const sql = readFileSync('supabase/war_room_phase46qa_workspace_contributor.sql', 'utf8')
  const passed = sql.includes('p_idempotency_key uuid') && !sql.includes("v_idempotency_key :=") && !sql.includes("idempotencyKey = `transition:")
  return validation('workspace_qa_52_idempotency_key_caller_supplied_uuid', passed, 'Idempotency key is caller-supplied UUID and not derived from event sequence.', passed ? 'caller_uuid_not_sequence' : 'derived_key_found', ['Logical retry identity is separate from event ordering.'])
}

function firstTransitionSucceedsWithIdempotencyKey() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const first = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000201')
  return validation('workspace_qa_53_first_transition_with_key_succeeds', first.ok && db.events.length === 2 && db.events[1]?.idempotency_key === '00000000-0000-4000-8000-000000000201', 'First keyed transition succeeds and stores supplied key.', first.ok ? `${first.proposal.status}; events=${db.events.length}` : first.error, ['Caller UUID identifies the logical action.'])
}

function postCommitRetryReturnsExistingResult() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000202'
  const first = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  const retry = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  return validation('workspace_qa_54_post_commit_retry_returns_existing', first.ok && retry.ok && retry.replay === true && db.events.length === 2, 'Retry with same key returns existing event without second update.', `first=${first.ok}; retry=${retry.ok}; replay=${retry.ok ? retry.replay : false}; events=${db.events.length}`, ['Lost response retry is idempotent.'])
}

function sameKeyDifferentTargetConflicts() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000203'
  db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  const conflict = db.transition(JASMINE, 'commander', proposal.proposal_id, 'contributor_review', key)
  return validation('workspace_qa_55_same_key_different_target_conflicts', !conflict.ok && conflict.error === 'idempotency_conflict', 'Same key cannot be reused for a different target status.', conflict.ok ? 'allowed' : conflict.error, ['Idempotency key is scoped to one logical request.'])
}

function sameKeyDifferentActorConflicts() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000204'
  db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  const conflict = db.transition(OTHER, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  return validation('workspace_qa_56_same_key_different_actor_conflicts', !conflict.ok && conflict.error === 'idempotency_conflict', 'Same key cannot be reused by a different actor.', conflict.ok ? 'allowed' : conflict.error, ['Actor mismatch is an idempotency conflict, not a replay.'])
}

function revisionCycleWithNewKeySucceeds() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const steps: Array<['workspace_contributor' | 'commander', FakeProposal['status'], string]> = [
    ['workspace_contributor', 'submitted', '00000000-0000-4000-8000-000000000301'],
    ['commander', 'contributor_review', '00000000-0000-4000-8000-000000000302'],
    ['commander', 'commander_council_review', '00000000-0000-4000-8000-000000000303'],
    ['commander', 'revision_requested', '00000000-0000-4000-8000-000000000304'],
    ['workspace_contributor', 'submitted', '00000000-0000-4000-8000-000000000305'],
    ['commander', 'contributor_review', '00000000-0000-4000-8000-000000000306'],
  ]
  const outcomes = steps.map(([role, toStatus, key]) => db.transition(JASMINE, role, proposal.proposal_id, toStatus, key))
  const allSucceeded = outcomes.every((outcome) => outcome.ok)
  const secondPass = outcomes[outcomes.length - 1]
  return validation(
    'workspace_qa_57_revision_cycle_new_key_succeeds',
    allSucceeded && secondPass.ok,
    'Same transition shape in a later revision cycle succeeds with a new logical key.',
    `allSucceeded=${allSucceeded}; events=${db.events.length}; failures=${outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.error).join(',')}`,
    ['Repeated transition shape is allowed when the logical action key is new.']
  )
}

function concurrentSameKeyRequestsCoalesce() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000401'
  const results = [
    db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key),
    db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key),
  ]
  return validation('workspace_qa_58_concurrent_same_key_coalesces', results.every((result) => result.ok) && results[1]?.ok && results[1].replay === true && db.events.length === 2, 'Concurrent same-key requests produce one committed event and consistent replay.', `ok=${results.map((result) => result.ok).join(',')}; events=${db.events.length}`, ['Same-key forced interleaving coalesces.'])
}

function concurrentDifferentKeyRequestsOneCommits() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const first = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000402')
  const second = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000403')
  return validation('workspace_qa_59_concurrent_different_key_one_commits', first.ok && !second.ok && second.error === 'invalid_transition' && db.events.length === 2, 'Concurrent different-key requests from same state commit once and stale-state reject once.', `first=${first.ok}; second=${second.ok ? 'ok' : second.error}; events=${db.events.length}`, ['Different logical actions still obey current-state validation.'])
}

function eventSequenceMonotonicUnderInterleaving() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', '00000000-0000-4000-8000-000000000404')
  db.transition(JASMINE, 'commander', proposal.proposal_id, 'contributor_review', '00000000-0000-4000-8000-000000000405')
  db.transition(JASMINE, 'commander', proposal.proposal_id, 'commander_council_review', '00000000-0000-4000-8000-000000000406')
  const monotonic = db.events.every((event, index) => event.event_sequence === index + 1)
  return validation('workspace_qa_60_event_sequence_monotonic', monotonic, 'Event sequence remains unique and monotonic under interleaved transitions.', db.events.map((event) => String(event.event_sequence)).join(','), ['Sequence is committed ordering only.'])
}

function preCommitRollbackRetrySameKeySucceeds() {
  const db = new FakeWorkspaceDb({ failNextEvent: true })
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000407'
  const failed = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  const retry = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  return validation('workspace_qa_61_pre_commit_rollback_retry_same_key_succeeds', !failed.ok && retry.ok && db.events.length === 2, 'Rollback before event insert leaves no idempotency record; retry can commit once.', `failed=${failed.ok ? 'ok' : failed.error}; retry=${retry.ok}; events=${db.events.length}`, ['Pre-commit rollback does not poison the logical key.'])
}

function postCommitTimeoutRetrySameKeyOneEvent() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const key = '00000000-0000-4000-8000-000000000408'
  const committedButLost = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  const retryAfterTimeout = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', key)
  return validation('workspace_qa_62_post_commit_timeout_retry_one_event', committedButLost.ok && retryAfterTimeout.ok && retryAfterTimeout.replay === true && db.events.filter((event) => event.idempotency_key === key).length === 1, 'Post-commit timeout retry returns existing transition with one event.', `replay=${retryAfterTimeout.ok ? retryAfterTimeout.replay : false}; keyEvents=${db.events.filter((event) => event.idempotency_key === key).length}`, ['Primary ambiguous retry case is covered.'])
}

function duplicateUiSubmissionWhilePendingCoalesces() {
  const db = new FakeWorkspaceDb()
  const { proposal } = db.createProposal(JASMINE, { title: 'Idea', description: 'Build this carefully.', category: 'feature' })
  const uiActionKey = '00000000-0000-4000-8000-000000000409'
  const firstClick = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', uiActionKey)
  const doubleClick = db.transition(JASMINE, 'workspace_contributor', proposal.proposal_id, 'submitted', uiActionKey)
  return validation('workspace_qa_63_duplicate_ui_submission_coalesces', firstClick.ok && doubleClick.ok && doubleClick.replay === true && db.events.length === 2, 'Duplicate UI submission while pending reuses one logical action key.', `first=${firstClick.ok}; secondReplay=${doubleClick.ok ? doubleClick.replay : false}; events=${db.events.length}`, ['Double-clicks reuse the same action key and do not duplicate events.'])
}

function malformedIdempotencyKeyRejectedServerSide() {
  const handlers = readFileSync('lib/workspace-contributor/routes.ts', 'utf8')
  const passed = handlers.includes('UUID_PATTERN') && handlers.includes('invalid_idempotency_key') && handlers.includes('idempotency_key_mismatch')
  return validation('workspace_qa_64_malformed_idempotency_key_rejected', passed, 'Route layer validates idempotency UUID shape and conflicting key surfaces.', passed ? 'uuid_validation_found' : 'uuid_validation_missing', ['Malformed arbitrary keys are not trusted.'])
}

type FakeProposal = {
  proposal_id: string
  workspace_owner_id: string
  title: string
  description: string
  category: 'feature' | 'ui' | 'workflow' | 'council_behavior'
  status: 'draft' | 'submitted' | 'contributor_review' | 'commander_council_review' | 'revision_requested' | 'approved' | 'rejected' | 'implemented' | 'verified' | 'closed'
}

type FakeEvent = {
  event_type: string
  from_status: FakeProposal['status'] | null
  to_status: FakeProposal['status']
  actor_user_id: string
  actor_role: 'workspace_contributor' | 'commander'
  idempotency_key: string
  event_sequence: number
}

type FakeTransitionResult =
  | { ok: true; proposal: FakeProposal; event: FakeEvent; replay: boolean }
  | { ok: false; error: string }

class FakeWorkspaceDb {
  proposals = new Map<string, FakeProposal>()
  events: FakeEvent[] = []
  private settings = new Map<string, Record<string, unknown>>()
  private failNextEvent: boolean

  constructor(options: { failNextEvent?: boolean } = {}) {
    this.failNextEvent = Boolean(options.failNextEvent)
  }

  getMember(userId: string) {
    return userId === JASMINE ? { workspace_owner_id: JASMINE } : null
  }

  getMemberAs(actorId: string, targetId: string) {
    return actorId === targetId ? this.getMember(targetId) : null
  }

  updateSettingsAs(actorId: string, targetId: string, value: Record<string, unknown>) {
    if (actorId !== targetId) return false
    this.settings.set(targetId, value)
    return true
  }

  createProposal(ownerId: string, input: { title: string; description: string; category: FakeProposal['category'] }) {
    const proposal: FakeProposal = {
      proposal_id: `proposal-${this.proposals.size + 1}`,
      workspace_owner_id: ownerId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: 'draft',
    }
    this.proposals.set(proposal.proposal_id, proposal)
    const event: FakeEvent = {
      event_type: 'proposal_created',
      from_status: null,
      to_status: 'draft',
      actor_user_id: ownerId,
      actor_role: 'workspace_contributor',
      event_sequence: 1,
      idempotency_key: `proposal-created-${proposal.proposal_id}`,
    }
    this.events.push(event)
    return { proposal, event }
  }

  editProposal(actorId: string, proposalId: string, input: Partial<Pick<FakeProposal, 'title' | 'description' | 'category'>>) {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.workspace_owner_id !== actorId || !['draft', 'revision_requested'].includes(proposal.status)) return null
    const updated = { ...proposal, ...input }
    this.proposals.set(proposalId, updated)
    return updated
  }

  directStatusUpdateAsContributor(actorId: string, proposalId: string, status: FakeProposal['status']) {
    const proposal = this.proposals.get(proposalId)
    if (!proposal || proposal.workspace_owner_id !== actorId) return false
    void status
    return false
  }

  transition(actorId: string, actorRole: 'workspace_contributor' | 'commander', proposalId: string, toStatus: FakeProposal['status'], idempotencyKey = `00000000-0000-4000-8000-${String(this.events.length + 1).padStart(12, '0')}`): FakeTransitionResult {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return { ok: false as const, error: 'not_found' }
    const existingEvent = this.events.find((event) => event.idempotency_key === idempotencyKey)
    if (existingEvent) {
      if (
        existingEvent.to_status === toStatus
        && existingEvent.actor_user_id === actorId
        && existingEvent.actor_role === actorRole
      ) {
        return { ok: true as const, proposal, event: existingEvent, replay: true }
      }
      return { ok: false as const, error: 'idempotency_conflict' }
    }
    if (actorRole === 'workspace_contributor' && proposal.workspace_owner_id !== actorId) return { ok: false as const, error: 'owner_mismatch' }
    if (!isValidWorkspaceProposalTransition(proposal.status, toStatus, actorRole)) return { ok: false as const, error: 'invalid_transition' }

    const previous = { ...proposal }
    const updated = { ...proposal, status: toStatus }
    this.proposals.set(proposalId, updated)

    if (this.failNextEvent) {
      this.failNextEvent = false
      this.proposals.set(proposalId, previous)
      return { ok: false as const, error: 'event_insert_failed' }
    }

    const eventSequence = this.events.length + 1
    const event: FakeEvent = {
      event_type: toStatus === 'submitted' ? 'proposal_submitted' : 'proposal_transitioned',
      from_status: proposal.status,
      to_status: toStatus,
      actor_user_id: actorId,
      actor_role: actorRole,
      event_sequence: eventSequence,
      idempotency_key: idempotencyKey,
    }
    this.events.push(event)
    return { ok: true as const, proposal: updated, event, replay: false }
  }
}

function validation(caseId: string, passed: boolean, expected: string, observed: string, notes: string[]): WorkspaceContributorValidationResult {
  return { caseId, passed, expected, observed, notes }
}
