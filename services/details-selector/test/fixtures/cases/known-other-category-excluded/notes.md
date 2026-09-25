Synthetic: category ID `555555555555555` does not appear in any recorded run and stands in for a
known, unrelated Facebook category (e.g. furniture), since no recorded run happens to carry one
(the recorded run's own categories are all, despite their names, filed under "Electronics >
Computers", per `packages/config/src/modules/details-selector.ts`). A *known* category outside
`DETAILS_SELECTOR_IN_CATEGORY_IDS` excludes the listing even though it is in area — unlike a
missing (unknown) category, which always counts as in.
