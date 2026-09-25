A synthetic ID (not a real Facebook city page) seen twice in one batch, with different town
labels, is only ever added once, keyed on the first row's label: `insertCardCityPages`'s own
primary key would also stop a second insert, but `newCityPagesFrom` de-duplicates before the
database ever sees it, so the returned `city-pages.changed` batch never repeats an ID either.
