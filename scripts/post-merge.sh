#!/bin/bash
set -e

# Install any newly-merged dependencies.
npm install

# Sync the Drizzle schema (shared/schema.ts) into the public database.
#
# stdin is redirected from /dev/null so drizzle-kit never blocks on an
# interactive prompt: if it ever encounters a data-loss prompt (e.g. adding a
# unique constraint to a populated table) it receives EOF and safely cancels
# that statement instead of hanging or truncating data. --force suppresses the
# ordinary create/rename confirmation. The `session` login table is declared in
# shared/schema.ts so push never proposes dropping it.
#
# Note: schema reconciliation for the CELEB workspace (and idempotent enum/column
# additions) is performed by server/db-init.ts at application startup, which runs
# during the post-merge workflow restart.
npx drizzle-kit push --force </dev/null
