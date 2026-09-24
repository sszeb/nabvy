create schema example;

create function example.foo(param text) returns void
language sql
set search_path = pg_catalog
as $$
  select 1
$$;

revoke all on function example.foo(int) from public;
