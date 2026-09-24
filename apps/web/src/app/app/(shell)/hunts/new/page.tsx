import type { Metadata } from 'next'
import { HuntForm } from '@/components/hunt-form'
import { PageHeader } from '@/components/page-header'

export const metadata: Metadata = { title: 'New hunt' }

export default function NewHuntPage() {
  return (
    <>
      <PageHeader
        title="New hunt"
        description="Everyone in an area gets the same checking speed."
      />
      <HuntForm />
    </>
  )
}
