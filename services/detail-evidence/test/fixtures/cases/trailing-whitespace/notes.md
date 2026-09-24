# trailing-whitespace

The card's test: trailing whitespace does not change the hash (`dataset.json:3722,3745`). In the
recorded run, 5 rows' top-level `description` differs from its `sourceFields.detail.description`
copy only by trailing whitespace (`1716871313386322`, `1775698700306989`, `2126837844711748`,
`1639721697586478`, `2005582460147017`), and row 10 (`2126837844711748`, dataset.json:3722) also
has spaces at the end of inner lines. The second step (synthetic) collects the same rows a day
later with each description replaced by its copy: no new version, nothing announced.
