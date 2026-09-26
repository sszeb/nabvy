# price-change-cache

From recorded row `1775698700306989`. A second collected job a price change later (£150) keeps
the evidence hash (price is not in it), so replaying the batch is a cache hit: one model call in
total, the stored parts, and the same `extracted` event (`PARTS_INTELLIGENCE.md:249`).
