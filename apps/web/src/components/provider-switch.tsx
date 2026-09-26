'use client'

import { useState, useTransition } from 'react'
import { setSwitchAction } from '@/app/admin/actions'
import { StatusChip } from './status-chip'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

/**
 * The Facebook provider kill switch (task L1; `services/switches` `set()` path, with its own
 * audit row). Runs `switches.set` for the `apify` switch inside `withPipeline`; the label shows
 * the server state after the change commits, never optimistic local state, so an admin never
 * sees "Collecting" while a write is still in flight or failed.
 */
export function ProviderSwitch({ enabled }: { enabled: boolean }) {
  const [checked, setChecked] = useState(enabled)
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex items-center gap-3">
      <StatusChip tone={checked ? 'success' : 'danger'}>
        {checked ? 'Collecting' : 'Stopped'}
      </StatusChip>
      <Label htmlFor="provider-switch" className="sr-only">
        Facebook collection
      </Label>
      <Switch
        id="provider-switch"
        checked={checked}
        disabled={pending}
        onCheckedChange={(next) => {
          startTransition(async () => {
            await setSwitchAction({ name: 'apify', kind: 'provider', state: next ? 'on' : 'off' })
            setChecked(next)
          })
        }}
      />
    </div>
  )
}
