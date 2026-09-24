import { gpuPcDefinition } from '../gpu-pc'
import { type LoadedPack, loadPack } from './loader'

export { aliasSource, createResolver, type ProductMatch, type Resolver } from './dictionary'
export { type CompiledRule, type LoadedPack, loadPack, PackValidationError } from './loader'
export { gpuPcDefinition }

export const packIds = ['gpu-pc'] as const
export type PackId = (typeof packIds)[number]

const definitions: Record<PackId, unknown> = { 'gpu-pc': gpuPcDefinition }
const loaded = new Map<PackId, LoadedPack>()

// Loads and validates a pack once; throws PackValidationError if its data is invalid.
export const getPack = (id: PackId): LoadedPack => {
  const cached = loaded.get(id)
  if (cached) return cached
  const pack = loadPack(definitions[id])
  loaded.set(id, pack)
  return pack
}
