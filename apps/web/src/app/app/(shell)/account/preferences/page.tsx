import type { Metadata } from 'next'
import { getAlertPreferences } from '@/app/app/(shell)/account/preferences/actions'
import { AlertPreferencesForm } from '@/components/alert-preferences-form'
import { PageHeader } from '@/components/page-header'
import { PreferencesForm } from '@/components/preferences-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPreferences } from '@/data'

export const metadata: Metadata = { title: 'Preferences' }

export default async function PreferencesPage() {
  const [preferences, alertPreferences] = await Promise.all([
    getPreferences(),
    getAlertPreferences(),
  ])
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Preferences" />
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>
            Applies to every hunt (want-manager.README, "Decisions").
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertPreferencesForm preferences={alertPreferences} />
        </CardContent>
      </Card>
      <PreferencesForm preferences={preferences} />
    </div>
  )
}
