create table if not exists public.war_room_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  source_context text not null default 'war-room',
  uploaded_at timestamptz not null default now(),
  tags text[] not null default '{}',
  status text not null default 'uploaded'
    check (status in ('uploaded', 'indexed', 'error')),
  notes text not null default ''
);

create index if not exists war_room_files_uploaded_at_idx
  on public.war_room_files (uploaded_at desc);

create index if not exists war_room_files_status_idx
  on public.war_room_files (status);

alter table public.war_room_files enable row level security;

-- The app uses server-side API routes with SUPABASE_SERVICE_ROLE_KEY.
-- No anon RLS policy is required for this foundation.
--
-- Optional storage bucket setup:
-- insert into storage.buckets (id, name, public)
-- values ('War Room Files', 'War Room Files', false)
-- on conflict (id) do nothing;
