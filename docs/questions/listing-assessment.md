# Open questions: listing-assessment

- **2026-09-25, w2 listing-assessment: the form's values.** The card lists `form` among the
  assessment's columns without values, and the listing kind (PC, laptop, wanted or swap, not a
  PC) is parts-record's. Option taken: `ListingAssessmentForm` is `system`, `bundle` (a system
  with extras, or a bundle title word), `part` (not a container, with an offered part),
  `box_only` and `unknown`; nothing about laptops or wanted adverts is repeated here. Conservative
  because it adds no second owner of the kind and every value rests on a stated rule.
- **2026-09-25, w2 listing-assessment: a PC kind with fewer than two parts.** R1 makes a listing a
  container when two of CPU, RAM and storage are named "or when the rules cannot place it". A
  listing parts-record calls a `pc` with fewer named parts (5 in the recorded run, for example
  "Gaming pc and curved Samsung monitor" with its specs "in video") is neither. Option taken:
  such a listing is a container (`container_reason = 'kind'`), and one with an open kind is too
  (`unplaced`). Conservative because treating a PC as a container keeps its GPU "not stated" and
  its parts askable, where "not a container" would drop it from part searches.
- **2026-09-25, w2 listing-assessment: bundle extras and the bundle-price caution.** R1c names
  bundle extras and a "bundle price" caution without a list. Option taken: monitor, keyboard,
  mouse, mouse pad, headset, speakers, desk, chair, webcam and microphone, read in the title and
  the full description of containers only, and left out when optional, extra-cost or not
  included (config `extras`, `extraDemoters`); any included extra sets `bundle_price` and form
  `bundle`. The caution's wording shown to users is the owner's (question for `spec-match`).
  Conservative because an optional extra never marks the ask as covering it.
- **2026-09-25, w2 listing-assessment: stated integrated graphics only.** `gpu_state` has an
  `integrated` value; a CPU with integrated graphics (a "G" Ryzen) could imply it. Option taken:
  `integrated` only when the text says so ("integrated graphics", "onboard graphics", "Intel UHD
  Graphics" and the like); a CPU model never implies it. Conservative because no fact is inferred
  that the listing does not state.
- **2026-09-25, w2 listing-assessment: when a photo-only GPU is `in_photos`.** parts-record's
  photo seam may give a brand-only GPU verdict (no catalogue ID). Option taken: any offered photo
  GPU with no text GPU gives `in_photos` and the `photo_only` caution; a photo part is never
  confirmed (R5 needs a verbatim text quote). Conservative because photo evidence is shown as
  such and never as a confirmed part.
