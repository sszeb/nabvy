create function unsafe() returns void
language sql
as $$
  select 1
$$;
