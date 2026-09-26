'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { saveHunt } from '@/app/app/(shell)/hunts/actions'
import type { Hunt, WantManagerCadenceSeconds } from '@/data/types'
import { CADENCE_DEFAULT_SECONDS } from '@/lib/cadence'
import { CadenceSlider } from './cadence-slider'
import { Button } from './ui/button'
import { Input, NativeSelect } from './ui/input'
import { FieldHint, Label } from './ui/label'
import { Switch } from './ui/switch'

const radii = [10, 25, 40, 60]

/**
 * Create or edit a hunt (task L1), saved through `want-manager`'s functions. A want has no
 * `name` or `category` field, and never stores the postcode it was created from (README.md:
 * "the postcode is never stored"), so "What to look for" becomes the want's GPU criteria and
 * the postcode is asked for again on every save, including edits. Recorded in
 * docs/questions/L1-web.md.
 */
export function HuntForm({ hunt }: { hunt?: Hunt }) {
  const router = useRouter()
  const [active, setActive] = useState(hunt ? hunt.status === 'active' : true)
  const [savedCadence, setSavedCadence] = useState<WantManagerCadenceSeconds>(
    hunt?.cadenceSeconds ?? CADENCE_DEFAULT_SECONDS,
  )
  const [previewCadence, setPreviewCadence] = useState<WantManagerCadenceSeconds>(savedCadence)
  // No estimate until want-manager (task 1.8e) ships its estimate procedure: the slider then shows
  // no credit or cadence line rather than a client-side number (CLAUDE.md, "No invented numbers").
  const cadenceEstimate = null
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => saveHunt(formData),
    {},
  )
  return (
    <form className="grid max-w-xl gap-6" action={formAction}>
      <input type="hidden" name="wantId" value={hunt?.id ?? ''} />
      <input type="hidden" name="active" value={String(active)} />
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="hunt-terms">What to look for</Label>
        <Input
          id="hunt-terms"
          name="terms"
          defaultValue={hunt?.terms.join(', ')}
          required
          aria-describedby="hunt-terms-hint"
          placeholder="rtx 3070, rtx 3080"
        />
        <FieldHint id="hunt-terms-hint">
          Separate terms with commas. Each becomes one spec criterion.
        </FieldHint>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="hunt-postcode">Postcode</Label>
          <Input
            id="hunt-postcode"
            name="postcode"
            required
            className="uppercase"
            placeholder="PO19 1SB"
            aria-describedby="hunt-postcode-hint"
          />
          <FieldHint id="hunt-postcode-hint">
            Never stored — used once to find the nearest checked area, every time you save.
          </FieldHint>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hunt-radius">Radius</Label>
          <NativeSelect id="hunt-radius" name="radius" defaultValue={String(hunt?.radiusKm ?? 40)}>
            {radii.map((radius) => (
              <option key={radius} value={radius}>
                {radius} km
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="hunt-max">Highest ask (optional)</Label>
          <Input
            id="hunt-max"
            name="maxAsk"
            inputMode="decimal"
            defaultValue={hunt?.maxAsk ? String(hunt.maxAsk.amountMinor / 100) : ''}
            placeholder="£"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hunt-delivery">Delivery</Label>
          <NativeSelect id="hunt-delivery" name="delivery" defaultValue={hunt?.delivery ?? 'all'}>
            <option value="all">Collection or delivery</option>
            <option value="collection">Collection only</option>
            <option value="posted">Delivery only</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-2">
        <input type="hidden" name="cadenceSeconds" value={savedCadence} />
        <CadenceSlider
          value={previewCadence}
          onValueChange={setPreviewCadence}
          onValueCommit={(seconds) => {
            setPreviewCadence(seconds)
            setSavedCadence(seconds)
          }}
          estimate={cadenceEstimate}
        />
      </div>
      <p className="text-muted-foreground text-sm">
        Where alerts go is set once for every hunt, in{' '}
        <Link href="/app/account/preferences" className="text-link underline underline-offset-4">
          Preferences
        </Link>
        .
      </p>
      {hunt ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <Label htmlFor="hunt-active">Active</Label>
            <FieldHint>A paused hunt keeps its settings and sends nothing.</FieldHint>
          </div>
          <Switch id="hunt-active" checked={active} onCheckedChange={setActive} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : hunt ? 'Save changes' : 'Create hunt'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/app/hunts')}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
