# watch-price-rise-no-alert (synthetic)

Listing 1816901372840238, watched, re-collected at a higher price (£200 -> £250). `card-changed`
fires and the handler runs, but `isDrop()` refuses a rise: nothing is written to `drops` and
nothing is announced. Only a fall is ever a "drop" (README.md, "Rules").
