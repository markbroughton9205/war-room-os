-- Phase 46Q-A rollback
-- WARNING: This destroys workspace proposal, event, attachment, settings, and membership data.
-- It does not alter Commander, auth, memory, invitation, approval, or recovery tables.
-- It does not restore anonymous access anywhere.

drop trigger if exists workspace_proposals_prevent_created_at_update on public.workspace_proposals;
drop trigger if exists workspace_members_prevent_created_at_update on public.workspace_members;
drop trigger if exists workspace_proposals_set_updated_at on public.workspace_proposals;
drop trigger if exists workspace_settings_set_updated_at on public.workspace_settings;
drop trigger if exists workspace_members_set_updated_at on public.workspace_members;

drop function if exists public.workspace_transition_proposal(uuid, uuid, text, text, uuid, text, text, text, text);
drop function if exists public.workspace_transition_proposal(uuid, uuid, text, text, text, text, text, text);
drop function if exists public.workspace_create_proposal(uuid, text, text, text);
drop function if exists public.workspace_event_type(text, text, text);
drop function if exists public.workspace_is_valid_transition(text, text, text);

drop policy if exists workspace_attachments_select_own on public.workspace_proposal_attachments;
drop policy if exists workspace_events_select_own on public.workspace_proposal_events;
drop policy if exists workspace_proposals_update_own_editable on public.workspace_proposals;
drop policy if exists workspace_proposals_insert_own_draft on public.workspace_proposals;
drop policy if exists workspace_proposals_select_own on public.workspace_proposals;
drop policy if exists workspace_settings_update_own on public.workspace_settings;
drop policy if exists workspace_settings_insert_own on public.workspace_settings;
drop policy if exists workspace_settings_select_own on public.workspace_settings;
drop policy if exists workspace_members_select_own on public.workspace_members;

drop table if exists public.workspace_proposal_attachments;
drop table if exists public.workspace_proposal_events;
drop table if exists public.workspace_proposals;
drop table if exists public.workspace_settings;
drop table if exists public.workspace_members;

drop function if exists public.workspace_prevent_created_at_update();
drop function if exists public.workspace_set_updated_at();
