create function public.bar() returns void
language sql
set search_path = pg_catalog
as $$
  select 1
$$;

revoke all on function public.bar() from admin_role;
