-- Phase 31: read-only schema catalog RPC for War Room Schema Sweep (optional).
-- Apply manually in Supabase SQL editor. No browser execution.

create or replace function public.war_room_introspect_catalog()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tables',
      coalesce(
        (select jsonb_agg(t.table_name order by t.table_name)
         from information_schema.tables t
         where t.table_schema = 'public' and t.table_type = 'BASE TABLE'),
        '[]'::jsonb
      ),
    'columns',
      coalesce(
        (select jsonb_agg(
           jsonb_build_object('table_name', c.table_name, 'column_name', c.column_name)
           order by c.table_name, c.column_name
         )
         from information_schema.columns c
         where c.table_schema = 'public'),
        '[]'::jsonb
      ),
    'indexes',
      coalesce(
        (select jsonb_agg(i.indexname order by i.indexname)
         from pg_indexes i
         where i.schemaname = 'public'),
        '[]'::jsonb
      ),
    'constraints',
      coalesce(
        (select jsonb_agg(con.conname order by con.conname)
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace nsp on nsp.oid = rel.relnamespace
         where nsp.nspname = 'public'),
        '[]'::jsonb
      )
  );
$$;

revoke all on function public.war_room_introspect_catalog() from public;
grant execute on function public.war_room_introspect_catalog() to service_role;
