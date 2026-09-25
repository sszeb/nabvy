Requested by city-pages' own review (rule 16: "at least one reader's fixtures still pass with this
module off"; city-pages could not meet it because details-selector did not exist yet). With
`city-pages` off, `city_pages.v_area_membership` is switch-filtered to no rows (rule 11), so every
listing's area fact is unknown here, never "in area". Unlike an unknown *category* (which counts as
in, per the card), an unknown *area* is this module's conservative default: it never selects,
because selection triggers a paid detail fetch (docs/questions/details-selector.md). The row is
otherwise identical to `bare-title-in-area` (same city page, which is in area when city-pages is
on), so this case isolates the effect of the switch.
