import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { confirm, createRecordedVisionClient, expirePhotos, scan } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import {
  CAP_MINOR,
  ctx,
  photoRef,
  RTX_3080_10GB,
  RTX_3080_TI,
  recordedClient,
  seed,
  U1,
  U2,
} from './support/scans'

let db: TestDatabase
beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db)
}, 60_000)
afterAll(() => db?.close())

/** A recorded client whose response IDs are unique per user and call, so each call is metered. */
function recordedClientFor(user: string, n: number) {
  const base = recordedClient()
  return createRecordedVisionClient(base.model, {
    [photoRef(user, 'gpu-confident')]: {
      responseId: `msg_late_${user}_${n}`,
      output: {
        description: {
          type: null,
          brand: null,
          model: null,
          colour: null,
          material: null,
          size: null,
          condition: null,
        },
        candidates: [{ name: 'RTX 3080 Ti', confidence: 0.9 }],
        searchPhrases: [],
      },
      usage: {
        inputTokens: 1800,
        outputTokens: 220,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
      },
      latencyMs: 1,
    },
  })
}

const photo = (user: string, name: string) => ({
  ref: photoRef(user, name),
  mediaType: 'image/jpeg' as const,
  bytes: 200_000,
})

async function scanPhoto(user: string, name: string, vision = recordedClient(), now = ctx()) {
  const scanId = randomUUID()
  const outcome = await db.as('nabvy_pipeline', (q) =>
    scan(q, { scanId, userId: user, photo: photo(user, name) }, { vision }, now),
  )
  return { scanId, outcome, vision }
}

describe('scan', () => {
  it('meters the vision call through cost-meter and counts it on the scan', async () => {
    const { scanId, outcome } = await scanPhoto(U1, 'gpu-confident')
    expect(outcome.ok).toBe(true)
    const [call] = await db.sql(
      `select module, provider, kind, ref_id, settled_gbp_micros from cost_meter.provider_calls where ref_id = $1`,
      [`msg_gpu-confident_${U1.slice(-4)}`],
    )
    expect(call).toMatchObject({
      module: 'scan-recognition',
      provider: 'anthropic',
      kind: 'model_call',
    })
    const [row] = await db.sql(
      `select cost_gbp_micros, prompt_version, output_valid, photo_expires_at from scan_recognition.scan_events where id = $1`,
      [scanId],
    )
    // 1,800 input and 220 output tokens at $2 and $10 per million: $0.0058, £0.00435 at 0.75.
    expect(Number(row?.cost_gbp_micros)).toBe(4350)
    expect(Number(call?.settled_gbp_micros)).toBe(4350)
    expect(row).toMatchObject({ prompt_version: 'scan-recognition/1', output_valid: true })
    expect(new Date(row?.photo_expires_at as string).toISOString()).toBe('2026-10-24T12:00:00.000Z')
  })

  it('sends the model only the photo, the prompt and the output bound: no user or scan ID', async () => {
    const { vision } = await scanPhoto(U2, 'gpu-confident')
    const [request] = vision.calls
    expect(Object.keys(request ?? {}).sort()).toEqual([
      'maxOutputTokens',
      'photo',
      'promptVersion',
      'systemPrompt',
    ])
    expect(request?.systemPrompt).not.toContain(U2)
  })

  it('refuses before the call once the window spend would pass the cap, and allows it again after the window', async () => {
    const user = randomUUID()
    await db.sql(
      `insert into better_auth."user" (id, name, email) values ($1, 'Cap', 'cap@example.com')`,
      [user],
    )
    const vision = createRecordedVisionClient('claude-sonnet-5', {
      [photoRef(user, 'gpu-confident')]: {
        responseId: 'unused',
        output: {},
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
        },
        latencyMs: 1,
      },
    })
    await db.sql(
      `insert into scan_recognition.scan_events (id, user_id, method, status, model_called, model_ref, output_valid, cost_gbp_micros, at)
       values ($1, $2, 'vision', 'unidentified', true, 'prior', false, $3, '2026-09-24T09:00:00Z')`,
      [randomUUID(), user, CAP_MINOR * 10_000 - 1000],
    )
    const refused = await scanPhoto(user, 'gpu-confident', vision)
    expect(refused.outcome.ok ? 'ok' : refused.outcome.error.code).toBe(
      'scan-recognition.cap_reached',
    )
    expect(vision.calls).toHaveLength(0)
    const [{ n }] = (await db.sql(
      `select count(*)::int as n from scan_recognition.scan_events where user_id = $1`,
      [user],
    )) as [{ n: number }]
    expect(n).toBe(1)
    // 25 hours later the prior spend is outside the 24-hour window.
    const later = await scanPhoto(
      user,
      'gpu-confident',
      vision,
      ctx(new Date('2026-09-25T10:00:00Z')),
    )
    expect(vision.calls).toHaveLength(1)
    expect(later.outcome.ok).toBe(true)
  })

  it('refuses a restricted account before anything else', async () => {
    const user = randomUUID()
    await db.sql(
      `insert into better_auth."user" (id, name, email, banned) values ($1, 'Banned', 'banned@example.com', true)`,
      [user],
    )
    const { outcome, vision } = await scanPhoto(user, 'gpu-confident')
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('scan-recognition.account_restricted')
    expect(vision.calls).toHaveLength(0)
  })

  it('refuses an unpriced model before the call', async () => {
    const { outcome, vision } = await scanPhoto(
      U1,
      'gpu-confident',
      recordedClient('some-unpriced-model'),
    )
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('scan-recognition.unknown_model')
    expect(vision.calls).toHaveLength(0)
  })

  it('returns model_failed and writes nothing when the call throws', async () => {
    const { scanId, outcome } = await scanPhoto(U1, 'not-recorded')
    expect(outcome.ok ? 'ok' : outcome.error.code).toBe('scan-recognition.model_failed')
    expect(
      await db.sql(`select 1 from scan_recognition.scan_events where id = $1`, [scanId]),
    ).toHaveLength(0)
  })

  it('refuses a scan ID reused for a different scan', async () => {
    const { scanId } = await scanPhoto(U1, 'gpu-unsure')
    const reused = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        { scanId, userId: U1, barcode: '5012345678900' },
        { vision: recordedClient() },
        ctx(),
      ),
    )
    expect(reused.ok ? 'ok' : reused.error.code).toBe('scan-recognition.conflict')
  })

  it('uses the soft CeX box lookup when one is passed', async () => {
    await db.sql(
      `insert into product_catalogue.codes (catalogue_id, kind, code) values ($1, 'cex_box', 'SGRANVI3080TI12G') on conflict do nothing`,
      [RTX_3080_TI],
    )
    const vision = recordedClient()
    const outcome = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        {
          scanId: randomUUID(),
          userId: U1,
          barcode: '5012345678917',
          photo: photo(U1, 'gpu-confident'),
        },
        {
          vision,
          cexBoxLookup: async (_q, ean) =>
            ean === '5012345678917' ? 'SGRANVI3080TI12G' : undefined,
        },
        ctx(),
      ),
    )
    expect(outcome.ok && outcome.value.result).toMatchObject({
      method: 'cex_box',
      identified: RTX_3080_TI,
    })
    expect(vision.calls).toHaveLength(0)
  })
})

