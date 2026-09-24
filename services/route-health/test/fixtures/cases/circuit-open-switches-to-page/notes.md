A tripped in-run breaker switches to `page` immediately, whatever the success rate or attempt
count (`fb-scrap-engine/app/route-health.js:47-96`; the actor's own breaker logic stays in the
actor repository, per the card's Sources).
