# detail-price-drop (synthetic)

Built from the recorded run: a watched listing refreshed through the details queue. Listing
1072745435569624 (£450, displayed previous price £499) comes back from a details run at £400.
Expected: a `detail` observation, `card-changed`, the listing at 40000 and a `detail` row in
`v_price_changes` (actor-integration.md section 8, change 5). The displayed previous price stays a
raw fact (49900).
