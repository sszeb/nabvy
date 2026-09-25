`trial` steps carry `category: null` (service messages, `src/domain/programmes.ts`): `day1` sends
even though the user has never granted marketing consent, because `decideStep` never calls
`canMarket()` for a null-category step. `day5` and `day7` are also evaluated (every step of a
matching trigger is checked) but are not yet due.
