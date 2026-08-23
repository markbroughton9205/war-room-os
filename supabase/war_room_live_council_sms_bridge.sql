-- NOT APPLIED in this build-only lane. Required for durable Twilio retry safety.
create table if not exists public.war_room_twilio_inbound_events (
  message_sid text primary key check (message_sid ~ '^SM[0-9A-Fa-f]{32}$'),
  state text not null default 'received' check (state in ('received','processing','completed','failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error_code text check (last_error_code is null or last_error_code in (
    'PERSISTENCE_FAILED','COUNCIL_FAILED','OUTBOUND_FAILED','PROCESSING_TIMEOUT','BRIDGE_DISABLED','UNKNOWN_FAILURE'
  )),
  provider_message_sid text,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz
);
create table if not exists public.war_room_twilio_sms_bridge_state (
  singleton boolean primary key default true check (singleton), conversation_id uuid references public.war_room_conversations(id) on delete set null, enabled boolean not null default false, updated_at timestamptz not null default now()
);
create unique index if not exists war_room_sms_message_sid_unique on public.war_room_messages (conversation_id, role, ((metadata->>'inboundMessageId')))
where metadata->>'transport' = 'SMS' and metadata->>'inboundMessageId' is not null and role in ('user','assistant');
create or replace function public.war_room_get_or_create_twilio_sms_conversation() returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  insert into public.war_room_twilio_sms_bridge_state(singleton) values(true) on conflict(singleton) do nothing;
  select conversation_id into v_id from public.war_room_twilio_sms_bridge_state where singleton=true for update;
  if v_id is null then insert into public.war_room_conversations(title,metadata) values('LIVE_COUNCIL_COMMANDER_SMS','{"council":{"source":"live_council","transport":"SMS","provider":"TWILIO"}}') returning id into v_id; update public.war_room_twilio_sms_bridge_state set conversation_id=v_id,updated_at=now() where singleton=true; end if;
  return v_id;
end $$;
create or replace function public.war_room_upsert_twilio_sms_message(p_conversation_id uuid,p_role text,p_content text,p_message_sid text,p_metadata jsonb) returns table(id uuid,content text) language plpgsql security definer set search_path=public as $$
begin
 if p_role not in ('user','assistant') then raise exception 'invalid_sms_message_role'; end if;
 insert into public.war_room_messages(conversation_id,role,content,metadata) values(p_conversation_id,p_role,p_content,p_metadata) on conflict (conversation_id,role,((metadata->>'inboundMessageId'))) where metadata->>'transport'='SMS' and metadata->>'inboundMessageId' is not null and role in ('user','assistant') do nothing;
 return query select m.id,m.content from public.war_room_messages m where m.conversation_id=p_conversation_id and m.role=p_role and m.metadata->>'transport'='SMS' and m.metadata->>'inboundMessageId'=p_message_sid limit 1;
end $$;
alter table public.war_room_twilio_inbound_events enable row level security;
alter table public.war_room_twilio_sms_bridge_state enable row level security;
revoke all on table public.war_room_twilio_inbound_events, public.war_room_twilio_sms_bridge_state from anon, authenticated;
grant select, insert, update on table public.war_room_twilio_inbound_events, public.war_room_twilio_sms_bridge_state to service_role;

-- Claims a brand-new MessageSid, or atomically reclaims a `failed` row or a
-- `processing` row stale past p_stale_after_seconds (crash/timeout recovery).
-- A single UPDATE statement with both reclaim conditions in its WHERE clause
-- is what makes concurrent reclaim attempts safe: Postgres row-level locking
-- lets only one concurrent UPDATE match+affect the row, so only one caller
-- ever observes FOUND = true for the same message_sid. No SELECT-then-UPDATE
-- race window exists here.
create or replace function public.war_room_claim_twilio_inbound(p_message_sid text, p_stale_after_seconds integer default 300)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.war_room_twilio_inbound_events(message_sid, state, attempt_count)
    values (p_message_sid, 'processing', 1)
  on conflict (message_sid) do nothing;

  if found then
    return 'claimed';
  end if;

  update public.war_room_twilio_inbound_events
  set state = 'processing',
      attempt_count = attempt_count + 1,
      last_error_code = null,
      updated_at = now()
  where message_sid = p_message_sid
    and (
      state = 'failed'
      or (state = 'processing' and updated_at < now() - make_interval(secs => p_stale_after_seconds))
    );

  if found then
    return 'claimed';
  end if;

  return 'duplicate';
