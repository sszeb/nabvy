# apify-settle-differs

Synthetic, built from the recorded run's amounts. Once settled, a second settlement with another
amount is refused and the first stands ("a settlement replaces the reservation once"); recording
the run again writes nothing (idempotent on provider and ref_id).
