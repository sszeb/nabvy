#!/usr/bin/env node
// Readiness and critical-path priority for the module catalogue (coordinator 6, 2026-09-24).
// Usage: node scripts/critical-path.mjs --done=a,b --open=c,d --building=e,f
//   done: merged modules (the six foundation modules are always counted done)
//   open: modules whose PR is open or draft; dependents may start now, stacked on that branch
//   building: modules in build with no PR yet
import { readFileSync } from 'node:fs'

const idx = JSON.parse(readFileSync(new URL('../docs/design/modules/index.json', import.meta.url)))
const tiers = JSON.parse(
  readFileSync(new URL('../docs/design/modules/tiers.json', import.meta.url)),
)
const soft = JSON.parse(
  readFileSync(new URL('../docs/design/modules/soft-edges.json', import.meta.url)),
)
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, '').split('='))
    .map(([k, v]) => [k, (v || '').split(',').filter(Boolean)]),
)
const done = new Set([
  'auth',
  'config',
  'telemetry',
  'core',
  'source-adapters',
  'valuation',
  ...(args.done || []),
])
const open = new Set(args.open || [])
const building = new Set(args.building || [])
const by = new Map(idx.map((m) => [m.name, m]))
const softSet = new Set(soft.edges.map((e) => `${e.from}>${e.to}`))
const mvp = idx.filter((m) => m.scope === 'MVP').map((m) => m.name)
const hard = (n) =>
  (by.get(n)?.dependsOn || []).filter(
    (d) => !softSet.has(`${n}>${d}`) && by.has(d) && by.get(d).scope === 'MVP',
  )
const dependents = new Map(mvp.map((n) => [n, []]))
for (const n of mvp) for (const d of hard(n)) dependents.get(d)?.push(n)
const memo = new Map()
const height = (n) => {
  // longest chain of not-yet-merged dependents that wait on n
  if (memo.has(n)) return memo.get(n)
  memo.set(n, 0)
  const h =
    1 +
    Math.max(
      0,
      ...dependents
        .get(n)
        .filter((m) => !done.has(m))
        .map(height),
    )
  memo.set(n, h)
  return h
}
const satisfied = (d) => done.has(d) || open.has(d)
const rows = mvp
  .filter((n) => !done.has(n) && !open.has(n) && !building.has(n))
  .map((n) => ({
    name: n,
    tier: tiers[n] || '?',
    cp: height(n),
    round: by.get(n).round,
    missing: hard(n).filter((d) => !satisfied(d)),
    stackOn: hard(n).filter((d) => open.has(d) && !done.has(d)),
  }))
const ready = rows
  .filter((r) => r.missing.length === 0)
  .sort((a, b) => b.cp - a.cp || a.round - b.round)
console.log(
  `MVP ${mvp.length}: done ${mvp.filter((n) => done.has(n)).length}, open ${[...open].length}, building ${[...building].length}, ready ${ready.length}, blocked ${rows.length - ready.length}`,
)
for (const r of ready)
  console.log(
    `  READY [cp ${r.cp}] ${r.name} (${r.tier}, round ${r.round})${r.stackOn.length ? ` stack on ${r.stackOn.join(', ')}` : ''}`,
  )
const blocked = rows.filter((r) => r.missing.length).sort((a, b) => b.cp - a.cp)
for (const r of blocked.slice(0, 12))
  console.log(`  blocked [cp ${r.cp}] ${r.name}: waits on ${r.missing.join(', ')}`)
if (blocked.length > 12) console.log(`  ... and ${blocked.length - 12} more blocked`)
