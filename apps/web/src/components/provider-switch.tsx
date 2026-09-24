'use client'

import { useState } from 'react'
import { StatusChip } from './status-chip'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

/** The Facebook provider kill switch. UI only until task 4.8 audits and applies it. */
export function ProviderSwitch({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  return (
    <div className="flex items-center gap-3">
      <StatusChip tone={enabled ? 'success' : 'danger'}>
        {enabled ? 'Collecting' : 'Stopped'}
      </StatusChip>
      <Label htmlFor="provider-switch" className="sr-only">
        Facebook collection
      </Label>
      <Switch id="provider-switch" checked={enabled} onCheckedChange={setEnabled} />
    </div>
  )
}
