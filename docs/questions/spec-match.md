# Open questions: spec-match

- **2026-09-26, w2 spec-match: which pairs are stored and shown.** The card says silence is never
  a "no" and a missing part shows as "GPU not stated — ask the seller", but not whether every
  listing that states none of a want's parts is a result. Option taken: a want and listing pair
  is stored only once a part criterion matches or is partly named (for example 16GB RAM with no
  generation against "16GB DDR5"); after that it is re-matched on every new input, so a later
  "no" is recorded. A PC that names no wanted part is not a result, never a `no_match`.
  Conservative because it shows nothing the listing does not name, and never records silence as
  a "no".
- **2026-09-26, w2 spec-match: PC containment.** want-manager stores `pcContainment` ("PC
  containment off by default", per-hunt alternative controls) while this card matches parts inside
  PCs and shows them in a collapsed "inside a PC" section. Option taken: spec-match always matches
  containers and marks each result `insidePc`; `pcContainment` is left to `alert-router` (whether
  an inside-a-PC match alerts). Conservative because it hides nothing in-app and sends nothing.
- **2026-09-26, w2 spec-match: "or better".** No dependency publishes a catalogue ranking, so an
  "or better" criterion cannot tell a better card from a worse one. Option taken: the named item
  and its variants match; any other included card of the type is `not_stated` (`ambiguous`),
  never a match and never a "no". To revisit when product-catalogue ranks items.
- **2026-09-26, w2 spec-match: the verdict values.** The card fixes `match`, `no_match` and
  `not_stated` per criterion. Option taken: the whole verdict uses the same three values (any
  `no_match` wins; all `match` is `match`; else `not_stated`), and the user-facing view leaves
  out `no_match` verdicts. Wording shown to users ("GPU not stated — ask the seller") stays the
  owner's; the module stores reason codes only.
- **2026-09-26, w2 spec-match: posting.** Facebook's delivery vocabulary for a seller who posts
  is not in the recorded run (only IN_PERSON, PUBLIC_MEETUP, DOOR_PICKUP, DOOR_DROPOFF). Option
  taken: `SHIPPING`, `SHIPPING_ONSITE` and `SHIPPING_OFFSITE` count as posting
  (`packages/config/src/modules/spec-match.ts`), a starting value to verify on a run that holds a
  posted listing. A want that accepts posting then matches a posting listing at any distance.
- **2026-09-26, w2 spec-match: condition filter.** The search takes the owner's condition filter,
  but no dependency publishes a listing's condition (detail-evidence is not on the card's
  "Depends on" line). Option taken: the filter is accepted and not applied (every listing keeps
  its place) until a dependency publishes condition. Conservative because it hides nothing on a
  guess.
- **2026-09-26, w2 spec-match: soft seams.** `app.v_copy_advert_flags` (copy-advert task 1.7c),
  `app.v_multi_quantity_filter_flags` (multi-quantity-filter) and `v_positions`
  (asking-price-position) do not exist yet, and pickup-location is soft. Option taken: each is an
  injected function (`spamFlags`, `multiQuantityFlags`, `positions`, `pointsFor`) whose stub
  returns no data: nothing hidden as spam or multi-quantity, every position sorts last, and every
  distance is `not_stated` until the task wiring passes pickup-location's `pointsFor`.
- **2026-09-26, w2 spec-match: worth-the-trip hints.** The card computes them in shadow only until
  their travel cost and wording are set (`actor-integration.md` question 16). Option taken: not
  computed at all yet: there is no travel cost to compute with, and inventing one would be an
  invented number.
- **2026-09-26, w2 spec-match: match origin.** `own_search` is read as: a search sighting of the
  listing whose centres include the want's centre and whose terms name one of the want's parts
  (its family or catalogue model). Otherwise `other_search`.
- **2026-09-26, w2 spec-match: where search runs.** Spec search reads only shared internal views,
  which `nabvy_app` cannot read. Option taken: `search()` runs inside `withPipeline` after the
  procedure has checked the session, and checks the account's standing itself; `results()` (the
  user's own matches) runs inside `withUser` over `app.v_spec_match_results`.
