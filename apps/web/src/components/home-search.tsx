import { ArrowUpIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import type { Hunt } from '@/data/types'

/**
 * The prominent centred search on the home screen. A plain GET form to the deal feed, so it
 * works without JavaScript and the query lands in the URL.
 */
export function HomeSearch({ hunts, defaultValue }: { hunts: Hunt[]; defaultValue?: string }) {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <form action="/app/deals" className="relative">
        <label htmlFor="home-search" className="sr-only">
          Search deals near you
        </label>
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id="home-search"
          name="q"
          type="search"
          defaultValue={defaultValue}
          placeholder="Search deals near you, for example RTX 3070"
          autoComplete="off"
          className="h-14 w-full rounded-full border border-input bg-card pr-16 pl-13 text-base shadow-soft outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute top-1/2 right-2.5 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary-hover"
        >
          <ArrowUpIcon className="size-5" aria-hidden />
        </button>
      </form>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Your hunts">
        {hunts.map((hunt) => (
          <li key={hunt.id}>
            <Link
              href={`/app/deals?hunt=${hunt.id}`}
              className="inline-flex h-8 items-center rounded-full border px-3.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
            >
              {hunt.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
