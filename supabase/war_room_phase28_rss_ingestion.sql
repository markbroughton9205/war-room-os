-- Phase 28: RSS ingestion runtime diagnostics on signal sources.
-- Additive only. No row deletes.

alter table public.war_room_signal_sources
  add column if not exists enabled boolean not null default true,
  add column if not exists poll_interval_minutes integer,
  add column if not exists last_poll_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_item_count integer,
  add column if not exists stale_feed_detection boolean not null default false,
  add column if not exists last_error_message text not null default '';

alter table public.war_room_signal_sources
  drop constraint if exists war_room_signal_sources_poll_interval_check;

alter table public.war_room_signal_sources
  add constraint war_room_signal_sources_poll_interval_check check (
    poll_interval_minutes is null
    or (poll_interval_minutes >= 5 and poll_interval_minutes <= 15)
  );

create index if not exists war_room_signal_sources_rss_poll_idx
  on public.war_room_signal_sources (provider, enabled, configured, last_poll_at desc);

select pg_notify('pgrst', 'reload schema');
