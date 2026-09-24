'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import type { Preferences } from '@/data/types'
import { themeOptions } from './theme-toggle'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { NativeSelect } from './ui/input'
import { FieldHint, Label } from './ui/label'
import { RadioCard, RadioGroup } from './ui/radio-group'
import { Switch } from './ui/switch'

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

/** UI only: task 4.6b saves marketing consent and the digest day through procedures. */
export function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
          <CardDescription>
            Alerts and account emails are always sent. These are optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {preferences.marketing.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4">
              <div className="grid gap-1">
                <Label htmlFor={`pref-${item.id}`}>{item.label}</Label>
                <FieldHint>{item.description}</FieldHint>
              </div>
              <Switch id={`pref-${item.id}`} defaultChecked={item.enabled} />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <div className="grid gap-1">
              <p className="font-medium text-sm">Pause optional emails</p>
              <FieldHint>For 30 days, then they resume.</FieldHint>
            </div>
            <Button variant="outline" size="sm">
              Pause for 30 days
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Weekly review</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-xs gap-2">
          <Label htmlFor="digest-day">Day to send it</Label>
          <NativeSelect id="digest-day" defaultValue={preferences.digestDay}>
            {days.map((day) => (
              <option key={day} value={day}>
                {day[0]?.toUpperCase()}
                {day.slice(1)}
              </option>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            aria-label="Theme"
            className="sm:grid-cols-3"
            value={mounted ? (theme ?? 'system') : 'system'}
            onValueChange={setTheme}
          >
            {themeOptions.map((option) => (
              <RadioCard key={option.value} value={option.value}>
                <span className="inline-flex items-center gap-2 font-medium text-sm">
                  <option.icon className="size-4" aria-hidden />
                  {option.label}
                </span>
              </RadioCard>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  )
}
