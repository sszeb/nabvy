export const RESERVED_SCHEMAS: string[]
export function validateName(name: string | undefined): string
export function parseArgs(argv: string[]): { name: string | undefined; dependsOn?: string[] }
export function scaffoldModule(options: {
  root: string
  name: string | undefined
  dependsOn?: string[]
}): string[]
