import { createMemoryPublisher } from '@nabvy/transport'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gateAllows, isOn, list, set, state } from '../src'
import { createTestDatabase, type TestDatabase } from './support/database'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const U1 = '00000000-0000-4000-8000-0000000000c1'
const U2 = '00000000-0000-4000-8000-0000000000c2'

let db: TestDatabase
const audits = async (target: string) =>
  db.sql(`select before, after, reason from audit_log.entries where target = $1 order by at, id`, [
    target,
  ])
const stateOf = async (name: string) =>
  (await db.sql('select switches.state($1) as s', [name]))[0]?.s

beforeAll(async () => {
  db = await createTestDatabase()
}, 60_000) // PGlite startup plus migrations is slow on a loaded runner
afterAll(() => db.close())

describe('reading', () => {
  it('reads an unknown name as off, in SQL and in code, for both application roles', async () => {
    expect(await stateOf('no-such-module')).toBe('off')
    for (const role of ['nabvy_app', 'nabvy_pipeline'] as const) {
      expect(await db.as(role, (tx) => state(tx, 'no-such-module'))).toBe('off')
      expect(await db.as(role, (tx) => isOn(tx, 'no-such-module'))).toBe(false)
      expect(await db.as(role, (tx) => gateAllows(tx, 'no-such-gate', U1))).toBe(false)
    }
  })

  it('seeds the built modules, providers, the alert gate, the flag and the pipeline', async () => {
    const rows = await db.as('nabvy_pipeline', (tx) => list(tx))
    const byName = Object.fromEntries(rows.map((r) => [r.name, `${r.kind}:${r.state}`]))
    expect(byName).toMatchObject({
      switches: 'module:on',
      'audit-log': 'module:on',
      incidents: 'module:on',
      auth: 'module:on',
      'cost-meter': 'module:off',
      'quote-redaction': 'module:off',
      apify: 'provider:off',
      'facebook-alerts': 'gate:on',
      'listing-photos': 'flag:off',
      pipeline: 'global:on',
    })
    expect(rows.every((r) => r.changedBy === null)).toBe(true)
  })

  it('shadow is not on', async () => {
    await db.as('nabvy_pipeline', (tx) =>
      set(tx, createMemoryPublisher(), {
        actorUserId: ADMIN,
        name: 'shadowed',
        kind: 'module',
        state: 'shadow',
      }),
    )
    expect(await db.as('nabvy_app', (tx) => state(tx, 'shadowed'))).toBe('shadow')
    expect(await db.as('nabvy_app', (tx) => isOn(tx, 'shadowed'))).toBe(false)
  })

  it('fails closed when the functions cannot be reached', async () => {
    await db.sql('revoke execute on function switches.state(text) from nabvy_app')
    await db.sql('revoke execute on function switches.gate_allows(text, uuid) from nabvy_app')
    try {
      expect(await db.as('nabvy_app', (tx) => state(tx, 'auth')).catch(() => 'threw')).toBe('off')
    } finally {
      await db.sql('grant execute on function switches.state(text) to nabvy_app')
    }
    try {
      expect(
        await db
          .as('nabvy_app', (tx) => gateAllows(tx, 'facebook-alerts', U1))
          .catch(() => 'threw'),
      ).toBe(false)
    } finally {
      await db.sql('grant execute on function switches.gate_allows(text, uuid) to nabvy_app')
    }
  })
})

