-- apify-gateway: move the actor build pin from 1.0.82 to 1.0.83 (task 1.1i).
--
-- The private actor keeps only build 1.0.83 on the platform (builds up to 1.0.82 were deleted on
-- 2026-09-24) and its integration guide says "pin build=1.0.83". The Edge Function sends
-- settings.actor_build as the run's `build` query parameter, so a run pinned at 1.0.82 fails at
-- start. The v3 output contract is unchanged, so the recorded 1.0.82 run stays the fixture source
-- (services/apify-gateway/README.md, "Decisions"). Forward-only: the earlier migration is not
-- edited; this one changes the column default and the existing settings row.
alter table apify_gateway.settings
  alter column actor_build set default '1.0.83';

update apify_gateway.settings set actor_build = '1.0.83' where actor_build = '1.0.82';
