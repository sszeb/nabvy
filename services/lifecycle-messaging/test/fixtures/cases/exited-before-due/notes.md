The user opened the alert an hour ago (after the trigger, before now): the exit event is at or
after `triggeredAt` and at or before `now`, so `decideStep` skips the step permanently for this
`triggeredAt` (a later `alert_delivered` would start a fresh instance).
