# @nabvy/packs

Category packs as data, and the loader that validates them. First pack: `gpu-pc`
(`docs/packs/gpu-pc.md`). Task 0.4.

## Layout

```
packages/contracts/src/modules/packs.ts  CategoryPack format, part-patterns schema, RiskFlag,
                                         RiskRule, NoiseRule, GpuPcFacts (module `packs`, no events)
packages/packs/src/loader.ts           loadPack: validate, compile patterns, build the resolver
packages/packs/src/dictionary.ts       createResolver: text → dictionary product keys
packages/packs/gpu-pc/index.ts         assembles the pack from its data files and GpuPcFacts
packages/packs/gpu-pc/data/
  pack.json                   gate, noise, valuation, risk references, template, embedding model
  dictionary.json             product dictionary seed (149 entries)
  part-patterns.json          the actor's pattern file, byte for byte (see below)
  part-patterns.source.json   where it came from: repository, path, commit, sha256
packages/packs/test/fixtures/
  dictionary.fixtures.ts, aliases.json      stage `dictionary`: alias fixtures the dictionary resolves
  gate.fixtures.ts, gate-titles.json        stage `gate`: titles the gate and wanted_post must keep or drop
  pass-rates.json                           recorded run for `pnpm test:fixtures`
fixtures/contracts/packs/                   contract samples (valid and invalid)
```

`getPack('gpu-pc')` validates the pack once and returns it with compiled patterns
(`gate.passesTitle`, `noise`, `risk`, `resolve`). `loadPack` throws `PackValidationError`
listing every issue. Patterns are regex source strings compiled with the `i` flag, or references
into the part patterns (`{ "ref": "listingKind.wantedTitle" }`, `{ "ref": "fields.GPU model" }`);
unknown references fail validation.

