-- Phase 46N permission patch for ExplicitExecutionApproval authority.
--
-- The table is server-only. War Room API/runtime code uses the Supabase
-- service_role key through lib/supabase/admin.ts. No anon/client policies are
-- required or granted here.

grant select, insert, update, delete on table public.explicit_execution_approvals to service_role;

select pg_notify('pgrst', 'reload schema');
