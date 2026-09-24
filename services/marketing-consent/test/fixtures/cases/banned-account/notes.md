A banned account never receives marketing, even with full consent: `canMarket()` checks the
account's standing through `@nabvy/account`'s `isActive()` before consent is even read.
