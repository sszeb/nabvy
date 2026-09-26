'use client'

import type { WantManagerPreferences } from '@nabvy/contracts/modules/want-manager'
import { useState } from 'react'
import { saveAlertPreferences } from '@/app/app/(shell)/account/preferences/actions'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { FieldHint, Label } from './ui/label'

const channelName = { push: 'Push', telegram: 'Telegram', email: 'Email' } as const

/** `want-manager`'s per-account alert preferences (task L1; services/want-manager/README.md,
 * "setPreferences"): where alerts go, and what to hide. Separate from the marketing preferences
 * above, which are `marketing-consent`'s and out of this task's scope. */
export function AlertPreferencesForm({ preferences }: { preferences: WantManagerPreferences }) {
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="grid gap-4"
      action={async (formData) => {
        await saveAlertPreferences(formData)
        setSaved(true)
      }}
    >
      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium text-sm">Send alerts to</legend>
        {(['push', 'telegram', 'email'] as const).map((kind) => (
          <div key={kind} className="flex items-center gap-3">
            <Checkbox
              id={`pref-channel-${kind}`}
              name="channels"
              value={kind}
              defaultChecked={preferences.channels.includes(kind)}
            />
            <Label htmlFor={`pref-channel-${kind}`} className="font-normal">
              {channelName[kind]}
            </Label>
          </div>
        ))}
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium text-sm">Hide from the feed</legend>
        <div className="flex items-center gap-3">
          <Checkbox id="pref-hide-noise" name="hideNoise" defaultChecked={preferences.hideNoise} />
          <Label htmlFor="pref-hide-noise" className="font-normal">
            Noise (buyer adverts, empty boxes)
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox id="pref-hide-spam" name="hideSpam" defaultChecked={preferences.hideSpam} />
          <Label htmlFor="pref-hide-spam" className="font-normal">
            Suspected copy adverts
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            id="pref-hide-multi"
            name="hideMultiQuantity"
            defaultChecked={preferences.hideMultiQuantity}
          />
          <Label htmlFor="pref-hide-multi" className="font-normal">
            Multi-quantity listings
          </Label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit">Save</Button>
        {saved ? <FieldHint>Saved.</FieldHint> : null}
      </div>
    </form>
  )
}
