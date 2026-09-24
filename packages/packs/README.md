# @nabvy/packs

Category packs as data, and the loader that validates them. First pack: `gpu-pc`
(`docs/packs/gpu-pc.md`). Task 0.4.

## Layout

```
packages/contracts/src/pack.ts        CategoryPack format (Zod), part-patterns schema, RiskRule
packages/contracts/src/facts/gpu-pc.ts GpuPcFacts, the pack's fact template
packages/packs/src/loader.ts           loadPack: validate, compile patterns, build the resolver
packages/packs/src/dictionary.ts       createResolver: text → dictionary product keys
packages/packs/gpu-pc/index.ts         assembles the pack from its data files and GpuPcFacts
packages/packs/gpu-pc/data/
  pack.json                   gate, noise, valuation, risk references, template, embedding model
  dictionary.json             product dictionary seed (149 entries)
  part-patterns.json          the actor's pattern file, byte for byte (see below)
  part-patterns.source.json   where it came from: repository, path, commit, sha256
fixtures/packs/gpu-pc/aliases.json      alias fixtures the dictionary must resolve
```

`getPack('gpu-pc')` validates the pack once and returns it with compiled patterns
(`gate.passesTitle`, `noise`, `risk`, `resolve`). `loadPack` throws `PackValidationError`
listing every issue. Patterns are regex source strings compiled with the `i` flag, or references
into the part patterns (`{ "ref": "listingKind.wantedTitle" }`, `{ "ref": "fields.GPU model" }`);
unknown references fail validation.

The format lives in `@nabvy/contracts` because `docs/contracts.md` puts the pack format there.
Task 0.2 keeps `enums.ts`, `pack.ts` and `facts/gpu-pc.ts` and adds the rest beside them.

## part-patterns.json

Copied from `sebtimize/fb-scrap-engine`, `docs/data/part-patterns.json`, commit
`f177a4479f1fa24d773c4d95b0ec634915524948` (2026-09-24), the owner's reading list item 8
(`docs/fb-actor-sources.md`). Only that file was read from the actor repository. It is kept
unedited: Biome skips it, and a test checks its sha256 against `part-patterns.source.json`. To
update it, copy the new version and update the source note. It is validated by `PartPatterns`
(strict, so an upstream shape change fails loudly) and loaded as `rules.partPatterns`; every
`gpuModels` entry must name a dictionary family.

## Decisions

**The format goes beyond `docs/contracts.md`** where the pack needed it: regexes are strings or
references (a pack is data); `rules` holds the part patterns and their source; `noise` lists the
brief's noise rules; each risk reference has an `action` (`weight`, `drop` or `internal`) plus
optional `patterns` and `params`; dictionary entries carry `family`, `vramGb`, `patterns` and
`cexBoxIds`; valuation carries the fixed bundle allowance, fixed fee, postage by item type and
expected repair by condition; `detailFetchAll` may name categories.

**Where the brief and `docs/packs/gpu-pc.md` disagree, the brief wins** (`docs/decisions.md`,
"Precedence"):

- *Seller-derived flags.* `new_seller` and `reused_photos` are `internal`: recorded only in the
  restricted store, never in a public table or a public score. The schema refuses them as
  `weight` or `drop`. Their build-pack weights are kept as `shadowWeight` for internal analysis.
  `stock_photo` is narrowed to listing-level evidence (`stock_photo_known_image`: the photo matches
  a known stock image); matching another seller's listing is the internal `reused_photos` rule.
- *Noise.* The six rules of the brief's free noise filter are referenced: wanted, swap and
  "I buy" adverts (the actor's `wantedTitle` and `wantedDescriptionFirst400Chars`), keyword
  stuffing and mention-only hits (the `GPU model` and `CPU model` fields feed rules in the noise
  module), and laptops (`laptopTitle`).
- *Title gate, exclude.* The build pack's `wanted|looking for|wtb` and `laptop` are replaced by the
  actor's `wantedTitle` and `laptopTitle`. Its accessory words (monitor, chair, desk, mouse,
  keyboard, headset, controller) are dropped: they threw out PC bundles sold with peripherals,
  and the brief classifies those by listing kind (`notAPcTitle`, kept in the rules) instead of
  discarding them. `for parts|spares or repairs` is dropped from the gate too: it contradicts the
  build pack's own `parts_only` risk flag and `faulty` multiplier, and the brief's noise list does
  not include it. `box only|empty box` stays.
- *Title gate, include.* The build pack's regex is kept and joined by the actor's `GPU model`
  field and `cpuOrPcTitle`, so bare model numbers ("3080 ti"), Arc B-series cards and prebuilt
  office towers get through.
- *GPU matching.* The actor's `gpuModels` patterns are merged into their dictionary families, and
  "OptiPlex 3080/3090" strings are blanked before matching, as the file's note says.
- *Mining.* The build pack's bare `rig` becomes `mining rig`: the actor's `pcTitle` treats "rig" as
  a PC ("gaming rig").
- *Part-out.* The bundle explanation ("Parts are worth about £{partOutTotal} together") is left out:
  the brief puts part-out maths later and says an asks-based sum is not a worth. The bundle haircut
  and fixed allowance stay as parameters for that later feature.

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

**Known limits, for the fixture runs (0.6, 1.4):** the actor's `wantedTitle` also matches phrases
like "no swaps" and "trade in", which would drop real sale adverts; its precision was never
measured. `hydro` in the mining rule also matches water-cooled cards and coolers. Both are kept as
written until fixtures measure them.
