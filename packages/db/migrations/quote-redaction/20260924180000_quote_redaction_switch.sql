-- quote-redaction: the switches module now exists (task 0.11), so switch_on() calls
-- switches.is_on() directly instead of checking whether that function exists first. Grants are
-- unchanged: CREATE OR REPLACE FUNCTION keeps them for an unchanged signature.
create or replace function quote_redaction.switch_on() returns boolean
language sql stable set search_path = '' as $$
  select switches.is_on('quote-redaction')
$$;