describe('server time (review of PR #41)', () => {
  it('stamps at and photo expiry from server time and refuses a client-sent at', async () => {
    const now = ctx(new Date('2026-09-20T08:30:00.000Z'))
    const { scanId, outcome } = await scanPhoto(U2, 'gpu-at-threshold', recordedClient(), now)
    expect(outcome.ok).toBe(true)
    const [row] = await db.sql(
      `select at, photo_expires_at from scan_recognition.scan_events where id = $1`,
      [scanId],
    )
    expect(new Date(row?.at as string).toISOString()).toBe('2026-09-20T08:30:00.000Z')
    expect(new Date(row?.photo_expires_at as string).toISOString()).toBe('2026-10-20T08:30:00.000Z')
    const withClientTime = await db.as('nabvy_pipeline', (q) =>
      scan(
        q,
        {
          scanId: randomUUID(),
          userId: U2,
          photo: photo(U2, 'gpu-confident'),
          at: '2026-09-18T00:00:00.000Z',
        } as unknown as Parameters<typeof scan>[1],
        { vision: recordedClient() },
        now,
      ),
    )
    expect(withClientTime.ok ? 'ok' : withClientTime.error.code).toBe(
      'scan-recognition.invalid_input',
    )
  })

  it('a task that runs late still counts its spend in the window it ran in', async () => {
    const user = randomUUID()
    await db.sql(
      `insert into better_auth."user" (id, name, email) values ($1, 'Late', 'late@example.com')`,
      [user],
    )
    // Ten photo scans run now, however long ago their forms were sent, take 43,500 micros of the
    // 50,000 cap; the eleventh would pass it and is refused before its call.
    const runAt = ctx(new Date('2026-09-26T12:00:00.000Z'))
    for (let i = 0; i < 10; i++) {
      const done = await scanPhoto(user, 'gpu-confident', recordedClientFor(user, i), runAt)
      expect(done.outcome.ok).toBe(true)
    }
    const vision = recordedClientFor(user, 10)
    const refused = await scanPhoto(user, 'gpu-confident', vision, runAt)
    expect(refused.outcome.ok ? 'ok' : refused.outcome.error.code).toBe(
      'scan-recognition.cap_reached',
    )
    expect(vision.calls).toHaveLength(0)
  })

  it('invalid model output is still charged, metered and quarantined', async () => {
    const { scanId } = await scanPhoto(U1, 'price-in-output')
    const [row] = await db.sql(
      `select cost_gbp_micros, output_valid, model_ref from scan_recognition.scan_events where id = $1`,
      [scanId],
    )
    expect(Number(row?.cost_gbp_micros)).toBeGreaterThan(0)
    expect(row?.output_valid).toBe(false)
    expect(
      await db.sql(`select 1 from cost_meter.provider_calls where ref_id = $1`, [row?.model_ref]),
    ).toHaveLength(1)
  })
})

