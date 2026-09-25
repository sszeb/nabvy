# Open questions: noise-filter

- **2026-09-25, w2 noise-filter: the reason codes.** The card names the kinds of noise (wanted,
  swap and "I buy" adverts, service adverts, keyword stuffing, laptops, box-only listings,
  mention-only hits) without codes. Option taken: `wanted`, `buy_in`, `swap`, `laptop`,
  `box_only`, `mention_only`, `keyword_stuffing`, `service` (`NoiseFilterReason`). The wording
  each code shows to users, and whether each hides a listing or only marks it, is the owner's and
  `spec-match`'s (catalogue question 17). Conservative because the module stores codes only and
  shows no text.
- **2026-09-25, w2 noise-filter: which wanted words count.** parts-rules records the actor's broad
  `wantedTitle` (swap, trade, px, part ex, need a, want, £££) as `wanted_or_swap` signals, and
  parts-record's kind follows them. Option taken: a signal is a reason only when its quote is one
  of the narrow words of `docs/questions.md` (2026-09-24, 0.4: wanted, WTB, looking for, want to
  buy, I buy, we buy, I'm buying, buying your/all/any/broken, plus cash for your, sell me your);
  "buying", "cash for" and "cash paid" only when they open the title; a swap only when it opens
  the title or is followed by "for", and never beside a sale word (or, sale, sell, welcome,
  considered, ono...); any signal right after "no" or "not" is dropped. The kind
  `wanted_or_swap` alone is never a reason. Conservative because the broad words would hide
  "no swaps" and "part exchange welcome" sales, which the card and the pack forbid (`docs/packs/gpu-pc.md:63`).
- **2026-09-25, w2 noise-filter: description buy-in adverts.** The card counts the first 400
  characters of the description, but also says trader boilerplate inside a priced sale is not a
  buy-in advert, and every Facebook listing carries a price. Option taken: a description signal
  counts only in the description's first sentence (before any `.`, `!`, `?` or line break) and
  only when the title offers no part. Conservative because a trader's "We buy..." paragraph under
  a product title (recorded row 11) never counts.
- **2026-09-25, w2 noise-filter: mention-only with several search terms.** A listing found by
  "5080" and by "gaming pc" may only mention the 5080 but still be a real PC for the second
  search. The card's user-facing view carries reasons per listing, not per search. Option taken:
  `mention_only` (and `keyword_stuffing`) only when every found-by term names a model the listing
  only mentions (or finds only inside a tag block); a generic term, an offered part, or a term the
  rules cannot place keeps the listing. The per-term statuses are in `v_classifications.terms`
  for `spec-match` to use per want later. Conservative because it never hides a listing that one
  of its searches may still want.
- **2026-09-25, w2 noise-filter: not-a-PC is not a reason.** Recorded rows 11 and 12 are headsets
  found by "gaming pc". Option taken: noise-filter leaves the kind `not_a_pc` to `spec-match`
  (parts-record's kind is in `listing_assessment.v_assessments`), since a headset sale is a real
  offer, only not of a PC. Conservative because no listing is marked noise for what it is.
- **2026-09-25, w2 noise-filter: `v_suppressed` is not read by the handler.** The card lists
  `v_suppressed` among the inputs. Option taken: the handler classifies every listing, and the
  user-facing view leaves suppressed listings out through `listing_suppression.is_suppressed()`,
  as `docs/security.md` requires (`nabvy_app` has no grant on `v_suppressed`). Conservative
  because a suppression that expires or is lifted shows the listing with its reasons at once.
- **2026-09-25, w2 noise-filter: new found-by terms without a new assessment.** A later search
  can add a term to a listing without a new version, and no event reaches this module then.
  Option taken: the terms are read at classification time and are part of the input hash, so the
  next `listing-assessment.assessed` for the listing (or a sweep calling `classify`) records them;
  no listing-ingest event is consumed in this push. Conservative because nothing is marked on a
  term that was not read.
