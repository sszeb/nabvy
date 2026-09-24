Property allowlist, negative case: a known event with an extra property no event declares
(`postcode`, never sent to PostHog or stored -- `docs/analytics.md:40`) is refused whole, because
every properties object is `z.strictObject`.
