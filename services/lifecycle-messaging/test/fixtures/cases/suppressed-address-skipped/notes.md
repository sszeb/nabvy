Same as the golden path, but the address is suppressed (a prior bounce or complaint). `canMarket()`
gates on `isSuppressed()` before consent, through `@nabvy/marketing-consent` -- this module never
sends around a suppression.
