// Application-level encryption of a pickup's private fields (search-map-routes.md §5.3):
// AES-256-GCM under PICKUPS_DATA_KEY. A sealed blob is `0x01 | iv (12 bytes) | tag (16 bytes) |
// ciphertext`. The key is never read here: the caller passes it (services/pickup-routes/src/
// index.ts loads it through @nabvy/config; tests pass a fixed key). No dependency: node:crypto.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/** Thrown when the key is malformed or a blob does not open (wrong key, tampering, truncation). */
export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

/** Parses PICKUPS_DATA_KEY: 64 hex characters, or base64 of 32 bytes. Anything else refuses. */
export function parseDataKey(raw: string): Buffer {
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  const decoded = Buffer.from(trimmed, 'base64')
  if (
    decoded.length === KEY_BYTES &&
    decoded.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')
  ) {
    return decoded
  }
  throw new SealError('PICKUPS_DATA_KEY must be 32 bytes as 64 hex characters or base64')
}

/** Seals a JSON-serialisable value. A fresh random IV each call: two seals never match. */
export function seal(key: Buffer, value: unknown): Uint8Array {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]))
}

/** Opens a sealed blob. The authentication tag refuses a wrong key or any change to the bytes. */
export function open(key: Buffer, blob: Uint8Array): unknown {
  const bytes = Buffer.from(blob)
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES || bytes[0] !== VERSION) {
    throw new SealError('sealed blob is malformed')
  }
  const iv = bytes.subarray(1, 1 + IV_BYTES)
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ciphertext = bytes.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new SealError('sealed blob does not open with this key')
  }
}
