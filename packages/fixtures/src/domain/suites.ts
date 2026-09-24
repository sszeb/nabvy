// A fixture suite is a Vitest file at `<package>/test/fixtures/<stage>[.<suite>].fixtures.ts`. Its
// file name alone registers the stage, so modules never edit a shared list (fixtures/README.md).

export const SUITE_SUFFIX = '.fixtures.ts'
export const SUITE_DIR = 'test/fixtures'
export const BASELINE_FILE = 'pass-rates.json'

const NAME = /^([a-z][a-z0-9-]*)(?:\.([a-z][a-z0-9-]*))?\.fixtures\.ts$/

export interface SuiteName {
  stage: string
  suite: string | null
}

/** Reads the stage (and optional suite) from a suite file name; null when it breaks the convention. */
export const parseSuiteName = (fileName: string): SuiteName | null => {
  const match = NAME.exec(fileName)
  if (!match?.[1]) return null
  return { stage: match[1], suite: match[2] ?? null }
}
