# twelve-stops-all-fit

Synthetic: the stop limit (§6.1, 12 stops), all with no agreed time and 5 minutes each, 08:00 to
20:00 from and back to Chichester. The exact solver visits every stop in one loop round the area
(south coast eastwards, north through Horsham and Pulborough, west through Midhurst and
Petersfield, back along the coast): 228 km on the estimate matrix. Its run time is checked in
test/solver.test.ts (under 2 seconds; the draft measured about 10 ms).
