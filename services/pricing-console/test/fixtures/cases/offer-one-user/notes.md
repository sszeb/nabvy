# offer-one-user

A 10% offer on live lookups made for user A. A pays 14 credits (15 less 10%, rounded up, above
the floor of 10). User B pays the list 15, whether priced inside B's own session (row-level
security hides A's offer row) or by the pipeline (the offer's target does not match).
