-- Phase 26: authoritative published_at + freshness columns for signal results.
-- Safe backfill and archival marking; no row deletes.

alter table public.war_room_signal_results
  add column if not exists published_at timestamptz,
  add column if not exists source_status text,
  add column if not exists freshness_status text,
  add column if not exists operational_status text;

update public.war_room_signal_results
set published_at = coalesce(
  published_at,
  nullif(metadata->>'publishedAt', '')::timestamptz,
  nullif(metadata->>'webPublicationDate', '')::timestamptz,
  nullif(metadata->>'pubDate', '')::timestamptz,
  captured_at
)
where published_at is null;

update public.war_room_signal_results
set
  freshness_status = case
    when published_at is null then 'UNKNOWN_DATE'
    when published_at >= now() - interval '7 days' then 'LIVE'
    when published_at >= now() - interval '30 days' then 'RECENT'
    else 'ARCHIVAL'
  end,
  source_status = coalesce(
    source_status,
    case
      when provider in ('guardian', 'newsapi', 'rss') then 'VERIFIED'
      when provider in ('tavily', 'firecrawl') then 'UNVERIFIED'
      else 'UNKNOWN'
    end
  ),
  operational_status = case
    when published_at is null then 'EXCLUDED'
    when published_at < now() - interval '30 days' then 'EXCLUDED'
    else coalesce(operational_status, 'ACTIONABLE')
  end
where freshness_status is null
   or operational_status is null
   or (published_at < now() - interval '30 days' and operational_status <> 'EXCLUDED');

-- Drop legacy partial index if a prior run created it (volatile now() predicate is invalid).
drop index if exists public.war_room_signal_results_published_active_idx;

-- Plain btree indexes; 30-day active window is enforced in application queries.
create index if not exists war_room_signal_results_published_at_idx
  on public.war_room_signal_results (published_at desc);

create index if not exists war_room_signal_results_operational_status_idx
  on public.war_room_signal_results (operational_status);

create index if not exists war_room_signal_results_freshness_status_idx
  on public.war_room_signal_results (freshness_status);

create index if not exists war_room_signal_results_provider_idx
  on public.war_room_signal_results (provider);

create index if not exists war_room_signal_results_active_query_idx
  on public.war_room_signal_results (operational_status, published_at desc, highest_leverage_score desc);
