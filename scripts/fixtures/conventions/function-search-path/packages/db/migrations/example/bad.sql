create schema example;
create function example.unsafe() returns void
language sql
as $$
  select 1
$$;
