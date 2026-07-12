-- Phase 46P: authenticated approval issuance surface metadata.
-- Reviewed SQL only. Apply manually after review.

alter table public.explicit_execution_approvals
  add column if not exists issued_by_user_id uuid,
  add column if not exists authority_basis text,
  add column if not exists issuance_route text;

update public.explicit_execution_approvals
set authority_basis = 'legacy_pre_46p'
where authority_basis is null;

update public.explicit_execution_approvals
set issuance_route = 'legacy_unknown'
where issuance_route is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'explicit_execution_approvals_authority_basis_check'
      and conrelid = 'public.explicit_execution_approvals'::regclass
  ) then
    alter table public.explicit_execution_approvals
      add constraint explicit_execution_approvals_authority_basis_check
      check (authority_basis in ('configured_commander_user_id', 'legacy_pre_46p'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'explicit_execution_approvals_issuance_route_check'
      and conrelid = 'public.explicit_execution_approvals'::regclass
  ) then
    alter table public.explicit_execution_approvals
      add constraint explicit_execution_approvals_issuance_route_check
      check (issuance_route in ('operator_approval_surface', 'legacy_unknown'));
  end if;
end $$;

create index if not exists explicit_execution_approvals_issued_by_user_id_idx
  on public.explicit_execution_approvals (issued_by_user_id);

select pg_notify('pgrst', 'reload schema');
