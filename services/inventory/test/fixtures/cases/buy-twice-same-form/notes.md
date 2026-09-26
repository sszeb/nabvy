The same purchase form submitted twice (a retry, a double tap) is one item: the client's item ID is the idempotency key (rule 8). The second call reports the item already exists and writes nothing.
