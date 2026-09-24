import { LockIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'
import { type ErrorAction, type ErrorKind, errorPages } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Wordmark } from './wordmark'

/**
 * The one layout behind every error page: a swinging price tag carrying the status code (the
 * thing a deal hunter looks for), a headline, what happened, one main action, and small print
 * with the code and, for server errors, a reference. Search-radius rings sit behind the tag.
 */
export function ErrorPage({
  kind,
  reference,
  action,
  className,
}: {
  kind: ErrorKind
  /** Shown for server errors, e.g. Next's error digest. */
  reference?: string
  /** Extra first action, e.g. a "Try again" button that resets the error boundary. */
  action?: React.ReactNode
  className?: string
}) {
  const copy = errorPages[kind]
  const secondary: ErrorAction | undefined = 'secondary' in copy ? copy.secondary : undefined
  const plain = 'plain' in copy && copy.plain
  const showsReference = 'showsReference' in copy && copy.showsReference

  return (
    <div className={cn('flex min-h-dvh flex-col bg-background text-foreground', className)}>
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center px-4 sm:px-6">
        <Link href="/" className="rounded-lg" aria-label="Nabvy home">
          <Wordmark />
        </Link>
      </header>

      <main
        id="main"
        className="mx-auto grid w-full max-w-5xl flex-1 place-items-center px-4 py-10 sm:px-6"
      >
        <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="mx-auto w-full max-w-xs md:max-w-sm">
            {plain ? <PlainMark /> : <PriceTag code={String(copy.status)} label={copy.tag} />}
          </div>

          <div className="grid gap-5 text-center md:text-left">
            <p className="font-medium text-muted-foreground text-sm tabular">Error {copy.status}</p>
            <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
              {copy.title}
            </h1>
            <p className="text-pretty text-lg text-muted-foreground">{copy.description}</p>
            <div className="flex flex-wrap justify-center gap-3 md:justify-start">
              {action}
              <Button asChild size="lg" variant={action ? 'outline' : 'primary'}>
                <ActionLink action={copy.primary} />
              </Button>
              {secondary ? (
                <Button asChild size="lg" variant="ghost">
                  <ActionLink action={secondary} />
                </Button>
              ) : null}
            </div>
            {showsReference && reference ? (
              <p className="text-muted-foreground text-sm">
                Reference{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Quote
                it if you contact us.
              </p>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-muted-foreground text-sm sm:px-6">
        <nav aria-label="Helpful links" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link className="hover:text-foreground" href="/">
            Home
          </Link>
          {plain ? null : (
            <>
              <Link className="hover:text-foreground" href="/app/deals">
                Deals
              </Link>
              <Link className="hover:text-foreground" href="/app/hunts">
                Hunts
              </Link>
            </>
          )}
          <Link className="hover:text-foreground" href="mailto:hello@nabvy.com">
            Contact
          </Link>
        </nav>
      </footer>
    </div>
  )
}

function ActionLink({ action, ...props }: { action: ErrorAction } & React.ComponentProps<'a'>) {
  return action.href.startsWith('mailto:') ? (
    <a href={action.href} {...props}>
      {action.label}
    </a>
  ) : (
    <Link href={action.href} {...props}>
      {action.label}
    </Link>
  )
}

/** A price tag on a string, swinging gently (still when reduced motion is on). */
function PriceTag({ code, label }: { code: string; label: string }) {
  return (
    <svg viewBox="0 0 320 260" className="w-full overflow-visible" aria-hidden focusable="false">
      {/* Search-radius rings: the hunt that did not find this page. */}
      <g className="fill-none stroke-border" strokeWidth="2" strokeDasharray="4 8">
        <circle cx="170" cy="150" r="70" />
        <circle cx="170" cy="150" r="105" />
        <circle cx="170" cy="150" r="140" className="opacity-60" />
      </g>
      <circle cx="46" cy="30" r="6" className="fill-muted-foreground" />
      <g className="animate-tag-swing" style={{ transformOrigin: '46px 30px' }}>
        <path
          d="M46 30 C 58 80, 78 128, 105 161"
          className="fill-none stroke-muted-foreground"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <g transform="rotate(-10 170 150)">
          <path
            d="M76 150 L110 104 Q114 98 122 98 L262 98 Q274 98 274 110 L274 190 Q274 202 262 202 L122 202 Q114 202 110 196 Z"
            className="fill-primary"
          />
          <circle cx="104" cy="150" r="9" className="fill-background" />
          <text
            x="192"
            y="160"
            textAnchor="middle"
            className="fill-primary-foreground font-bold tabular"
            style={{ fontSize: 58, letterSpacing: '-0.02em' }}
          >
            {code}
          </text>
          <text
            x="192"
            y="186"
            textAnchor="middle"
            className="fill-primary-foreground font-semibold uppercase"
            style={{ fontSize: 13, letterSpacing: '0.14em', opacity: 0.85 }}
          >
            {label}
          </text>
        </g>
      </g>
    </svg>
  )
}

/** The restricted notice stays plain: no illustration, no joke. */
function PlainMark() {
  return (
    <span className="mx-auto flex size-24 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <LockIcon className="size-10" aria-hidden />
    </span>
  )
}
