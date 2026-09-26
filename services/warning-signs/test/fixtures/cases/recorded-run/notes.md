# recorded-run

The whole recorded run `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k` (20
listings, every description `full_verified`), seeded with its titles, descriptions and asks, no
index groups (no group reaches n = 10 on 20 rows) and no assessment cautions. Expected, as the
too-good-to-be-true design §2.4 gives it:

- Row 1 (1816901372840238), "cash or bank transfer on pickup" (dataset.json:139): payment on
  collection (X1), never pay-first.
- Row 3 (1716871313386322), "relocating abroad" and "welcome to test" (dataset.json:874): the away
  story (W1, the design's counter-example) and viewing offered (X1).
- Row 4 (1123980543398026), "Sold as seen, any tests welcome" (dataset.json:1173): untested and
  viewing offered.
- Row 7 (1783301919382894), "arrange a viewing/test": viewing offered.
- Row 11 (2126837844711748), the trade "We buy and part-exchange" advert with "7-day
  return/warranty on all purchases" (dataset.json:3722): stock phrasing only; its "working or
  faulty" and "if something doesn't work" are not this item's state; "Local delivery available"
  adds an option and is no fact.
- Row 14 (1403975981250476), "cash on pickup" and "Happy to power it on": payment on collection
  and viewing offered.
- Row 18 (1397200465308431), "No Scammers", "@ BACK PANEL" (dataset.json:6135): nothing.
- Row 20 (2537899006714740), the £25 repair service: nothing here (noise-filter's `service`).
- Every other row: nothing. X1 fires on exactly rows 1, 3, 4, 7 and 14, as the design counts.
