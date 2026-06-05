---
name: CELEB weekday arrival times
description: How contestant-facing record-day arrival/call times are derived per weekday for the celeb workspace.
---

# CELEB weekday arrival times

In the celeb workspace, the record-day arrival time shown to contestants depends on
the weekday of the record day: Tuesday = `7:45AM - 5:00PM`, Thursday = `8:30AM - 5:45PM`.
All other weekdays/workspaces use the plain fallback (`7:30AM`). This is applied
**automatically** from the date — it is intentionally NOT a configurable email-section field.

**Why:** Producers asked for two fixed call times by record day, set automatically so
nobody has to edit per-email. A single helper centralises the rule so every
contestant-facing surface stays consistent.

**How to apply:**
- The single source of truth is `getArrivalTimeText(rawDate, fallback, opts)` in
  server/routes.ts. Any new contestant-facing surface that shows an arrival/call time
  must call it (or, for the SPA, consume a backend-computed value) — never hardcode a time.
- The public booking-confirmation page gets its time from the token endpoint's
  `booking.arrivalTime` field, because the SPA has no workspace context of its own.
- Workspace consistency for token/public routes: celeb data lives in a separate DB
  schema and `getDb()` only returns the celeb DB when `workspaceStorage` is `celeb`.
  So if a request successfully loads a celeb booking/recordDay, that request is already
  in the celeb workspace and `getArrivalTimeText` will return celeb times in the same
  request. (Sessionless requests default to `dond`; that is a separate precondition,
  not a per-time bug.)
- Admin template-preview/test emails use fabricated sample dates and are deliberately
  left hardcoded — they are not real contestant sends.
