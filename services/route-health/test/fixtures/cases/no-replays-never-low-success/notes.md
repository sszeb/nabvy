With `minAttempts: 0` and no graphql replays at all, the actor's own helper would evaluate
`null < 0.95` as true (a JavaScript quirk) and switch to `page` as `low-success` on no evidence.
Nabvy's port treats "no replays" as never low success, so an empty history with `minAttempts: 0`
stays on `graphql` as `healthy` (`src/domain/route-health.ts`, "Divergence").
