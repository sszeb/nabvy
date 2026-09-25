create schema example;
create table example.rows (id uuid primary key);
create view example.v_rows as select id from example.rows;
