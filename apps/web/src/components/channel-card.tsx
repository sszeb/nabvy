'use client'

import { BellIcon, MailIcon, SendIcon } from 'lucide-react'
import { useState } from 'react'
import type { Channel, ChannelKind } from '@/data/types'
import { channelName } from './hunt-card'
import { StatusChip } from './status-chip'
import { Button } from './ui/button'

const icons: Record<ChannelKind, typeof BellIcon> = {
  telegram: SendIcon,
  push: BellIcon,
  email: MailIcon,
}

const statusText: Record<Channel['status'], string> = {
  linked: 'Linked',
  not_linked: 'Not linked',
  needs_install: 'Needs the app installed',
}

/** One alert channel with its state and its next step. UI only until task 4.3a. */
export function ChannelCard({ channel }: { channel: Channel }) {
  const [code, setCode] = useState<string | null>(null)
  const Icon = icons[channel.kind]
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-muted">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="grid gap-0.5">
            <p className="font-medium">{channelName[channel.kind]}</p>
            <p className="text-muted-foreground text-xs">{channel.detail}</p>
          </div>
        </div>
        <StatusChip
          tone={
            channel.status === 'linked'
              ? 'success'
              : channel.status === 'needs_install'
                ? 'warning'
                : 'neutral'
          }
        >
          {statusText[channel.status]}
        </StatusChip>
      </div>
      {channel.kind === 'telegram' ? (
        channel.status === 'linked' ? (
          <Button variant="outline" size="sm" className="w-fit">
            Unlink Telegram
          </Button>
        ) : code ? (
          <p className="text-sm">
            Open the Nabvy bot in Telegram and send{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">{code}</code>
          </p>
        ) : (
          <Button size="sm" className="w-fit" onClick={() => setCode('/start 7F3K-Q9')}>
            Link Telegram
          </Button>
        )
      ) : null}
      {channel.kind === 'push' ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={channel.status === 'needs_install'}
        >
          Turn on notifications
        </Button>
      ) : null}
      {channel.kind === 'email' ? (
        <Button variant="outline" size="sm" className="w-fit" asChild>
          <a href="/app/account/preferences">Email preferences</a>
        </Button>
      ) : null}
    </div>
  )
}
