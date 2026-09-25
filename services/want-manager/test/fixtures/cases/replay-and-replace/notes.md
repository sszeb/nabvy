# replay-and-replace

No entitlement row and subscriptions on: the real `getEntitlement` Free fallback applies (1 want),
so one want is enough. A replay with the same content (postcode spelled differently) writes nothing
(rule 8, docs/design/modules/_rules.md). Replacing the postcode and criteria moves the want to
Redhill and swaps the term to the CPU family; the old criteria go with it (`parts` is 1). A want
ID the user does not own is `not_found`. No entitlement means the want is not paid.
