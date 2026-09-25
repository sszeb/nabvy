create schema example;
create table example.rows (id uuid primary key);
create or replace view
  example.v_rows
as select id from example.rows;
