Yesterday's degraded share fell (2% against 5%) and is under the threshold, but the day alerted
(`new-operation-id`: route-health reported a Facebook operation ID this module had not seen). A day
that alerted for any reason is not evidence that more volume is safe, so `decideRampAdvance`
refuses with `alerted`. Review of PR #63 head 3d8b32e, blocking finding 3.
