import { StatusChip } from './status-chip'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

/**
 * The Facebook provider kill switch, read-only (task 4.3af, audit A2). It shows the server's
 * state and never changes it: a control that flipped local state and said "Stopped" would tell
 * an admin in an incident that spending had stopped when it had not. It becomes a control when
 * it calls an audited `switches.set` procedure (task 4.3ag), and the label then shows the server
 * state after the commit.
 */
export function ProviderSwitch({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <StatusChip tone={enabled ? 'success' : 'danger'}>
        {enabled ? 'Collecting' : 'Stopped'}
      </StatusChip>
      <Label htmlFor="provider-switch" className="sr-only">
        Facebook collection
      </Label>
      <Switch id="provider-switch" checked={enabled} disabled />
      <span className="text-muted-foreground text-xs">
        Read-only until the audited switch lands
      </span>
    </div>
  )
}
