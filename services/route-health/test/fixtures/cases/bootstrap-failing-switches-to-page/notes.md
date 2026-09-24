All 3 session pages failed to supply the replay template (no listing was even attempted), which
is a broken route, not missing data, so the region switches to `page` even with zero attempts
(`fb-scrap-engine/app/route-health.js:13-14`).
