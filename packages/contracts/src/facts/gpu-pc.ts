import { z } from 'zod'

// Fact template for pack `gpu-pc` (docs/contracts.md). Fields the text does not support are
// null, never guessed.

export const GpuPcItemType = z.enum(['gpu', 'pc', 'cpu', 'ram', 'storage', 'psu', 'case', 'other'])
export type GpuPcItemType = z.infer<typeof GpuPcItemType>

export const GpuPcCondition = z.enum(['new', 'used_working', 'untested', 'faulty', 'unknown'])
export type GpuPcCondition = z.infer<typeof GpuPcCondition>

export const GpuPcFacts = z.object({
  itemType: GpuPcItemType,
  gpu: z
    .object({
      vendor: z.enum(['nvidia', 'amd', 'intel']),
      model: z.string().min(1),
      vramGb: z.number().int().positive().nullish(),
      variant: z.string().min(1).nullish(),
    })
    .nullish(),
  cpu: z.object({ vendor: z.enum(['intel', 'amd']), model: z.string().min(1) }).nullish(),
  ramGb: z.number().int().positive().nullish(),
  storage: z
    .array(z.object({ type: z.enum(['ssd', 'hdd', 'nvme']), gb: z.number().int().positive() }))
    .nullish(),
  psuWatts: z.number().int().positive().nullish(),
  caseModel: z.string().min(1).nullish(),
  condition: GpuPcCondition,
  tested: z.boolean().nullable(),
  boxed: z.boolean().nullable(),
  includesItems: z.array(z.string()),
  mentionsMining: z.boolean(),
  mentionsDeposit: z.boolean(),
  wantedPost: z.boolean(),
  partsOnly: z.boolean(),
  emptyBox: z.boolean(),
})
export type GpuPcFacts = z.infer<typeof GpuPcFacts>
