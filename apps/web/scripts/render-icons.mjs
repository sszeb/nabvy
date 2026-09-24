// Renders the placeholder wordmark SVGs in public/icons to the PNG sizes the manifest and iOS
// need. Uses the Playwright Chromium already on the machine; run with `pnpm icons` after
// changing an SVG, then commit the PNGs.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url))
const preinstalled = '/opt/pw-browsers/chromium'
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {},
)

const targets = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
]

for (const [source, output, size] of targets) {
  const svg = await readFile(`${dir}${source}`, 'utf8')
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  )
  await page.screenshot({ path: `${dir}${output}`, omitBackground: true })
  await page.close()
}

await browser.close()
