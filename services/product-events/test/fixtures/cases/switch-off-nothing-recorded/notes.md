Switch gate, rule 11 default for "off": `track()` never refuses on switch state (module card,
"features unaffected") -- it succeeds with `recorded: false, forwarded: false`, even though this
user has consented, and writes no row.
