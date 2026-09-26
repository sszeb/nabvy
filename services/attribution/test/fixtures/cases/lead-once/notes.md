# lead-once

A repeated sign-up capture with the same click ID writes once (idempotent); a second capture
with a different click ID for the same user is refused rather than silently overwritten.