describe('set', () => {
  it('writes one audit entry per change and none for a repeat', async () => {
    const publisher = createMemoryPublisher()
    const change = {
      actorUserId: ADMIN,
      name: 'cost-meter',
      kind: 'module' as const,
      state: 'on' as const,
      reason: 'go live',
    }
    expect(await db.as('nabvy_pipeline', (tx) => set(tx, publisher, change))).toEqual({
      changed: true,
    })
    expect(await db.as('nabvy_pipeline', (tx) => set(tx, publisher, change))).toEqual({
      changed: false,
    })
    expect(await stateOf('cost-meter')).toBe('on')
    expect(await audits('switch:cost-meter')).toEqual([
      {
        before: { kind: 'module', state: 'off', allowList: null },
        after: { kind: 'module', state: 'on', allowList: null },
        reason: 'go live',
      },
    ])
    // The repeat re-publishes the same key, which the transport drops.
    expect(publisher.ofType('switches.changed').map((e) => e.payload)).toEqual([
      { names: ['cost-meter'] },
    ])
    expect(publisher.duplicates).toHaveLength(1)
    const [row] = await db.sql(`select changed_by from switches.switches where name = 'cost-meter'`)
    expect(row?.changed_by).toBe(ADMIN)
  })

  it('refuses turning off an always-on switch, in code and in the database', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        set(tx, createMemoryPublisher(), {
          actorUserId: ADMIN,
          name: 'audit-log',
          kind: 'module',
          state: 'off',
        }),
      ),
    ).rejects.toMatchObject({ code: 'switches.always_on' })
    await expect(
      db.sql(`update switches.switches set state = 'off' where name = 'incidents'`),
    ).rejects.toThrow(/switches_always_on/)
    expect(await audits('switch:audit-log')).toEqual([])
  })

  it('refuses a kind mismatch', async () => {
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        set(tx, createMemoryPublisher(), {
          actorUserId: ADMIN,
          name: 'apify',
          kind: 'module',
          state: 'on',
        }),
      ),
    ).rejects.toMatchObject({ code: 'switches.kind_mismatch' })
  })

  it('rolls the change back when the audit row cannot be written', async () => {
    const publisher = createMemoryPublisher()
    await db.sql('revoke insert on audit_log.entries from nabvy_pipeline')
    try {
      await expect(
        db.as('nabvy_pipeline', (tx) =>
          set(tx, publisher, { actorUserId: ADMIN, name: 'ebay', kind: 'provider', state: 'on' }),
        ),
      ).rejects.toMatchObject({ code: 'audit-log.unavailable' })
    } finally {
      await db.sql('grant insert on audit_log.entries to nabvy_pipeline')
    }
    expect(await stateOf('ebay')).toBe('off')
    expect(publisher.published).toEqual([])
  })

  it('the web app cannot write or list switches', async () => {
    for (const statement of [
      `update switches.switches set state = 'on' where name = 'apify'`,
      `insert into switches.switches (name, kind, state) values ('x', 'flag', 'on')`,
      'select * from switches.v_state',
    ]) {
      await expect(db.as('nabvy_app', (tx) => tx.execute(sql.raw(statement)))).rejects.toThrow()
    }
    await expect(
      db.as('nabvy_pipeline', (tx) =>
        tx.execute(sql.raw(`delete from switches.switches where name = 'apify'`)),
      ),
    ).rejects.toThrow()
  })
})

describe('gates', () => {
  const gate = (over: Record<string, unknown>) =>
    db.as('nabvy_pipeline', (tx) =>
      set(tx, createMemoryPublisher(), {
        actorUserId: ADMIN,
        name: 'facebook-alerts',
        kind: 'gate',
        state: 'on',
        ...over,
      }),
    )
  const allows = (user: string) =>
    db.as('nabvy_app', (tx) => gateAllows(tx, 'facebook-alerts', user))

  it('is open to all with no allow-list, only to listed users with one, closed when off', async () => {
    expect([await allows(U1), await allows(U2)]).toEqual([true, true])
    await gate({ allowList: [U1] })
    expect([await allows(U1), await allows(U2)]).toEqual([true, false])
    await gate({ state: 'off' })
    expect([await allows(U1), await allows(U2)]).toEqual([false, false])
    await gate({ allowList: null })
    expect([await allows(U1), await allows(U2)]).toEqual([true, true])
    expect(await audits('switch:facebook-alerts')).toHaveLength(3)
  })

  it('a non-gate switch never allows', async () => {
    expect(await db.as('nabvy_app', (tx) => gateAllows(tx, 'pipeline', U1))).toBe(false)
  })
})

describe('the SQL functions inside a sample view', () => {
  it('filter a reader view as the web app', async () => {
    await db.pg.exec(`
      create schema sample;
      create table sample.items (id int primary key);
      insert into sample.items values (1), (2);
      create view sample.v_items with (security_invoker = true) as
        select id from sample.items where switches.is_on('sample');
      create view sample.v_items_not_off with (security_invoker = true) as
        select id from sample.items where switches.state('sample') <> 'off';
      create view sample.v_gated with (security_invoker = true) as
        select id from sample.items
        where switches.gate_allows('facebook-alerts', nabvy_core.current_user_id());
      grant usage on schema sample to nabvy_app;
      grant select on all tables in schema sample to nabvy_app;
    `)
    const count = (view: string) =>
      db.as(
        'nabvy_app',
        async (tx) =>
          (
            (await tx.execute(
              sql.raw(`select count(*)::int as n from sample.${view}`),
            )) as never as {
              rows: { n: number }[]
            }
          ).rows[0]?.n,
        U1,
      )
    expect([
      await count('v_items'),
      await count('v_items_not_off'),
      await count('v_gated'),
    ]).toEqual([0, 0, 2])
    const setSample = (s: 'shadow' | 'on') =>
      db.as('nabvy_pipeline', (tx) =>
        set(tx, createMemoryPublisher(), {
          actorUserId: ADMIN,
          name: 'sample',
          kind: 'module',
          state: s,
        }),
      )
    await setSample('shadow')
    expect([await count('v_items'), await count('v_items_not_off')]).toEqual([0, 2])
    await setSample('on')
    expect([await count('v_items'), await count('v_items_not_off')]).toEqual([2, 2])
  })
})
