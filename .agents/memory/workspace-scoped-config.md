---
name: Workspace-scoped system_config keys
description: How per-workspace (DOND vs Celeb) settings are isolated, and the gotcha when adding new ones.
---

# Workspace-scoped system_config keys

All app settings live in the `system_config` table accessed via
`storage.getSystemConfig`/`setSystemConfig`. Those go through `resolveConfigKey`,
which prefixes the key with the active workspace (e.g. `celeb:<key>`) **only if**
the key is listed in `WORKSPACE_SCOPED_CONFIG_KEYS`. DOND (and the default) always
use the bare key.

**Why:** Celeb and DOND share one DB but need separate email templates, branding,
banners, sender name, and the auto-confirmation PDF attachment. Anything NOT in the
set is global — saving it in one workspace silently overwrites the other.

**How to apply:**
- When adding any new per-workspace setting (email copy, branding, an uploaded
  attachment's path/name/durable bytes, reply-to addresses, etc.), add every related
  key to `WORKSPACE_SCOPED_CONFIG_KEYS` in server/storage.ts — otherwise it leaks
  across workspaces.
- After scoping a previously-global key, existing data stays under the bare key (so it
  becomes DOND's value); other workspaces start empty and need a re-save/re-upload.
- The auto-confirmation PDF is stored as three keys (`auto_confirmation_pdf_path`,
  `_name`, `_data` where `_data` is durable base64 bytes); all three are scoped so a
  Celeb upload never clobbers the DOND PDF.
