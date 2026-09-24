import { CrosshairIcon, PlusIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { HuntCard } from '@/components/hunt-card'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { getAsOf, listHunts } from '@/data'

export const metadata: Metadata = { title: 'Hunts' }

export default async function HuntsPage() {
  const [hunts, asOf] = await Promise.all([listHunts(), getAsOf()])
  return (
    <>
      <PageHeader
        title="Hunts"
        description="What Nabvy watches for you, and where."
        actions={
          <Button asChild>
            <Link href="/app/hunts/new">
              <PlusIcon aria-hidden />
              New hunt
            </Link>
          </Button>
        }
      />
      {hunts.length === 0 ? (
        <EmptyState
          icon={CrosshairIcon}
          title="No hunts yet"
          description="A hunt is a postcode, a radius and what you are after."
          action={
            <Button asChild>
              <Link href="/app/hunts/new">Create a hunt</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {hunts.map((hunt) => (
            <HuntCard key={hunt.id} hunt={hunt} asOf={asOf} />
          ))}
        </div>
      )}
    </>
  )
}
