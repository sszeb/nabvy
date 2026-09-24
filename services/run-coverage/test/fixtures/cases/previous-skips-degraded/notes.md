# previous-skips-degraded

Synthetic: the recorded run, then the same run read through `browser-fallback` (degraded), then the recorded run again. The third check's gap check compares it with the first read, never with the degraded one in between (review of PR #48, finding 3).
