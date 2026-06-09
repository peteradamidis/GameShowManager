#!/bin/bash
set -e

# Install any newly-merged dependencies.
npm install

# Sync the Drizzle schema (shared/schema.ts) into the public database.
# --force is required because stdin is closed during automated post-merge setup,
# so the interactive create-or-rename prompt would otherwise hang. The `session`
# login table is declared in shared/schema.ts so push never drops it, leaving
# only additive changes to apply.
npx drizzle-kit push --force
