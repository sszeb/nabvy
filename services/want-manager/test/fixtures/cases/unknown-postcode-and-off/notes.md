# unknown-postcode-and-off

A postcode `location` does not know is refused (`postcode_unknown`) and writes nothing. A want
with only a sized part (1 TB storage) is stored and appears in `v_want_parts` and `v_want_areas`,
but names no search term, so `v_want_terms_by_centre` is empty (the family fallback chain is
criterion family, catalogue family, catalogue ID; a sized part has none).