describe('confirm', () => {
  it('lets the user pick one of the candidates, emits identified once, and refuses anything else', async () => {
    const { scanId, outcome } = await scanPhoto(U1, 'gpu-unsure')
    expect(outcome.ok && outcome.value.result.status).toBe('needs_confirmation')
    expect(outcome.ok && outcome.value.event).toBeUndefined()

    const notCandidate = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: 'gpu:nvidia:rtx-3090:24gb' }),
      U1,
    )
    expect(notCandidate.ok ? 'ok' : notCandidate.error.code).toBe(
      'scan-recognition.not_a_candidate',
    )

    const picked = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: RTX_3080_TI }),
      U1,
    )
    if (!picked.ok) throw new Error(picked.error.message)
    expect(picked.value.result).toMatchObject({ status: 'identified', identified: RTX_3080_TI })
    expect(picked.value.changed).toBe(true)
    expect(picked.value.event?.key).toBe(`scan-recognition.identified:${scanId}@${RTX_3080_TI}`)

    const again = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: RTX_3080_TI }),
      U1,
    )
    expect(again.ok && again.value.changed).toBe(false)
    expect(again.ok && again.value.event?.key).toBe(picked.value.event?.key)

    const changed = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: RTX_3080_10GB }),
      U1,
    )
    expect(changed.ok && changed.value.event?.key).toBe(
      `scan-recognition.identified:${scanId}@${RTX_3080_10GB}`,
    )
  })

  it("never reaches another user's scan", async () => {
    const { scanId } = await scanPhoto(U1, 'gpu-unsure')
    const asOther = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U2, catalogueId: RTX_3080_TI }),
      U2,
    )
    expect(asOther.ok ? 'ok' : asOther.error.code).toBe('scan-recognition.not_found')
    const lying = await db.as(
      'nabvy_app',
      (q) => confirm(q, { scanId, userId: U1, catalogueId: RTX_3080_TI }),
      U2,
    )
    expect(lying.ok ? 'ok' : lying.error.code).toBe('scan-recognition.not_found')
  })

  it('gives the web app no write to cost, candidates or model columns', async () => {
    const { scanId } = await scanPhoto(U1, 'gpu-unsure')
    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `update scan_recognition.scan_events set cost_gbp_micros = 0 where id = '${scanId}'`,
          ),
        U1,
      ),
    ).rejects.toThrow()
    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `update scan_recognition.scan_events set candidates = '{gpu:nvidia:rtx-3090:24gb}' where id = '${scanId}'`,
          ),
        U1,
      ),
    ).rejects.toThrow()
    await expect(
      db.as(
        'nabvy_app',
        (q) =>
          q.execute(
            `insert into scan_recognition.scan_events (id, user_id, method, status, at) values (gen_random_uuid(), '${U1}', 'none', 'unidentified', now())`,
          ),
        U1,
      ),
    ).rejects.toThrow()
  })
})

describe('expirePhotos', () => {
  it('clears photo refs past 30 days and returns them, once', async () => {
    const old = ctx(new Date('2026-08-01T12:00:00Z'))
    const { scanId } = await scanPhoto(U2, 'unknown-item', recordedClient(), old)
    const first = await db.as('nabvy_pipeline', (q) =>
      expirePhotos(q, new Date('2026-09-24T12:00:00Z')),
    )
    expect(first.photoRefs).toContain(photoRef(U2, 'unknown-item'))
    const [row] = await db.sql(
      `select photo_ref, photo_media_type from scan_recognition.scan_events where id = $1`,
      [scanId],
    )
    expect(row).toEqual({ photo_ref: null, photo_media_type: null })
    const second = await db.as('nabvy_pipeline', (q) =>
      expirePhotos(q, new Date('2026-09-24T12:00:00Z')),
    )
    expect(second.photoRefs).not.toContain(photoRef(U2, 'unknown-item'))
  })
})
