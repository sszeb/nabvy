// Event handlers. city-pages consumes no events (docs/design/modules/city-pages.md, "Inputs":
// the seed, listing-ingest's v_city_pages_seen, run-coverage's v_search_controls, and admin
// verification). `reconcileSeen` is called by an ops job, and `verify` by an admin action; both
// are plain exported functions in '../index', as switches' `set()` is (open question in
// docs/questions/city-pages.md: which scheduler calls reconcileSeen).
export {}