The format lives in `@nabvy/contracts` because `docs/contracts.md` puts the pack format there,
in the per-module file `modules/packs.ts` (imported as `@nabvy/contracts/modules/packs`). Packs
are loaded in-process, so the module declares no events. `RiskFlag` and `GpuPcFacts` sit there
because the pack is their first user; if the risk or extraction module's contract needs them, they
move to the shared core by agreement with the coordinator (a contract file never imports another
module's file).

## part-patterns.json

Copied from `sebtimize/fb-scrap-engine`, `docs/data/part-patterns.json`, commit
`f177a4479f1fa24d773c4d95b0ec634915524948` (2026-09-24), the owner's reading list item 8
(`docs/fb-actor-sources.md`). Only that file was read from the actor repository. It is kept
unedited: Biome skips it, and a test checks its sha256 against `part-patterns.source.json`. To
update it, copy the new version and update the source note. It is validated by `PartPatterns`
(strict, so an upstream shape change fails loudly) and loaded as `rules.partPatterns`; every
`gpuModels` entry must name a dictionary family.

## Decisions

**The format goes beyond the build pack's** (now updated in `docs/contracts.md`) where the pack
needed it: regexes are strings or references (a pack is data); `currency` names the currency of
every amount (GBP and EUR groups are never mixed); `rules` holds the part patterns and their
source; `noise` lists the brief's noise rules, each in `shadow` or `filter` mode; each risk
reference has an `action` (`weight`, `drop` or `internal`) plus optional `patterns` and `params`;
dictionary entries carry `family`, `vramGb`, `patterns` and `cexBoxIds`; valuation carries the
fixed bundle allowance, fixed fee, postage by item type and expected repair by condition;
`detailFetchAll` may name categories; `explanation` pairs the template with `displayable`.

**Where the brief and `docs/packs/gpu-pc.md` disagree, the brief wins** (`docs/decisions.md`,
"Precedence"):

- *Seller-derived flags.* `new_seller` and `reused_photos` are `internal`: recorded only in the
  restricted store, never in a public table or a public score. The schema refuses them as
  `weight` or `drop`. Their build-pack weights are kept as `shadowWeight` for internal analysis.
  They stay inert until the internal seller key exists, which comes only after the DPIA
  (Precedence, "Seller data").
- *Photos.* `stock_photo` is narrowed to listing-level evidence (`stock_photo_known_image`: the
  photo matches a known stock image); matching another seller's listing is the internal
  `reused_photos` rule. It needs photo fingerprints, and the brief limits photo review to listings
  whose text is silent, so it is `internal` too until the owner answers `docs/questions.md`.
- *Noise.* The six rules of the brief's free noise filter are referenced: wanted, swap and
  "I buy" adverts (the actor's `wantedTitle` and `wantedDescriptionFirst400Chars`), keyword
  stuffing and mention-only hits (the `GPU model` and `CPU model` fields feed rules in the noise
  module), and laptops (`laptopTitle`). All run in `shadow` mode: the actor's patterns were never
  measured for precision, and `wantedTitle` also matches ordinary sale adverts ("no swaps",
  "px considered", "trade in welcome", "need a quick sale", "want gone", "£££"). A rule moves
  to `filter` only when fixtures show its precision.
- *Destructive rules stay narrow.* The gate exclude and the `wanted_post` drop use a narrow
  wanted pattern (wanted, looking for, WTB, want to buy, "I buy", "we buy", "I'm buying",
  "buying your/all/any/broken"), in the spirit of the build pack's, and the gate excludes laptops
  only by the words laptop, notebook, MacBook and Chromebook (the actor's `laptopTitle` would also
  drop "Legion T5" desktops). The `gate` fixture stage proves that sale adverts mentioning swaps,
  part exchange, trade-ins or need survive both. The build pack's accessory words (monitor,
  chair, desk, mouse, keyboard, headset, controller) are dropped from the gate because they threw
  out PC bundles sold with peripherals, and `for parts|spares or repairs` because it contradicts
  the pack's own `parts_only` flag and `faulty` multiplier. `box only|empty box` stays. Recorded
  in `docs/questions.md`.
- *Title gate, include.* The build pack's regex is kept and joined by the actor's `GPU model`
  field and `cpuOrPcTitle`, so bare model numbers ("3080 ti"), Arc B-series cards and prebuilt
  office towers get through.
- *GPU matching.* The actor's `gpuModels` patterns are merged into their dictionary families, and
  "OptiPlex 3080/3090" strings are blanked before matching, as the file's note says.
- *Mining.* The build pack's bare `rig` becomes `mining rig`: the actor's `pcTitle` treats "rig" as
  a PC ("gaming rig").
- *Explanation.* The bundle explanation ("Parts are worth about £{partOutTotal} together") is left
  out: the brief puts part-out maths later and says an asks-based sum is not a worth. The main
  template loses "Similar {product} sold for £{low}–£{high}" (asks are never presented as sale
  prices) and "({dealScore}/100)" (no unexplained score), and is `displayable: false` until the
  owner approves wording (`docs/questions.md`).
- *Part-out parameters.* The bundle haircut and fixed allowance stay in the pack for the later
  part-out feature; valuation must not use them until standalone part prices exist
  (Precedence, "Part-out maths").
- *eBay fees.* `feePct` 0.129 and the 30p fixed fee are the build pack's, still marked "confirm
  against eBay's current UK fee schedule" (`docs/questions.md`).

**Dictionary.** Keys follow `gpu:<vendor>:<model>:<vram>`. VRAM variants are separate keys, as
`docs/packs/gpu-pc.md` asks; the seed was extended where a model ships in two sizes (RTX 3050 6/8,
2060 6/12, RX 9060 XT 8/16, 5500 XT 4/8, 570 4/8, Arc A770 8/16). A family with variants resolves
to a key only when the VRAM is written next to the model; otherwise the match carries the
candidates and a null key, never a guess. Spaces and hyphens in aliases are optional; a match
must not touch a letter or digit on either side or follow a currency sign ("£1070" is a price).
Plain AMD models (RX 7600, 6800 ...) have no bare-number alias because those numbers are also Intel
and Ryzen CPUs; three-digit models need their prefix (RX 580, Vega 56). Where matches overlap the
longest wins ("3080 ti" over "3080"). CPUs are families, as the seed lists them:
`cpu:intel:core-i7-gen12`, `cpu:intel:core-ultra-7`, `cpu:amd:ryzen-7-5000`,
`cpu:amd:threadripper`.

**Not set by the build pack:** postage for items other than a card or a PC (the valuation module
must treat it as unknown), and expected repair for `new` and `unknown`. `detailFetchAll` names the
category `computers`; the adapter maps it to each source's category ID.

**Fixture stages.** `dictionary` (alias fixtures) and `gate` (titles and the `wanted_post` drop)
run under `pnpm test:fixtures` with their recorded rates in `test/fixtures/pass-rates.json`. Add a
case when a listing uses a new spelling or the gate gets one wrong.

**Known limit:** `hydro` in the mining rule also matches water-cooled cards and coolers; it is a
weight, not a drop, and stays as the build pack wrote it until fixtures measure it.
