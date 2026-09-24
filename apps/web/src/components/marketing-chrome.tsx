import Link from 'next/link'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Wordmark } from './wordmark'

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="mr-auto rounded-lg" aria-label="Nabvy home">
          <Wordmark />
        </Link>
        <nav aria-label="Site" className="hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/#how-it-works">How it works</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/pricing">Pricing</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </nav>
        <ThemeToggle />
        <Button size="sm" asChild>
          <Link href="/waitlist">Join the waitlist</Link>
        </Button>
      </div>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-[1fr_auto] sm:px-6">
        <div className="grid gap-2">
          <Wordmark />
          <p className="max-w-md text-muted-foreground">
            Second-hand deals near you in the UK and Ireland. Estimates, not advice. Nabvy is not
            affiliated with Facebook or Meta.
          </p>
        </div>
        <nav aria-label="Footer" className="grid content-start gap-2 text-muted-foreground">
          <Link className="hover:text-foreground" href="/pricing">
            Pricing
          </Link>
          <Link className="hover:text-foreground" href="/waitlist">
            Waitlist
          </Link>
          <Link className="hover:text-foreground" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  )
}
