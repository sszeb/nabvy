# invalid-output

Synthetic, from recorded row `1380502417485603`. The recorded response carries a `price` key in
a part, which the strict schema refuses (no prices in model output): quarantined as
`invalid_output`. The second step replays the batch: the call is not made again (one call in
total, `cached: 1`): no retry on invalid output (the brief).