end;
$$;
create or replace function public.war_room_touch_twilio_inbound_processing(p_message_sid text) returns boolean language sql security definer set search_path = public as $$
 update public.war_room_twilio_inbound_events set updated_at = now() where message_sid = p_message_sid and state = 'processing' returning true
$$;
create or replace function public.war_room_record_twilio_outbound_acceptance(p_message_sid text, p_provider_message_sid text, p_provider_status text) returns boolean language sql security definer set search_path = public as $$
 update public.war_room_twilio_inbound_events set provider_message_sid=p_provider_message_sid, provider_status=p_provider_status, updated_at=now() where message_sid=p_message_sid and state='processing' and provider_message_sid is null returning true
$$;

create or replace function public.war_room_mark_twilio_inbound_completed(
  p_message_sid text,
  p_provider_message_sid text default null,
  p_provider_status text default null
) returns boolean language sql security definer set search_path = public as $$
  update public.war_room_twilio_inbound_events
  set state = 'completed',
      completed_at = now(),
      updated_at = now(),
      provider_message_sid = coalesce(p_provider_message_sid, provider_message_sid),
      provider_status = coalesce(p_provider_status, provider_status)
  where message_sid = p_message_sid and state = 'processing'
  returning true
$$;

create or replace function public.war_room_mark_twilio_inbound_failed(p_message_sid text, p_error_code text)
returns boolean language sql security definer set search_path = public as $$
  update public.war_room_twilio_inbound_events
  set state = 'failed', failed_at = now(), updated_at = now(), last_error_code = p_error_code
  where message_sid = p_message_sid and state = 'processing'
  returning true
$$;

create or replace function public.war_room_get_twilio_inbound_event(p_message_sid text)
returns table(state text, provider_message_sid text, provider_status text, attempt_count integer)
language sql security definer set search_path = public as $$
  select state, provider_message_sid, provider_status, attempt_count
  from public.war_room_twilio_inbound_events
  where message_sid = p_message_sid
$$;

create or replace function public.war_room_get_twilio_sms_bridge_state() returns text language sql security definer set search_path = public as $$ select coalesce((select case when enabled then 'ENABLED' else 'DISABLED' end from public.war_room_twilio_sms_bridge_state where singleton), 'DISABLED') $$;
create or replace function public.war_room_set_twilio_sms_bridge_state(p_enabled boolean) returns void language sql security definer set search_path = public as $$ insert into public.war_room_twilio_sms_bridge_state(singleton,enabled) values(true,p_enabled) on conflict(singleton) do update set enabled=excluded.enabled,updated_at=now() $$;

revoke all on function
  public.war_room_claim_twilio_inbound(text, integer),
  public.war_room_get_or_create_twilio_sms_conversation(), public.war_room_upsert_twilio_sms_message(uuid,text,text,text,jsonb),
  public.war_room_touch_twilio_inbound_processing(text),
  public.war_room_record_twilio_outbound_acceptance(text, text, text),
  public.war_room_mark_twilio_inbound_completed(text, text, text),
  public.war_room_mark_twilio_inbound_failed(text, text),
  public.war_room_get_twilio_inbound_event(text),
  public.war_room_get_twilio_sms_bridge_state(),
  public.war_room_set_twilio_sms_bridge_state(boolean)
from public, anon, authenticated;

grant execute on function
  public.war_room_claim_twilio_inbound(text, integer),
  public.war_room_get_or_create_twilio_sms_conversation(), public.war_room_upsert_twilio_sms_message(uuid,text,text,text,jsonb),
  public.war_room_touch_twilio_inbound_processing(text),
  public.war_room_record_twilio_outbound_acceptance(text, text, text),
  public.war_room_mark_twilio_inbound_completed(text, text, text),
  public.war_room_mark_twilio_inbound_failed(text, text),
  public.war_room_get_twilio_inbound_event(text),
  public.war_room_get_twilio_sms_bridge_state(),
  public.war_room_set_twilio_sms_bridge_state(boolean)
to service_role;
