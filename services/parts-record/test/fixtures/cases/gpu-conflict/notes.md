# gpu-conflict

The inputs disagree about the card: the title says "RTX 3080 Ti", the description "RTX 3080
graphics card" (a family the catalogue holds in two variants, so that hit stays unresolved). The
rules leave the GPU open as a `conflict`, so parts-ai is asked, and the recorded model answers
"RTX 3080 Ti" from the title. Synthetic over the recorded row `1380502417485603`. Expected:
three GPU rows, all `offered`, all flagged `conflict` (two families, `rtx-3080` and
`rtx-3080-ti`, among offered parts of one type), the record's `conflict` true, nothing settled
by guessing (the card: "When rules and AI disagree, the conflict is recorded"). The other parts
are unaffected.
