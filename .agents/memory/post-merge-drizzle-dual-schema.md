---
name: Post-merge + drizzle-kit in the dual-schema (public/celeb) app
description: Why automated post-merge `drizzle-kit push` is effectively a safe no-op here, and the constraints around fixing it.
---

# Post-merge setup & drizzle-kit push (public + celeb dual-schema)

The automated post-merge runs `scripts/post-merge.sh` with **stdin closed
(/dev/null)** and a configurable timeout. It must be non-interactive and must
not hang.

## Hard constraints
- `drizzle.config.ts` and `package.json` are FORBIDDEN to edit. drizzle.config
  targets `shared/schema.ts` -> the **public** schema only (default schemaFilter
  is public; verified drizzle does NOT introspect the `celeb` schema).
- `npx drizzle-kit push --force` does **not** suppress the data-loss "truncate?"
  prompt in drizzle-kit 0.31.x. Under closed stdin it cancels that statement and
  applies nothing further, but exits 0.

## The phantom unique-constraint diff
drizzle-kit 0.31.x repeatedly proposes adding the **already-existing** composite
unique constraint on `public.standby_assignments(record_day_id, contestant_id)`,
even though it matches the drizzle-generated name/columns exactly.
**Why it matters:** it is a data-loss prompt, so automated push always cancels at
it and never reaches later statements -> push is effectively a permanent no-op.
**Proven dead-ends (do not retry):** drop+recreate the public constraint;
explicit `unique("...name...")` in schema; renaming the celeb copy. None clear it.
**Do NOT** add a "fail if the prompt appears" guard to post-merge.sh — the prompt
is permanent, so that would permanently re-break post-merge.

## What actually keeps schema correct
- **CELEB** schema (tables, AUDIENCE enum, episode_number columns, podium) is
  reconciled idempotently by `server/db-init.ts` at server startup, which runs
  during the post-merge workflow restart — NOT by push.
- Runtime-managed tables (e.g. `session` from connect-pg-simple) must be DECLARED
  in `shared/schema.ts` so push never proposes dropping them. They need not be
  queried via Drizzle.
- `podium_positions` is celeb-only; it intentionally never exists in public.

**How to apply:** when post-merge fails/hangs, fix the script to be
non-interactive (`</dev/null`, `--force`) and raise the timeout; rely on db-init
for celeb. A real fix for applying future public changes would need
migration-based deployment, which requires the currently-locked config files.
