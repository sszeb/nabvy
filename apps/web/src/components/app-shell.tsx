'use client'

import { MenuIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type * as React from 'react'
import { useState } from 'react'
import { adminNav, appNav, isActive, type NavSection } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { CommandPaletteProvider, type PaletteDeal } from './command-palette'
import { SearchTrigger } from './search-trigger'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './ui/sheet'
import { Wordmark } from './wordmark'

function NavList({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="grid gap-5">
      {sections.map((section) => (
        <div key={section.title ?? 'main'} className="grid gap-0.5">
          {section.title ? (
            <p className="px-3 pb-1 font-medium text-muted-foreground text-xs">{section.title}</p>
          ) : null}
          {section.items.map((item) => {
            const active = isActive(item, pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-muted',
                  active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <item.icon
                  className={cn('size-4 shrink-0', active && 'text-primary')}
                  aria-hidden
                />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function MobileBar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname()
  const items = sections.flatMap((section) => section.items.filter((item) => item.mobile))
  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md justify-around">
        {items.map((item) => {
          const active = isActive(item, pathname)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <item.icon className={cn('size-5', active && 'text-primary')} aria-hidden />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The signed-in shell: a left sidebar with icon sections on desktop, a top bar with search and
 * the command palette, and on mobile a bottom bar plus a sheet with the full navigation.
 */
export function AppShell({
  nav,
  deals,
  badge,
  children,
}: {
  /** Which navigation to show. A key, not the sections, because icons cannot cross to the client as props. */
  nav: 'app' | 'admin'
  deals: PaletteDeal[]
  badge?: string
  children: React.ReactNode
}) {
  const sections = nav === 'admin' ? adminNav : appNav
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <CommandPaletteProvider deals={deals}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-surface px-3 py-4 md:flex">
          <Link href="/app" className="flex items-center gap-2 rounded-lg px-2">
            <Wordmark />
            {badge ? (
              <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground text-xs">
                {badge}
              </span>
            ) : null}
          </Link>
          <div className="flex-1 overflow-y-auto">
            <NavList sections={sections} />
          </div>
          <p className="px-3 text-muted-foreground text-xs">Public beta · Facebook Marketplace</p>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-5">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <MenuIcon aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="gap-6 px-3 py-4">
                <SheetTitle className="px-2">
                  <Wordmark />
                </SheetTitle>
                <SheetDescription className="sr-only">Navigation</SheetDescription>
                <NavList sections={sections} onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <Link href="/app" className="md:hidden" aria-label="Nabvy home">
              <Wordmark compact />
            </Link>
            <div className="flex flex-1 justify-center md:justify-start">
              <SearchTrigger />
            </div>
            <ThemeToggle />
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 px-4 pt-6 pb-24 outline-none sm:px-6 md:pb-10 lg:px-10"
          >
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
      <MobileBar sections={sections} />
    </CommandPaletteProvider>
  )
}
