#!/usr/bin/env node
// Build the Nabvy module catalogue page from docs/design/modules/index.json
// and docs/design/modules/tiers.json, so the published artifact can be
// rebuilt from checked-in data instead of hand-edited HTML.
// Usage: node scripts/build-catalogue-page.mjs [indexFile] [tiersFile] [outFile]
import { readFileSync, writeFileSync } from 'node:fs'

const indexFile = process.argv[2] ?? 'docs/design/modules/index.json'
const tiersFile = process.argv[3] ?? 'docs/design/modules/tiers.json'
const outFile = process.argv[4] ?? 'docs/design/modules/catalogue.html'

const modules = JSON.parse(readFileSync(indexFile, 'utf8'))
const tiers = JSON.parse(readFileSync(tiersFile, 'utf8'))

const unranked = modules.filter((m) => !(m.name in tiers))
if (unranked.length) {
  console.warn(
    `warning: ${unranked.length} module(s) in ${indexFile} have no tier in ${tiersFile}: ${unranked
      .map((m) => m.name)
      .join(', ')}`,
  )
}

const M = modules.map((m) => ({ ...m, tier: tiers[m.name] ?? 'Sonnet' }))

const rounds = [...new Set(M.map((m) => m.round))].sort((a, b) => a - b)
const roundCount = rounds.length
const topCount = M.filter((m) => m.tier === 'top').length
const sonnetCount = M.filter((m) => m.tier === 'Sonnet').length
const mvpCount = M.filter((m) => m.scope === 'MVP').length

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  )

const now = new Date()
const stamp = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now
  .toISOString()
  .slice(11, 16)} UTC`

const tierLabel = (t) => (t === 'top' ? 'Top' : 'Sonnet')

function depsCell(m) {
  const hard = (m.dependsOn ?? []).map(esc).join(', ')
  const soft = (m.softDependsOn ?? []).map(esc).join(', ')
  if (!hard && !soft) return 'none'
  return hard + (soft ? `${hard ? ', ' : ''}<i>${soft}</i>` : '')
}

let rows = ''
for (const round of rounds) {
  const inRound = M.filter((m) => m.round === round).sort((a, b) => a.name.localeCompare(b.name))
  rows += `<tr class="grp"><td colspan="8">Round ${round}<span class="grp-count">${inRound.length} module${
    inRound.length === 1 ? '' : 's'
  }</span></td></tr>\n`
  for (const m of inRound) {
    rows +=
      `<tr class="${m.scope === 'MVP' ? '' : 'dim'}">` +
      `<td><code>${esc(m.name)}</code></td>` +
      `<td>${esc(m.group)}</td>` +
      `<td>${esc(m.job)}</td>` +
      `<td class="pr">${esc(m.priority ?? '')}</td>` +
      `<td><span class="pill ${m.scope === 'MVP' ? 's-MVP' : 's-out'}">${esc(m.scope)}</span></td>` +
      `<td><span class="pill t-${m.tier}">${tierLabel(m.tier)}</span></td>` +
      `<td class="deps">${depsCell(m)}</td>` +
      `</tr>\n`
  }
}

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nabvy Module Catalogue</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --bg:#f5f7f6;--surface:#ffffff;--ink:#17201d;--muted:#5b6964;--line:#d9e0dd;
  --accent:#0f6b58;--accent-soft:#e0f0eb;
  --top:#7a3e0c;--top-soft:#fbeadb;--son:#23507a;--son-soft:#e1ecf7;
  --out:#8a8f8d;--out-soft:#eceeed;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#111715;--surface:#18201d;--ink:#e3ebe8;--muted:#98a7a1;--line:#2b3632;
  --accent:#5cc7a9;--accent-soft:#16302a;
  --top:#f0ad74;--top-soft:#3a2415;--son:#8dbde9;--son-soft:#16283a;
  --out:#8a938f;--out-soft:#222a27;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#111715;--surface:#18201d;--ink:#e3ebe8;--muted:#98a7a1;--line:#2b3632;
  --accent:#5cc7a9;--accent-soft:#16302a;
  --top:#f0ad74;--top-soft:#3a2415;--son:#8dbde9;--son-soft:#16283a;
  --out:#8a938f;--out-soft:#222a27;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Public Sans",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding-inline:16px;padding-block:28px 60px;display:grid;gap:28px}
h1{font-size:28px;line-height:1.2;margin:0;text-wrap:balance}
p{margin:0;max-width:68ch}
.lede{display:grid;gap:10px}
.eyebrow{font:600 12px/1 "JetBrains Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.stats{display:flex;flex-wrap:wrap;gap:10px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 14px;min-width:120px}
.stat b{display:block;font:600 22px/1.1 "JetBrains Mono",monospace;font-variant-numeric:tabular-nums}
.stat span{font-size:13px;color:var(--muted)}
code,.mono{font-family:"JetBrains Mono",monospace;font-size:13px}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:960px;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
th{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--surface);position:sticky;top:0}
tr.grp td{background:var(--bg);font-weight:700;font-size:13px;letter-spacing:.03em;padding-top:14px;display:flex;align-items:baseline;gap:8px}
.grp-count{font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted);font-size:12px}
td.pr{color:var(--muted);font-size:12.5px;max-width:260px}
td.deps{color:var(--muted);font-size:12.5px;max-width:300px}
td.deps i{font-style:normal;opacity:.7}
.pill{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;white-space:nowrap}
.t-top{background:var(--top-soft);color:var(--top)}
.t-Sonnet{background:var(--son-soft);color:var(--son)}
.s-MVP{background:var(--accent-soft);color:var(--accent)}
.s-out{background:var(--out-soft);color:var(--out)}
tr.dim td{color:var(--muted)}
.foot{font-size:13px;color:var(--muted)}
</style>
</head><body>
<div class="wrap">
  <header class="lede">
    <div class="eyebrow">Module catalogue · ${stamp}</div>
    <h1>Nabvy module catalogue</h1>
    <p>Every function of the app as its own module: one job, its own tables, its own session and pull request. Built by <code>scripts/build-catalogue-page.mjs</code> from <code>docs/design/modules/index.json</code> and <code>docs/design/modules/tiers.json</code>, grouped by build round. Each module has its own card in <code>docs/design/modules/</code>, so a build session reads only its card.</p>
  </header>

  <div class="stats">
    <div class="stat"><b>${M.length}</b><span>modules</span></div>
    <div class="stat"><b>${mvpCount}</b><span>in the MVP</span></div>
    <div class="stat"><b>${roundCount}</b><span>build rounds</span></div>
    <div class="stat"><b>${topCount}</b><span>on the top model</span></div>
    <div class="stat"><b>${sonnetCount}</b><span>on Sonnet</span></div>
  </div>

  <div class="tablewrap">
    <table>
      <thead><tr><th>Module</th><th>Group</th><th>Job</th><th>Priority</th><th>Scope</th><th>Model</th><th>Needs</th></tr></thead>
      <tbody>
${rows}      </tbody>
    </table>
  </div>

  <p class="foot">Grouped by build round: a module's session starts once every module it needs is merged. "Needs" lists hard dependencies; italic names are soft ones (the module works without them). Model: the top model for the pipeline core, security and money; Sonnet for screens, admin tools, CRUD and plumbing. Source: <code>docs/design/modules/index.json</code> + <code>docs/design/modules/tiers.json</code>.</p>
</div>
</body></html>
`

writeFileSync(outFile, html)
console.log(
  `wrote ${outFile}: ${M.length} modules, ${roundCount} rounds, ${topCount} top, ${sonnetCount} sonnet`,
)
