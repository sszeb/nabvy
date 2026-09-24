Consent gate, edge case: `consent: null` means the case sets up no `account.user_profiles` row at
all for this user (`getProfile()` returns `null`). `track()` treats a missing profile as not
consented rather than throwing or guessing, still recording the first-party row.
