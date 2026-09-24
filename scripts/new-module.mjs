// pnpm new:module <name>
// Scaffolds an atomic module (docs/decisions.md, "Atomic modules") in the files only that module
// owns, so parallel module branches never edit a shared file:
//   services/<name>/                          the module package (shape from CLAUDE.md)
//   packages/contracts/src/modules/<name>.ts  its contracts and event registry
//   packages/db/src/schema/<name>.ts          its Drizzle tables, in its own Postgres schema
//   packages/db/migrations/<name>/            its migrations home: module.json + drizzle.config.ts
// Then: pnpm install, define tables, pnpm db:generate <name> (packages/db/README.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
// Keep in step with RESERVED_SCHEMAS in packages/db/src/module-schema.ts (a test checks this).
export const RESERVED_SCHEMAS = [
  'public',
  'auth',
  'storage',
  'realtime',
  'extensions',
  'graphql',
  'graphql_public',
  'vault',
  'net',
  'cron',
  'pgmq',
  'pgsodium',
  'supabase_functions',
  'supabase_migrations',
  'information_schema',
  'nabvy_core',
  'apify_gateway',
  'marketplace_monitor',
]
const RESERVED_NAMES = ['core', 'config', 'contracts', 'db', 'packs', 'web']

const pascal = (name) =>
  name
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')

export function validateName(name) {
  if (!name || !MODULE_NAME.test(name)) {
    throw new Error(`Module name "${name ?? ''}" must be kebab case, e.g. copy-advert-spam`)
  }
  const schema = name.replaceAll('-', '_')
  if (
    RESERVED_NAMES.includes(name) ||
    RESERVED_SCHEMAS.includes(schema) ||
    schema.startsWith('pg_')
  ) {
    throw new Error(`Module name "${name}" is reserved`)
  }
  return schema
}

function files(name, schema, zodVersion) {
  const Name = pascal(name)
  return {
    [`services/${name}/package.json`]: `${JSON.stringify(
      {
        name: `@nabvy/${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        exports: { '.': './src/index.ts' },
        scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
        dependencies: {
          '@nabvy/contracts': 'workspace:*',
          '@nabvy/db': 'workspace:*',
          zod: zodVersion,
        },
      },
      null,
      2,
    )}\n`,
    [`services/${name}/tsconfig.json`]: `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "test"]
}
`,
    [`services/${name}/README.md`]: `# @nabvy/${name}

