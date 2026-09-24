'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CadenceSeconds, ChannelKind, Hunt } from '@/data/types'
import {
  CADENCE_DEFAULT_SECONDS,
  estimateCadencePlaceholderUntilWantManagerShips,
} from '@/lib/cadence'
import { CadenceSlider } from './cadence-slider'
import { channelName } from './hunt-card'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input, NativeSelect } from './ui/input'
import { FieldHint, Label } from './ui/label'
import { Switch } from './ui/switch'

/** The categories come from the category packs; the first pack is GPUs and gaming PCs. */
const categories = ['GPUs and gaming PCs']
const radii = [10, 25, 40, 60]
const channelKinds: ChannelKind[] = ['telegram', 'push', 'email']

/** Create or edit a hunt. UI only: task 4.1 saves it through the hunts procedures. */
export function HuntForm({ hunt }: { hunt?: Hunt }) {
  const router = useRouter()
  const [active, setActive] = useState(hunt ? hunt.status === 'active' : true)
  const [savedCadence, setSavedCadence] = useState<CadenceSeconds>(
    hunt?.cadenceSeconds ?? CADENCE_DEFAULT_SECONDS,
  )
  const [previewCadence, setPreviewCadence] = useState<CadenceSeconds>(savedCadence)
  const cadenceEstimate = estimateCadencePlaceholderUntilWantManagerShips(previewCadence)
  return (
    <form
      className="grid max-w-xl gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        router.push('/app/hunts')
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="hunt-name">Name</Label>
        <Input
          id="hunt-name"
          name="name"
          defaultValue={hunt?.name}
          required
          placeholder="For example: RTX cards near home"
        />
      </div>
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
        <FieldHint id="hunt-terms-hint">Separate terms with commas.</FieldHint>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="hunt-category">Category</Label>
        <NativeSelect
          id="hunt-category"
          name="category"
          defaultValue={hunt?.category ?? categories[0]}
        >
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="hunt-postcode">Postcode district</Label>
          <Input
            id="hunt-postcode"
            name="postcode"
            defaultValue={hunt?.postcodeDistrict}
            required
            className="uppercase"
            placeholder="PO19"
          />
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
      <fieldset className="grid gap-3">
        <legend className="mb-3 font-medium text-sm">Send alerts to</legend>
        {channelKinds.map((kind) => (
          <div key={kind} className="flex items-center gap-3">
            <Checkbox
              id={`channel-${kind}`}
              name="channels"
              value={kind}
              defaultChecked={hunt ? hunt.channels.includes(kind) : kind === 'email'}
            />
            <Label htmlFor={`channel-${kind}`} className="font-normal">
              {channelName[kind]}
            </Label>
          </div>
        ))}
      </fieldset>
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
        <Button type="submit">{hunt ? 'Save changes' : 'Create hunt'}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/app/hunts')}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
