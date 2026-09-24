# named-listing

The card's test "a suppressed listing never reaches an `app` view"
(fb-scrap-engine/docs/design/SELLER_DATA.md:131-133,328). The recorded run is ingested and recorded;
a request names row 0 (`1816901372840238`). Three entries: its listing hash, and look-alikes on its
card and on its current description. Row 0 is hidden (by its hash and by its own look-alikes), the
other 19 are not: no two recorded rows share a title and price or a description. The sample
user-facing view shows 19 rows.
