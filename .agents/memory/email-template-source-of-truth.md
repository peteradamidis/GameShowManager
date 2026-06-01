---
name: Email template source-of-truth drift
description: Why edited email templates sometimes don't reach sent emails in this project, and the rule to prevent it.
---

Email templates (availability, booking, ticket, standby) are edited on the Settings page and persisted in `system_config`. Send endpoints resolve each field as `requestBodyValue || savedSystemConfigValue || hardcodedDefault`.

**Storage is GLOBAL, not per-workspace (verified):** `storage.getSystemConfig`/`setSystemConfig` use the module-level non-workspace `db` (public schema), NOT `getDb()`. The `celeb.system_config` table exists but is empty/unused. So DOND and DOND CELEB SHARE one set of email templates — saving a celeb-branded template overwrites the DOND one. If true per-workspace templates are wanted, switch these two methods to `getDb()` (and migrate existing public rows into the celeb schema), updating send + all `/api/email-preview/*` paths in lockstep.

**The trap:** a send dialog/page can carry its OWN copy of the template (e.g. hardcoded `DEFAULT_EMAIL_*` constants in component state) and pass them in the POST body. Because the request body has top priority, those stale dialog defaults silently override whatever the user saved on Settings — so "I edited the template but the email didn't change."

**Rule:** the saved `system_config` template is the single source of truth. Send UIs should NOT pass template text fields in the request body unless the user is actively editing them in that same UI. Live previews (e.g. `/api/email-preview/availability`) read from `system_config`, so if the send path passes body overrides, the preview and the actual sent email diverge.

**Why:** availability emails ignored Settings edits for the CELEB workspace because the send dialog passed hardcoded defaults.

**How to apply:** when wiring an email-send button, prefer omitting template fields and letting the backend fall back to saved config. If you must allow inline editing, hydrate those fields FROM saved config first so an untouched field still equals the saved template. Workspace is resolved server-side from the session cookie (`req.session.activeWorkspace`), so iframes and background `setImmediate` sends already carry the right workspace — workspace is rarely the cause; body-override is.
