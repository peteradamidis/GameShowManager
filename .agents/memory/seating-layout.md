---
name: Workspace-aware seating layout
description: Seat geometry is per-workspace and layout-derived; never hardcode 7/22/154 and don't trust persisted seat totals.
---

# Workspace-aware seating layout

Seat geometry differs per workspace and is computed from a single shared layout
helper — never hardcode block count, seats-per-block, or total seats on client or server.

- **DOND**: 7 blocks × 22 seats = 154.
- **CELEB**: 6 blocks × 25 seats = 150 (all blocks AUDIENCE; no PB/NPB).
- Blocks 4–6 use mirrored right-to-left seat numbering in both workspaces.
- Podium (separate tab) and overflow ("To Seat on Day") are NOT part of this layout
  and have their own fixed counts.

**Why:** the 7/22/154 constants were duplicated across pages and auto-assign; CELEB
needed a different shape, so centralising avoids drift.

**Key decisions to stay consistent with:**
- There is **no UI to customise a record day's seat total** — it is fully determined by
  the workspace layout. Treat the layout as the source of truth: derive displayed/aggregate
  totals from it rather than trusting the persisted `total_seats` column, and have the
  server set the total authoritatively on create. This avoids needing a data migration
  whenever the layout changes.
- CELEB auto-assign skips the DOND-only PB/NPB and C-rating constraints.
- Legacy/stale block-config rows (old PB/NPB, or blocks beyond the current count) are
  self-healed to all-AUDIENCE for CELEB on read — no manual SQL needed.
