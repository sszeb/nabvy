import {
  exportAccount,
  getProfile,
  getStanding,
  requestDeletion,
  updateProfile,
} from './procedures/account'
import { listSwitches, readAdvice, readBudgets, retryIncident, setSwitch } from './procedures/admin'
import { listFeed } from './procedures/feed'
import {
  getListing,
  getPreparedMessage,
  getWatch,
  unwatchListing,
  watchListing,
} from './procedures/listing'
import { getPreferences, setPreferences } from './procedures/preferences'
import { deleteWant, listWants, previewWant, setActive, upsertWant } from './procedures/wants'

/**
 * The one oRPC router for the web app (CLAUDE.md, "No database access from the browser"): every
 * read and write a screen makes goes through one of these procedures. Mounted at
 * `/api/rpc/*` (`apps/web/src/app/api/rpc/[[...rest]]/route.ts`) for the outside-world contract
 * (`docs/decisions.md`, "How parts talk to each other"); server components and server actions
 * call the same procedure functions directly with `call()`, with no HTTP round trip.
 */
export const router = {
  wants: {
    upsert: upsertWant,
    setActive,
    delete: deleteWant,
    list: listWants,
    preview: previewWant,
  },
  preferences: {
    get: getPreferences,
    set: setPreferences,
  },
  feed: {
    list: listFeed,
  },
  listing: {
    get: getListing,
    preparedMessage: getPreparedMessage,
    watch: getWatch,
    watchListing,
    unwatchListing,
  },
  account: {
    profile: getProfile,
    updateProfile,
    standing: getStanding,
    export: exportAccount,
    requestDeletion,
  },
  admin: {
    switches: {
      list: listSwitches,
      set: setSwitch,
    },
    spend: {
      budgets: readBudgets,
      advice: readAdvice,
    },
    incidents: {
      retry: retryIncident,
    },
  },
}

export type AppRouter = typeof router
