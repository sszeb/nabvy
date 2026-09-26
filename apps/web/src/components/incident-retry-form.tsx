'use client'

import { useState } from 'react'
import { retryIncidentAction } from '@/app/admin/actions'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { FieldHint, Label } from './ui/label'

export function IncidentRetryForm() {
  const [status, setStatus] = useState<string | null>(null)
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        const id = new FormData(event.currentTarget).get('incidentId')
        if (typeof id !== 'string' || !id) return
        try {
          const result = await retryIncidentAction(id)
          setStatus(result.ok ? 'Retried.' : result.error.message)
        } catch {
          setStatus('Could not retry that incident.')
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="incident-id">Incident ID</Label>
        <Input id="incident-id" name="incidentId" required className="w-80" />
      </div>
      <Button type="submit">Retry</Button>
      {status ? <FieldHint>{status}</FieldHint> : null}
    </form>
  )
}
