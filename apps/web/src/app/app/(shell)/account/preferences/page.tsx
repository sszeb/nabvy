import type { Metadata } from 'next'
import { PageHeader } from '@/components/page-header'
import { PreferencesForm } from '@/components/preferences-form'
import { getPreferences } from '@/data'

export const metadata: Metadata = { title: 'Preferences' }

export default async function PreferencesPage() {
  const preferences = await getPreferences()
  return (
    <div className="grid max-w-2xl gap-2">
      <PageHeader title="Preferences" />
      <PreferencesForm preferences={preferences} />
    </div>
  )
}
