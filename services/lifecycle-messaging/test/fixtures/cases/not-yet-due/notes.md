The alert was delivered only an hour ago; the `24h` step's delay has not elapsed, so `run()` waits
rather than sending or recording anything (retried on the next tick).
