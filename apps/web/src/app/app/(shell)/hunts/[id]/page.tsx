import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HuntForm } from '@/components/hunt-form'
import { PageHeader } from '@/components/page-header'
import { getHunt } from '@/data'

export const metadata: Metadata = { title: 'Edit hunt' }

export default async function EditHuntPage({ params }: { params: Promise<{ id: string }> }) {
  const hunt = await getHunt((await params).id)
  if (!hunt) notFound()
  return (
    <>
      <PageHeader title="Edit hunt" description={hunt.name} />
      <HuntForm hunt={hunt} />
    </>
  )
}
