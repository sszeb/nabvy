'use client'

import { CheckCircle2Icon } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input, Textarea } from './ui/input'
import { FieldHint, Label } from './ui/label'

/** UI only: task 0.5a stores the entry in the waitlist table through a procedure. */
export function WaitlistForm() {
  const [done, setDone] = useState(false)
  if (done) {
    return (
      <div
        role="status"
        className="grid justify-items-center gap-3 rounded-2xl border bg-card p-8 text-center"
      >
        <CheckCircle2Icon className="size-8 text-primary" aria-hidden />
        <p className="font-medium">You are on the list</p>
        <p className="max-w-sm text-muted-foreground text-sm">
          We will email you when Nabvy covers your area. You can leave the list at any time from
          that email.
        </p>
      </div>
    )
  }
  return (
    <form
      className="grid gap-5 rounded-2xl border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault()
        setDone(true)
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="postcode">Postcode</Label>
        <Input
          id="postcode"
          name="postcode"
          autoComplete="postal-code"
          required
          className="uppercase"
          aria-describedby="postcode-hint"
        />
        <FieldHint id="postcode-hint">Only the first half is kept, for example PO19.</FieldHint>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="wanted">What are you looking for</Label>
        <Textarea
          id="wanted"
          name="wanted"
          placeholder="For example: RTX 3070, gaming PC, Steam Deck"
        />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="marketing" name="marketing" />
        <Label htmlFor="marketing" className="font-normal leading-snug">
          Send me Nabvy Daily and occasional product news. You can unsubscribe in one click.
        </Label>
      </div>
      <Button type="submit" size="lg">
        Join the waitlist
      </Button>
    </form>
  )
}
