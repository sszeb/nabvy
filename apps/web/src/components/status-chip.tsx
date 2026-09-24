import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export type StatusTone = 'success' | 'running' | 'warning' | 'danger' | 'neutral' | 'paused'

const chip = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs',
  {
    variants: {
      tone: {
        success: 'bg-success text-success-foreground',
        running: 'bg-accent text-accent-foreground',
        warning: 'bg-warning text-warning-foreground',
        danger: 'bg-danger text-danger-foreground',
        neutral: 'bg-muted text-muted-foreground',
        paused: 'bg-info text-info-foreground',
      },
    },
  },
)

const dot: Record<StatusTone, string> = {
  success: 'bg-success-foreground',
  running: 'bg-accent-foreground animate-skeleton',
  warning: 'bg-warning-foreground',
  danger: 'bg-danger-foreground',
  neutral: 'bg-muted-foreground',
  paused: 'bg-info-foreground',
}

/** A status chip for tables and cards, in the manner of a run console. Text carries the meaning; colour only reinforces it. */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn(chip({ tone }), className)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', dot[tone])} />
      {children}
    </span>
  )
}

const runTones = {
  succeeded: 'success',
  running: 'running',
  failed: 'danger',
  aborted: 'warning',
  queued: 'neutral',
  delivered: 'success',
  failed_delivery: 'danger',
  active: 'success',
  paused: 'paused',
  open: 'warning',
  corrected: 'success',
  dismissed: 'neutral',
} as const satisfies Record<string, StatusTone>

export function toneFor(status: keyof typeof runTones): StatusTone {
  return runTones[status]
}
