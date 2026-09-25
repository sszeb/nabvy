# not-included-gpu

A part named and expressly not included: "RTX 3070 not included, it goes in my new build".
Synthetic over the recorded row `1380502417485603` (whose own text excludes only accessories).
The rules read the card as `not_included` (their context rule), which leaves the GPU open
(`mention_only`), so parts-ai is asked and the recorded model reads the same span as
`not_included`. Expected: two GPU rows, both `not_included`, no conflict (a part that is not
offered never conflicts); the CPU, RAM and storage `offered`; both versions on the record.
