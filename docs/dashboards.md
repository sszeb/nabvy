# Dashboards and the database

## User dashboard (`/app`)

The home screen is a dashboard, not a bare feed. Mobile-first; every block links to its full page. All numbers come from `v_` views over the user's own rows through oRPC procedures inside `withUser`.

| Block | Content | Source |
| --- | --- | --- |
| Today | Alerts delivered today, best deal score, median freshness for the user's sources, usage balance with days of allowance left | `alerts`, `usage_balances`, `metrics_daily` |
| Deals near you | Map of the last 24 hours' alerts with score-coloured pins and the user's hunt radii; tap a pin for the card | `alerts`, `listings` (PostGIS) |
| Hunts | Each hunt with alerts per week, precision from the user's own feedback, last alert time, pause toggle | `hunts`, `alerts`, `matches` |
| Watchlist trends | 90-day price sparklines for the product keys in the user's hunts, with trend arrows | `value_bands`, `price_observations` |
| Inventory and profit | Items bought, listed, sold; profit to date and this month; average days to sell | `inventory_items` |
| Scans | Recent scans with verdicts and a "checked live" marker | `scan_events` |
| Usage | Balance, this month's spend by action, top-up button | `usage_ledger` |

Charts use Recharts (MIT); the map uses MapLibre GL (BSD) with OpenFreeMap tiles, so there is no Google Maps bill. Everything renders from precomputed views; no chart triggers a live provider call.

## Admin dashboard (`/admin`)

Role `admin` only. Four tabs, each a page of cards and tables from `metrics_daily`, `v_` views and materialised views refreshed by pg_cron every five minutes.

| Tab | Cards and tables | Actions |
| --- | --- | --- |
| Operations | Freshness p50 and p95 per source and tier; provider spend today and month against caps; model spend per listing; error and empty-result rates; dead-letter queue size; cell map with active units, cadence and cost per new listing | Kill switch per provider, pause pipeline, change a unit's cadence, retry dead letters |
| Quality | Alert precision from user verdicts; extraction pass rate and correction rate; quarantine count; risk-flag frequency; `unvalued` share per pack | Open the Review Console; promote a correction to a fixture |
| Business | MRR by plan; trials started and converted; churn; usage revenue by action; top-up volume; affiliate conversions and pending payouts; north-star flips this month | Grant lifetime Pro; issue usage credit with a reason (audited) |
| Users | Search by email or ID; entitlements, hunts, ledger, alerts, scans, inventory, devices; support notes | Read-only support view; no impersonation of sessions |

Built with shadcn/ui and Recharts; tables with TanStack Table (MIT). Every admin action writes an `audit_log` row (who, what, when, before, after).

## Database

Postgres on Supabase remains the single system of record. It already covers every shape of data the product has:

- **Relational:** users, hunts, listings, valuations, billing.
- **Time series:** `price_observations`, partitioned by month, with continuous aggregates as materialised views for the sparklines and trends.
- **Geospatial:** PostGIS for cells, hunt radii and the map.
- **Vectors:** pgvector for image embeddings (similar-item search) with an HNSW index.
- **Fuzzy text:** pg_trgm for product aliases.
- **Graph-shaped:** cross-posts, seller hashes, photo fingerprints and product aliases form a graph, but a shallow one. Recursive CTEs over `listing_links` answer "which listings share photos or a seller" in a few hops, and that is what risk screening needs.

A graph database is not added now. The reasons: a second database splits the truth, adds operations and consistency work for one builder, and nothing in the current queries exceeds three hops. Agents do not need a graph store; they need clear schemas, documented views and typed tools, which the contracts, `v_` views and the oRPC/OpenAPI layer provide. The trigger to revisit is measured: if fraud-ring or similar-item queries need more than three hops or exceed 500 ms p95 on real data, evaluate in this order: Apache AGE (Apache 2.0, Cypher on Postgres) on a self-hosted Postgres, or Kuzu (MIT, embedded) as a read-only sidecar fed from Postgres. Both keep Postgres as the source of truth.

Other database rules: every dashboard reads from views or materialised views, never from raw tables; heavy aggregates run in pg_cron, not on request; a read replica is added at the 1,000-user stage; weekly exports of `products`, `value_bands` and `price_observations` are the independent copy of the moat.

## Agent access to the data

For analysis by AI agents (the founder's or, later, Business customers'), the same public API and views are exposed through an MCP server (`services/mcp`, later phase) with read-only tools: deals, hunts, trends, metrics. No agent gets a database connection; it gets tools with the same authorisation as the user it acts for.
