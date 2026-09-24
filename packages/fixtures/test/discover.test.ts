import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSuiteName } from '../src/index.ts'
import { discoverSuites } from '../src/repo/discover.ts'

describe('parseSuiteName', () => {
  it('reads the stage and optional suite from the file name', () => {
    expect(parseSuiteName('gate.fixtures.ts')).toEqual({ stage: 'gate', suite: null })
    expect(parseSuiteName('adapter.facebook-run.fixtures.ts')).toEqual({
      stage: 'adapter',
      suite: 'facebook-run',
    })
  })

  it('rejects names that break the convention', () => {
    for (const name of ['Gate.fixtures.ts', 'a.b.c.fixtures.ts', '.fixtures.ts', 'gate.test.ts']) {
      expect(parseSuiteName(name)).toBeNull()
    }
  })
})

describe('discoverSuites', () => {
  it('finds suites in every workspace package without a shared registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'nabvy-fixtures-'))
    const make = (dir: string, files: string[]) => {
      mkdirSync(join(root, dir), { recursive: true })
      for (const file of files) writeFileSync(join(root, dir, file), '')
    }
    make('services/spam/test/fixtures', [
      'detect.fixtures.ts',
      'pass-rates.json',
      'Oops.fixtures.ts',
    ])
    make('services/quiet/test', ['unit.test.ts'])
    make('packages/pack/test/fixtures', [])

    expect(discoverSuites(root)).toEqual({
      suites: [
        {
          module: 'services/spam',
          stage: 'detect',
          file: 'services/spam/test/fixtures/detect.fixtures.ts',
        },
      ],
      modules: ['services/spam', 'packages/pack'],
      misnamed: ['services/spam/test/fixtures/Oops.fixtures.ts'],
    })
  })
})
