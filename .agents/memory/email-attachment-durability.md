---
name: Email attachment durability
description: Why email PDF/file attachments must be stored as durable DB bytes, not file-store path references.
---

# Email attachment durability

Attachments that must reliably appear on emails (e.g. the auto-confirmation receipt
PDF sent after a contestant confirms) must have their **bytes** persisted in the
database, not just a path reference into the local object store.

**Why:** `LOCAL_STORAGE_DIR` defaults to the project-relative `./storage`
(server/objectStorage.ts). Uploaded files there are **ephemeral in deployment** —
lost on redeploy/restart. Send-time code that re-reads bytes from that path via
`getObjectAsBuffer` then silently catches the `ObjectNotFoundError` and sends the
email *without* the attachment, so the file "sometimes doesn't attach."

**How to apply:** When a user selects/saves such a file, read its bytes immediately
(while still present) and store base64 in `system_config` alongside a filename key;
attach from the DB bytes at send time, with the old path as a back-compat fallback.
Config keys NOT listed in `WORKSPACE_SCOPED_CONFIG_KEYS` (server/storage.ts) resolve
to bare/shared keys, so they are readable by the public token endpoints that default
to the `dond` workspace. Guard large/sensitive blob keys against the generic
`/api/system-config/:key` routes via a protected-keys denylist.
