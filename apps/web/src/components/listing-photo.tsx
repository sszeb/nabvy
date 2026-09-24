import { ImageIcon } from 'lucide-react'
import { flags } from '@/lib/flags'
import { cn } from '@/lib/utils'

/**
 * The photo slot on a listing. While the listingPhotos flag is off (the default, until the owner
 * decides whether Facebook photo URLs may be displayed) it is always a neutral placeholder and
 * no photo URL is ever requested.
 */
export function ListingPhoto({
  photoCount,
  className,
  variant = 'tile',
}: {
  photoCount: number
  className?: string
  /** A 4:3 tile for cards, or a low strip for the deal page so the facts stay above the fold. */
  variant?: 'tile' | 'strip'
}) {
  if (flags.listingPhotos) {
    // Deliberately unimplemented: turning the flag on is an owner decision that comes with its
    // own task (where photo URLs come from and how long they may be shown).
    return null
  }
  return (
    <div
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-xl bg-placeholder text-placeholder-foreground',
        variant === 'tile' ? 'aspect-[4/3] flex-col' : 'h-16 px-4',
        className,
      )}
    >
      <ImageIcon className="size-6" aria-hidden />
      <span className="text-xs">
        {photoCount > 0
          ? `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'} on the listing`
          : 'No photos'}
      </span>
    </div>
  )
}
