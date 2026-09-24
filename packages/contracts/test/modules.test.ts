import { describe, expect, it } from 'vitest'
import type { EventRegistry } from '../src/index'
import { moduleFiles } from './discover'

// Checks every per-module contract file together, so parallel module branches cannot declare the
// same event twice or mislabel their file. Discovered at run time: no shared index to edit.

const modules = moduleFiles()

async function registryOf(name: string): Promise<{ module: unknown; events: EventRegistry }> {
  return import(`../src/modules/${name}.ts`)
}

describe('per-module contract files', () => {
  it.skipIf(modules.length === 0).each(modules)('%s names itself and its events', async (name) => {
    const contract = await registryOf(name)
    expect(contract.module).toBe(name)
    expect(contract.events?.module).toBe(name)
  })

  it('declare each event type in exactly one module', async () => {
    const owner = new Map<string, string>()
    for (const name of modules) {
      const { events } = await registryOf(name)
      for (const type of Object.keys(events.definitions)) {
        expect(owner.get(type), `${type} is declared by ${owner.get(type)} and ${name}`).toBe(
          undefined,
        )
        owner.set(type, name)
      }
    }
  })
})
