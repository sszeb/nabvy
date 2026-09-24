# two-terms (synthetic)

`docs/backlog.md` 1.3a: "a listing found by two terms carries both origins". Built from the
recorded run. Run 1 appends a second row for listing 1816901372840238, found by "gaming computer"
from centre 106078429431815 (a second search in the same run). Run 2 is the recorded page again,
with that listing's found-by terms set to "gaming tower".

Expected: run 1 writes one sighting for the listing (one per card per run) carrying both terms and
both centres, ranked by its first row; the listing's found-by terms are the union across runs, in
the order first seen. No `card-changed`: the card itself did not change. The fixture query reads
the first run's sighting (ordered by seen time, then job).
