# low-ask

Synthetic asks in one index group (n = 12, median £600), and one group of n = 9:

1. A cheap ask explained by fault wording is not flagged (the card's test): only
   `low_ask_explained:named_fault`.
2. Swap wording is recorded and never explains a low ask (design P notes).
3. Exactly 0.6 × the median is far below (the boundary).
4. Just above 0.6 × is not.
5. A group of n = 9 is never compared (`docs/decisions.md:15`).
6. An outlier-excluded ask is compared: the outlier cut is the cheap ask this rule looks for.
7. A sold ask is not compared.
8. listing-assessment's `box_only` caution: the `box_only` fact, and it explains the low ask.
9. listing-assessment's "no GPU" exclusion (no part row): a core part missing.
10. Trader boilerplate "working or faulty" names no fault of this item (dataset.json:3722).
11. "Spares or repairs": for parts, a material state; "will not boot" is negated wording and
    names nothing on its own here.
12. Cosmetic and offers wording are recorded and never explain a low ask.

The survivor-bias pattern (cheap GPUs still listed are older, 45.9 days against 24.7;
PARTS_INTELLIGENCE.md:283-285) is kept for shadow analysis only: no rule reads how long a
listing has been up.
