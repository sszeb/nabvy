# worked-rtx-5080

The brief's first worked example, listing `2756686961383848` (card, "Tests and fixtures";
`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:13-16`): a "Gaming PC" whose RTX 5080 is named
in the description only. Synthetic, as in parts-record's case of the same name: the recorded run
holds neither worked example (`_rules.md`, rule 16), so the description is written to the brief's
facts over the recorded row `1783301919382894` (ask £2,500), with the brief's listing ID. Every
listing's point is Chichester, where the run searched (the injected `pointsFor` seam).

Expected: a want for the RTX 5080, by catalogue ID or by family, finds it inside a PC, quoted from
the description. The price criterion compares only asks in the want's currency: under a £3,000 cap
it matches, over a £2,000 cap it is `no_match`, and against a €3,000 cap it is `not_stated`, never
converted. A 10 km radius around London is `no_match` (about 90 km away, collection only). A want
for 32GB DDR5 and an RTX 4080 is `no_match` on the GPU: the full description names another card
(positive evidence over `full_verified` text). An RTX 3090 want stores nothing: no part matches.
