# charge-after-reversal

A daily watching charge is taken, the action fails and the charge is reversed, then the task
retries with the same key. The retry is refused (`usage-ledger.reversed`) rather than told the
original charge stands, so the action never runs unpaid. The top-up is whole again.
