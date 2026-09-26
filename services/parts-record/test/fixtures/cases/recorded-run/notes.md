# recorded-run

The whole recorded run (20 listings, `fixtures/listings/facebook/runs/2026-09-24-VkryjpwS6U2GBDh3k`)
through ingest, detail-evidence, parts-rules, parts-ai with parts-ai's own recorded responses
(copied from `services/parts-ai/test/fixtures/recordings/current.json`, synthetic: what a careful
model states from each text, not live output) and this module on both events. Checks every
listing's kind, versions, conflict flag and parts as the views give them. The expectation was
written from the first run and read line by line against the rules' and the AI's expectations.
