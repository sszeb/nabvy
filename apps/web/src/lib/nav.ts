import {
  BellIcon,
  CrosshairIcon,
  HouseIcon,
  InboxIcon,
  type LucideIcon,
  ScanLineIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TagIcon,
  UserIcon,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Shown in the mobile bottom bar (at most five). */
  mobile?: boolean
  /** Match only the exact path, not its children. */
  exact?: boolean
}

export type NavSection = { title?: string; items: NavItem[] }

/** One source for the sidebar, the mobile bar and the command palette. */
export const appNav: NavSection[] = [
  {
    items: [
      { href: '/app', label: 'Home', icon: HouseIcon, mobile: true, exact: true },
      { href: '/app/deals', label: 'Deals', icon: TagIcon, mobile: true },
      { href: '/app/hunts', label: 'Hunts', icon: CrosshairIcon, mobile: true },
      { href: '/app/alerts', label: 'Alerts', icon: BellIcon, mobile: true },
    ],
  },
  {
    title: 'Tools',
    items: [{ href: '/app/scan', label: 'Scan', icon: ScanLineIcon }],
  },
  {
    title: 'Account',
    items: [
      { href: '/app/account', label: 'Account', icon: UserIcon, mobile: true, exact: true },
      { href: '/app/account/preferences', label: 'Preferences', icon: SlidersHorizontalIcon },
    ],
  },
]

export const adminNav: NavSection[] = [
  {
    title: 'Admin',
    items: [
      { href: '/admin', label: 'Overview', icon: SettingsIcon, mobile: true, exact: true },
      { href: '/admin/review', label: 'Review console', icon: ShieldCheckIcon, mobile: true },
      { href: '/app', label: 'Back to app', icon: InboxIcon, mobile: true, exact: true },
    ],
  },
]

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
