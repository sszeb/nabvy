# Outside active hours only sweeps run, broad terms first

At 03:00 London newest-first checks do not run (card: "frequent, daytime"). Both sweeps are new; the broad one goes first because fast alerts for "Pc"-style listings depend on how often broad terms are swept (card; SCALE_PLAN.md:50-53). The narrow sweep waits for the next tick: one run per region per tick.
