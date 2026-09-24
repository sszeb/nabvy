# detail-observation (synthetic)

Built from the recorded run: a details run of the same 20 listings (input `listingIds`), so the
rows carry no `sourceFields.search`, source URL or terms, and each `money.rawAmount` and `display`
is rewritten (e.g. "£200" for "200.00"), as the actor does for the displayed previous price
(dataset.json:1464-1482). Expected: 20 `detail` observations and no new feed sightings; values
compared on `amountMinor` and currency, so no `card-changed` and no price change; the card title
and primary photo are kept, so the card hash does not move.