One atomic module (\`docs/decisions.md\`, "Atomic modules"). A module session edits only this
folder, \`packages/contracts/src/modules/${name}.ts\`, \`packages/db/src/schema/${name}.ts\` and
\`packages/db/migrations/${name}/\`.

## Job

TODO: the one function this module does, in a sentence or two.

## Inputs

TODO: events consumed (with their producing module) and the \`v_\` views or exported functions read.

## Outputs

TODO: what it produces and for whom.

## Owned tables

Postgres schema \`${schema}\`. TODO: each table, one line on what a row is.

## Views

TODO: each \`v_\` view other modules or users read, and its field allowlist. Views are
\`security_invoker\` and never expose seller identity or the raw provider row
(\`packages/db/README.md\`, "Views").

## Events

TODO: events published (declared in \`packages/contracts/src/modules/${name}.ts\`), each with its
idempotency key and the T-timestamp it stamps.

## When switched off

TODO: what stops, and how modules reading this one's output carry on without it.

## Tests

TODO: the fixtures used and what the tests prove. \`pnpm --filter @nabvy/${name} test\`.

## Decisions

TODO: anything decided while building this module.
`,
    [`services/${name}/src/index.ts`]: `// Public API of the ${name} module: the functions other modules and tasks may call.
// Other modules import from '@nabvy/${name}' only, never from its internals.
export { events, module } from '@nabvy/contracts/modules/${name}'
`,
    [`services/${name}/src/handlers/index.ts`]: `// Event handlers. Each takes a batch (100–500 items), is idempotent (key
// source + sourceListingId + contentHash) and stamps its T-timestamps (CLAUDE.md).
export {}
`,
    [`services/${name}/src/domain/index.ts`]: `// Pure logic: no I/O, no database, no clock or randomness passed in implicitly.
export {}
`,
    [`services/${name}/src/repo/index.ts`]: `// Database access. Own tables from '@nabvy/db/schema/${name}'; other modules only through
// their v_ views (packages/db/README.md). User rows only inside withUser.
export {}
`,
    [`services/${name}/test/fixtures/sample.json`]: `${JSON.stringify({ module: name, items: [] }, null, 2)}\n`,
    [`services/${name}/test/${name}.test.ts`]: `import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { events, module } from '../src/index'

// Sample fixture test from the scaffold: replace it with the module's own fixture tests
// (listing data comes from fixtures/, laid out as in docs/fixtures.md).
const sample = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url), 'utf8'))

describe('${name}', () => {
  it('declares its contracts under its own name', () => {
    expect(module).toBe('${name}')
    expect(events.module).toBe('${name}')
  })

  it('loads its sample fixture', () => {
    expect(sample).toEqual({ module: '${name}', items: [] })
  })
})
`,
    [`packages/contracts/src/modules/${name}.ts`]: `import { defineEvents } from '../index'

// Contracts of the ${name} module (packages/contracts/README.md): its schemas and its events.
// Import from '@nabvy/contracts/modules/${name}'. Samples in fixtures/contracts/${name}/.
// Schemas use Zod with the shared primitives, for example:
//   import { z } from 'zod'
//   import { IsoTimestamp, Uuid } from '../index'
//   export const ${Name}Seen = z.strictObject({ thingId: Uuid, seenAt: IsoTimestamp })
//   export type ${Name}Seen = z.infer<typeof ${Name}Seen>

export const module = '${name}'

/** Events this module publishes. A breaking payload change adds a version (README.md). */
export const events = defineEvents(module, {
  // 'thing.seen': { 1: z.object({ thingIds: z.array(Uuid).min(1).max(500) }) },
})
`,
    [`packages/db/src/schema/${name}.ts`]: `import { moduleSchema } from '../module-schema'

// Tables of the ${name} module, all in the Postgres schema '${schema}' (packages/db/README.md).
// Only services/${name} writes them. Other modules import only the views (v-prefixed exports).
// After changing this file: pnpm db:generate ${name}

export const schema = moduleSchema('${name}')
`,
    [`packages/db/migrations/${name}/module.json`]: `{
  "module": "${name}",
  "schema": "${schema}",
  "dependsOn": ["core"]
}
`,
    [`packages/db/migrations/${name}/drizzle.config.ts`]: `// Drizzle Kit configuration for the ${name} module's migrations. Paths are relative to
// packages/db, where \`pnpm db:generate ${name}\` runs. See packages/db/README.md.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/${name}.ts',
  out: './migrations/${name}',
  schemaFilter: ['${schema}'],
  migrations: { prefix: 'supabase' },
})
`,
  }
}

/** Writes the module's files under `root`. Refuses to overwrite anything. Returns the paths. */
export function scaffoldModule({ root, name }) {
  const schema = validateName(name)
  const contracts = JSON.parse(readFileSync(join(root, 'packages/contracts/package.json'), 'utf8'))
  const zodVersion = contracts.dependencies?.zod
  if (!zodVersion) throw new Error('packages/contracts/package.json has no zod dependency')
  const planned = files(name, schema, zodVersion)
  const clashes = [
    `services/${name}`,
    `packages/db/migrations/${name}`,
    ...Object.keys(planned),
  ].filter((path) => existsSync(join(root, path)))
  if (clashes.length > 0) throw new Error(`Module "${name}" already exists: ${clashes.join(', ')}`)
  for (const [path, content] of Object.entries(planned)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  for (const dir of ['src/handlers', 'src/domain', 'src/repo']) {
    mkdirSync(join(root, 'services', name, dir), { recursive: true })
  }
  return Object.keys(planned)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const written = scaffoldModule({ root, name: process.argv[2] })
    for (const path of written) console.log(`create ${path}`)
    console.log(`\nNext: pnpm install, then see packages/db/README.md to add tables.`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
