'use client'

import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { exportAccountData, requestAccountDeletion } from '@/app/app/(shell)/account/actions'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

/** Export and delete, wired to `@nabvy/account` (task L1). */
export function AccountDataActions() {
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null)
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Button
          variant="outline"
          className="w-fit"
          onClick={async () => {
            const data = await exportAccountData()
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'nabvy-account-export.json'
            link.click()
            URL.revokeObjectURL(url)
            setExportStatus('Downloaded.')
          }}
        >
          <DownloadIcon aria-hidden />
          Export my data
        </Button>
        {exportStatus ? (
          <p role="status" className="text-muted-foreground text-xs">
            {exportStatus}
          </p>
        ) : null}
      </div>
      <Separator />
      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm">
          Deleting your account removes your hunts, alerts and inventory within 24 hours.
        </p>
        <Button
          variant="destructive"
          className="w-fit"
          onClick={async () => {
            if (!window.confirm('Delete your account? This cannot be undone.')) return
            try {
              await requestAccountDeletion()
              setDeleteStatus('Deletion requested. Your data is removed within 24 hours.')
            } catch {
              setDeleteStatus('Could not request deletion. Try again.')
            }
          }}
        >
          Delete account
        </Button>
        {deleteStatus ? (
          <p role="status" className="text-muted-foreground text-xs">
            {deleteStatus}
          </p>
        ) : null}
      </div>
    </div>
  )
}
