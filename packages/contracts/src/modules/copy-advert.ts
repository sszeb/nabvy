// Contracts of the copy-advert module (packages/contracts/README.md): its schemas, its events and
// its published view rows. Import from '@nabvy/contracts/modules/copy-advert'.
//
// Finds adverts copied and mass-posted across city pages, counts each copy cluster once for
// internal readers, and publishes a per-listing flag with facts only (services/copy-advert/README.md;
// docs/design/drafts/copy-advert.md).
//
// View rows are written here as Zod, as listing-ingest's and detail-evidence's are: drizzle-zod is
// not a dependency yet, and every other merged module made the same choice (services/copy-advert/README.md,
// "Decisions"). This departs from docs/design/drafts/copy-advert.md section 0, change 11, which
// proposed drizzle-zod for this module specifically.

import { z } from 'zod'
import { defineEvents, IsoTimestamp, Uuid } from '../index'

export const module = 'copy-advert'

/** `copy-advert@<n>`: the normalisation and threshold version every fingerprint and link carries. */
export const CopyAdvertRuleVersion = z.string().regex(/^copy-advert@\d+$/)
export type CopyAdvertRuleVersion = z.infer<typeof CopyAdvertRuleVersion>

/** How a link between two listings was decided (docs/design/drafts/copy-advert.md 4.4). */
export const CopyAdvertBasis = z.enum([
  'exact_text',
  'near_text',
  'candidate',
  'lookalike',
  'text_copy',
])
export type CopyAdvertBasis = z.infer<typeof CopyAdvertBasis>

/**
 * The thresholds of one rule version, versioned together with the rule (section 0, change 1: a
 * departure from rule 14, which the coordinator confirmed; thresholds live in
 * services/copy-advert/src/domain/rules.ts, not packages/config).
 */
export const CopyAdvertRuleConfig = z.strictObject({
  titleMinChars: z.int().min(1),
  descMinChars: z.int().min(1),
  nearText: z.number().gt(0).lte(1),
  textCopy: z.number().gt(0).lte(1),
  textCopyMinChars: z.int().min(1),
  windowDays: z.int().min(1),
  massPostedMinTowns: z.int().min(2),
  flagMinTowns: z.int().min(2),
  candidateDailyCap: z.int().min(0),
})
export type CopyAdvertRuleConfig = z.infer<typeof CopyAdvertRuleConfig>

/**
 * User-facing: facts only (docs/design/drafts/copy-advert.md 4.8, section 6). No cluster key, no
 * other listing or count of them, nothing about accounts. Computed without the listing's own town.
 */
export const CopyAdvertFlag = z.strictObject({
  listingId: Uuid,
  towns: z.int().min(2),
  spanDays: z.int().min(0),
  windowDays: z.int().min(1),
  ruleVersion: CopyAdvertRuleVersion,
})
export type CopyAdvertFlag = z.infer<typeof CopyAdvertFlag>

/** A signed-in user's report of a listing's flag (`report()`, called inside `withUser`). */
export const CopyAdvertReportInput = z.strictObject({
  listingId: Uuid,
  reason: z.enum(['not_a_copy', 'other']),
})
export type CopyAdvertReportInput = z.infer<typeof CopyAdvertReportInput>

/** An admin correction (`applyCorrection()`), audited through `@nabvy/audit-log`. */
export const CopyAdvertCorrection = z.strictObject({
  action: z.enum(['not_copy_pair', 'exclude_listing', 'confirm_pair']),
  listingA: Uuid,
  listingB: Uuid.optional(),
  reason: z.string().trim().min(1).max(500),
  actorUserId: Uuid,
})
export type CopyAdvertCorrection = z.infer<typeof CopyAdvertCorrection>

export const CopyAdvertErrorCode = z.enum([
  'copy-advert.unknown_listing',
  'copy-advert.invalid_correction',
])
export type CopyAdvertErrorCode = z.infer<typeof CopyAdvertErrorCode>

// -------------------------------------------------------------------------------------------
// View rows (packages/db/src/schema/copy-advert.ts). Checked against the Drizzle view columns by
// services/copy-advert/test/contracts.test.ts, never derived (see the file header).
// -------------------------------------------------------------------------------------------

/** One row of `copy_advert.v_members`: an active, confirmed member of a cluster. */
export const vMembersRow = z.strictObject({
  clusterKey: z.string(),
  listingId: Uuid,
  sourceListingId: z.string(),
  cityPageId: z.string().nullable(),
  basis: CopyAdvertBasis,
  joinedAt: IsoTimestamp,
  memberSetHash: z.string(),
})
export type CopyAdvertVMembersRow = z.infer<typeof vMembersRow>

/** One row of `copy_advert.v_cluster_facts`: per-cluster facts (docs/design/drafts/copy-advert.md 4.8). */
export const vClusterFactsRow = z.strictObject({
  clusterKey: z.string(),
  listingCount: z.int().min(1),
  townCount: z.int().min(1),
  spanDays: z.int().min(0),
  spreadKm: z.number().nullable(),
  priceMinor: z.int().nullable(),
  currency: z.enum(['GBP', 'EUR']).nullable(),
  massPosted: z.boolean(),
  ruleVersion: CopyAdvertRuleVersion,
  asOf: IsoTimestamp,
})
export type CopyAdvertVClusterFactsRow = z.infer<typeof vClusterFactsRow>

/** One row of `copy_advert.v_listing_copy_facts`: per-listing facts, own town left out. */
export const vListingCopyFactsRow = z.strictObject({
  listingId: Uuid,
  clusterKey: z.string().nullable(),
  otherListings: z.int().min(0),
  towns: z.int().min(0),
  spanDays: z.int().min(0),
  spreadKm: z.number().nullable(),
  massPosted: z.boolean(),
  wouldShow: z.boolean(),
  ruleVersion: CopyAdvertRuleVersion.nullable(),
  textCopyCount: z.int().min(0),
})
export type CopyAdvertVListingCopyFactsRow = z.infer<typeof vListingCopyFactsRow>

/** One row of `copy_advert.v_links`: developer and review evidence between two listings. */
export const vLinksRow = z.strictObject({
  listingA: Uuid,
  listingB: Uuid,
  basis: CopyAdvertBasis,
  similarity: z.number().nullable(),
  photoIdMatch: z.boolean(),
  decidedAt: IsoTimestamp,
})
export type CopyAdvertVLinksRow = z.infer<typeof vLinksRow>

/** The event this module publishes (rule 7). */
export const events = defineEvents(module, {
  'copy-advert.clustered': {
    1: z.object({ listingIds: z.array(Uuid).min(1).max(500), ruleVersion: CopyAdvertRuleVersion }),
  },
})
