// Pure logic of the copy-advert module: no I/O, no database, no clock or randomness passed in
// implicitly (docs/design/modules/_rules.md, rule 2).
export * from './batch'
export * from './cluster'
export * from './facts'
export * from './fingerprint'
export * from './normalise'
export * from './pairs'
export * from './rules'
