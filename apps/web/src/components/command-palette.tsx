'use client'

import { Command } from 'cmdk'
import { MonitorIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon, TagIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { appNav } from '@/lib/nav'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Kbd } from './ui/kbd'

export type PaletteDeal = { id: string; title: string; town: string }

type PaletteContext = { open: () => void }

const Context = React.createContext<PaletteContext>({ open: () => undefined })

export function useCommandPalette() {
  return React.useContext(Context)
}

const groupHeading =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs'

const itemClass =
  'flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground'

/**
 * The command palette: jump to any screen, open a recent deal, start a hunt or change theme.
 * Opens with Ctrl+K or Cmd+K anywhere in the app, and from the search button in the top bar.
 */
export function CommandPaletteProvider({
  deals,
  children,
}: {
  deals: PaletteDeal[]
  children: React.ReactNode
}) {
  const [isOpen, setOpen] = React.useState(false)
  const router = useRouter()
  const { setTheme } = useTheme()

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  const value = React.useMemo(() => ({ open: () => setOpen(true) }), [])

  return (
    <Context.Provider value={value}>
      {children}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showClose={false}>
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Search screens, deals and actions
          </DialogDescription>
          <Command label="Command palette" className="flex max-h-[60vh] flex-col">
            <div className="flex items-center gap-2 border-b px-4">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Command.Input
                placeholder="Search screens, deals and actions"
                className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-muted-foreground text-sm">
                Nothing matches that
              </Command.Empty>
              <Command.Group heading="Go to" className={groupHeading}>
                {appNav.flatMap((section) =>
                  section.items.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={`go ${item.label}`}
                      onSelect={() => run(() => router.push(item.href))}
                      className={itemClass}
                    >
                      <item.icon aria-hidden />
                      {item.label}
                    </Command.Item>
                  )),
                )}
              </Command.Group>
              <Command.Group heading="Recent deals" className={groupHeading}>
                {deals.map((deal) => (
                  <Command.Item
                    key={deal.id}
                    value={`deal ${deal.title} ${deal.town}`}
                    onSelect={() => run(() => router.push(`/app/deal/${deal.id}`))}
                    className={itemClass}
                  >
                    <TagIcon aria-hidden />
                    <span className="truncate">{deal.title}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                      {deal.town}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={groupHeading}>
                <Command.Item
                  value="new hunt"
                  onSelect={() => run(() => router.push('/app/hunts/new'))}
                  className={itemClass}
                >
                  <PlusIcon aria-hidden />
                  New hunt
                </Command.Item>
                <Command.Item
                  value="theme light"
                  onSelect={() => run(() => setTheme('light'))}
                  className={itemClass}
                >
                  <SunIcon aria-hidden />
                  Light theme
                </Command.Item>
                <Command.Item
                  value="theme dark"
                  onSelect={() => run(() => setTheme('dark'))}
                  className={itemClass}
                >
                  <MoonIcon aria-hidden />
                  Dark theme
                </Command.Item>
                <Command.Item
                  value="theme system"
                  onSelect={() => run(() => setTheme('system'))}
                  className={itemClass}
                >
                  <MonitorIcon aria-hidden />
                  Match the system theme
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  )
}
