'use client'

import type { SwitchesKind, SwitchesState } from '@nabvy/contracts/modules/switches'
import { useState, useTransition } from 'react'
import { setSwitchAction } from '@/app/admin/actions'
import { NativeSelect } from './ui/input'

const statesFor = (kind: SwitchesKind): SwitchesState[] =>
  kind === 'module' ? ['off', 'shadow', 'on'] : ['off', 'on']

/** One switch's state, changed through `switches.set` (task L1; audited). */
export function SwitchToggle({
  name,
  kind,
  state,
}: {
  name: string
  kind: SwitchesKind
  state: SwitchesState
}) {
  const [value, setValue] = useState(state)
  const [pending, startTransition] = useTransition()
  const alwaysOn = name === 'audit-log' || name === 'incidents' || name === 'switches'
  return (
    <NativeSelect
      aria-label={`${name} state`}
      value={value}
      disabled={pending || alwaysOn}
      onChange={(event) => {
        const next = event.target.value as SwitchesState
        startTransition(async () => {
          await setSwitchAction({ name, kind, state: next })
          setValue(next)
        })
      }}
    >
      {statesFor(kind).map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </NativeSelect>
  )
}
