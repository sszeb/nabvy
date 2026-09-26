# worked-pc-5060

The brief's second worked example, listing `29056633657273875`, titled "Pc", with an RTX 5060 in
the description only (`fb-scrap-engine/docs/design/CONTAINER_LISTINGS.md:6-9`). Synthetic over the
recorded row `2264485254402498`, as in parts-record's case of the same name: the title cut to "Pc"
and the specs moved to the description.

Expected: an RTX 5060 want matches it inside a PC. Adding "32GB RAM" makes it `no_match`: the full
description states 16GB. A "16GB DDR5" want is `not_stated` (`partly_named`): 16GB is named, the
generation is not, so it shows as "ask the seller" rather than a "no".
