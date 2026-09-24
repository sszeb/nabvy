# Category pack: gpu-pc

Pack `gpu-pc`, version 1. Implements the `CategoryPack` format in `docs/contracts.md`. Lives in `packages/packs/gpu-pc/` as data files plus the Zod fact template.

## Scope

Graphics cards (standalone), gaming and workstation desktops (bundles), and the components that make up a PC when listed alone (CPU, RAM, storage, PSU, case). Laptops are a later pack.

## Gate rules

- **Include (title, case-insensitive):** `\b(rtx|gtx|radeon|rx ?\d{4}|arc a\d{3}|geforce|graphics card|gpu|gaming pc|gaming computer|desktop pc|custom (built )?pc|pc build|tower|workstation|ryzen|core i[3579]|i[3579]-\d{4,5})\b`
- **Exclude (title):** `\b(wanted|looking for|wtb|box only|empty box|case only|for parts|spares or repairs|laptop|monitor|chair|desk|mouse|keyboard|headset|controller)\b`
- **Price band:** minimum £5; no maximum.
- **detailFetchAll:** true for listings from the computers category; title-gated otherwise.

## Fact template

`GpuPcFacts` in `docs/contracts.md`. Rules tier fills `gpu.model`, `gpu.vramGb`, `cpu.model`, `ramGb`, `mentionsMining`, `mentionsDeposit`, `wantedPost`, `partsOnly`, `emptyBox` from the dictionary regexes before any model call.

## Product dictionary (seed; extend from data)

Product keys follow `gpu:<vendor>:<model>:<vram>` and `cpu:<vendor>:<model>`. Aliases include common typos and spacing variants ("rtx3080", "3080ti", "3080 ti"). Fill `eans` and `cexBoxIds` from CeX lookups as they are seen.

**NVIDIA:** RTX 5090, 5080, 5070 Ti, 5070, 5060 Ti (8/16 GB), 5060; RTX 4090, 4080 Super, 4080, 4070 Ti Super, 4070 Ti, 4070 Super, 4070, 4060 Ti (8/16 GB), 4060; RTX 3090 Ti, 3090, 3080 Ti, 3080 (10/12 GB), 3070 Ti, 3070, 3060 Ti, 3060 (8/12 GB), 3050; RTX 2080 Ti, 2080 Super, 2080, 2070 Super, 2070, 2060 Super, 2060; GTX 1660 Ti, 1660 Super, 1660, 1650 Super, 1650, 1080 Ti, 1080, 1070 Ti, 1070, 1060 (3/6 GB), 1050 Ti, 1050.
**AMD:** RX 9070 XT, 9070, 9060 XT; RX 7900 XTX, 7900 XT, 7900 GRE, 7800 XT, 7700 XT, 7600 XT, 7600; RX 6950 XT, 6900 XT, 6800 XT, 6800, 6750 XT, 6700 XT, 6700, 6650 XT, 6600 XT, 6600, 6500 XT; RX 5700 XT, 5700, 5600 XT, 5500 XT; Vega 64, Vega 56; RX 580 (4/8 GB), 570.
**Intel:** Arc B580, B570, A770, A750, A580, A380.
**CPUs (families, for bundles):** Intel Core i3/i5/i7/i9 8th–14th gen and Core Ultra; AMD Ryzen 3/5/7/9 2000–9000 series, Threadripper.

## Valuation parameters

- Condition multipliers: `new` 1.10, `used_working` 1.00, `untested` 0.70, `faulty` 0.35, `unknown` 0.85.
- Bundle haircut 0.15; bundle fixed allowance £60 for case, PSU, motherboard and assembly when those components are unpriced.
- Fees: `feePct` 0.129, `feeFixed` 30p (confirm against eBay's current UK fee schedule); postage £8 for a card, £25 for a PC; travel 25p per km each way; expected repair £0 for `used_working`, £40 for `untested`, £120 for `faulty`.
- Variant adjustments: VRAM variants priced as separate product keys; "Ti" and "Super" as separate keys.

## Risk rules

| Flag | Test | Weight |
| --- | --- | --- |
| `mining` | description or title contains mining, hashrate, rig, hydro, LHR-unlocked | 0.15 |
| `untested` | condition `untested` or text "untested", "no way to test", "sold as seen" | 0.10 |
| `stock_photo` | first photo fingerprint matches a known stock image or another seller's listing | 0.20 |
| `reused_photos` | fingerprint seen across 3+ listings by different seller hashes | 0.20 |
| `deposit_request` | text asks for deposit, bank transfer, "hold", "delivery only, pay first" | 0.30 |
| `new_seller` | seller hash first seen within 7 days and no other listings | 0.15 |
| `price_far_below_floor` | asking < 50% of value band low | 0.35 |
| `parts_only` | text "for parts", "spares or repairs", "not working" | 0.10 |
| `wanted_post` | title matches the wanted pattern | drop |
| `empty_box` | title or text "box only", "empty box" | drop |

## Explanation template

"Asking £{ask} for {itemSummary}. Similar {product} sold for £{low}–£{high} in the last 90 days (median £{mid}, {trend}). CeX pays £{cexCash} cash. After eBay fees and {collectionOrPostage}, expected margin £{margin} ({dealScore}/100). {flagsSentence}"

For bundles: "{itemSummary} contains {componentList}. Parts are worth about £{partOutTotal} together; the whole PC is asking £{ask}."

## Embedding model

`Xenova/clip-vit-base-patch32` via transformers.js for photo embeddings (512-d); text similarity via pg_trgm on titles and aliases.

## Acceptance for this pack

On the fixture set: gate precision ≥ 90% (share of gated-in listings that are relevant); extraction fills `gpu.model` correctly on ≥ 85% of GPU and PC listings; hidden-GPU detection (GPU only in the description) ≥ 80%; risk rules produce no false `wanted_post` or `empty_box` drops.
