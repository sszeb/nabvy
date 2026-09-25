Card: "the caller supplies the listing's point ... otherwise the city page's point, and says
which it used" and "Tests and fixtures: ... the city-page fallback". This case gives distanceKm()
two town-level points and basis 'city_page', proving the returned `LocationDistance.basis` is
exactly what the caller passed through, unchanged, whichever point resolution was used. The two
points are Belfast's and Edinburgh's town centres (public knowledge), standing in for two
verified centres' city-page coordinates; this module never reads the city-pages seed file
directly for a coordinate, only through `@nabvy/city-pages`.
