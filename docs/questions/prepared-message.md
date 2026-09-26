# Open questions: prepared-message

- **2026-09-25, w2 prepared-message: the wording of the message and checklist.** The card says
  the template wording is the owner's, and no wording exists. Option taken: a plain placeholder
  template (`services/prepared-message/src/domain/template.ts`, version `placeholder-1`): a
  greeting, one question per unknown part ("Which graphics card (GPU) does it have?"), a thank
  you, and checklist checks "Check in person: the listing says "…"". Conservative because the
  module's switch stays off until the owner approves the wording, so no user sees it, and every
  message carries its template version.
- **2026-09-25, w2 prepared-message: where the pack template lives.** The card reads "the pack
  template" (`docs/web-app.md:30-32`), but the pack format (`CategoryPack`) has no message
  template, and `packages/packs` is outside this module's files. Option taken: the template sits
  in the module, typed by the `PreparedMessageTemplate` contract and keyed by pack ID `gpu-pc`,
  to move into the pack (a `message` field on `CategoryPack`) once the owner sets the wording.
  Conservative because it changes no shared file and the contract is ready for the move.
