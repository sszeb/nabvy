import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSuiteName, SUITE_DIR, SUITE_SUFFIX } from '../domain/suites.ts'

// Finds fixture suites by convention: every workspace package may hold
// `test/fixtures/<stage>[.<suite>].fixtures.ts`. Nothing is registered anywhere else.

export const WORKSPACE_DIRS = ['services', 'packages', 'apps']

export interface Suite {
  /** Package path relative to the repository root, e.g. `services/source-adapters`. */
  module: string
  stage: string
  /** Suite file path relative to the repository root. */
  file: string
}

export interface Discovery {
  suites: Suite[]
  /** Package paths that hold a fixtures folder, with or without suites. */
  modules: string[]
  /** Files ending in `.fixtures.ts` whose names break the convention. */
  misnamed: string[]
}

export const discoverSuites = (root: string): Discovery => {
  const discovery: Discovery = { suites: [], modules: [], misnamed: [] }
  for (const workspace of WORKSPACE_DIRS) {
    const workspacePath = join(root, workspace)
    if (!existsSync(workspacePath)) continue
    const packages = readdirSync(workspacePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    for (const name of packages) {
      const module = `${workspace}/${name}`
      const dir = join(root, module, SUITE_DIR)
      if (!existsSync(dir)) continue
      discovery.modules.push(module)
      for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith(SUITE_SUFFIX)) continue
        const parsed = parseSuiteName(file)
        const path = `${module}/${SUITE_DIR}/${file}`
        if (parsed) discovery.suites.push({ module, stage: parsed.stage, file: path })
        else discovery.misnamed.push(path)
      }
    }
  }
  return discovery
}
