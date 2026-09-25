# free-limit-off-subscriptions

With `subscriptions` off the Free limit of 3 active wants applies (card; docs/decisions.md,
"Free-tier limits: 3 active hunts"), whatever the entitlement row says (10 here). The fourth
active want is refused; a paused want is always accepted; resuming it is refused until a want is
deleted. `v_wants` counts paused wants too; the aggregate views only active ones. The entitlement
row still marks the wants paid, because `v_entitlements` is exempt from the switch filter.
