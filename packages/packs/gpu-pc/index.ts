import { GpuPcFacts } from '@nabvy/contracts'
import dictionary from './data/dictionary.json'
import pack from './data/pack.json'
import partPatterns from './data/part-patterns.json'
import partPatternsSource from './data/part-patterns.source.json'

// Pack gpu-pc (docs/packs/gpu-pc.md): data files plus the Zod fact template. JSON imports are not
// narrowed to the format's literal types, so this stays unvalidated until loadPack parses it.
export const gpuPcDefinition: unknown = {
  ...pack,
  factTemplate: GpuPcFacts,
  rules: { partPatterns, partPatternsSource },
  dictionary,
}
