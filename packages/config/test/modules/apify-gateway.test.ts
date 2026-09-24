import { describe, expect, it } from 'vitest'
import { APIFY_GATEWAY_WATCH_BATCH_SIZE } from '../../src/modules/apify-gateway'

describe('modules/apify-gateway', () => {
  it('watches jobs in batches of 100', () => {
    expect(APIFY_GATEWAY_WATCH_BATCH_SIZE).toBe(100)
  })
})
