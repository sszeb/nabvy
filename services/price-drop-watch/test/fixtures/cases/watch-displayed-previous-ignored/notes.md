# watch-displayed-previous-ignored (recorded)

Listing 1072745435569624 in the recorded run asks £450 while the seller's own "previous price"
field (`conflicts[0].detailValue.displayedPreviousPrice`, dataset.json) shows £499 — the exact
case the card cites: "the recorded listing asking £450 with a displayed previous price of £499".
The listing is watched, then re-collected with only its title changed (a real `card-changed`), so
the handler genuinely runs. It never reads `displayedPreviousMinor`: `listing_ingest.v_price_changes`
compares only actually observed prices, and this listing's own price never moves, so nothing is
written or announced. The seller's displayed figure never becomes a "drop".
