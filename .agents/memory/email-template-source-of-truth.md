---
name: Email template source-of-truth drift
description: Why edited email templates sometimes don't reach sent emails in this project, and the rule to prevent it.
---

Email templates (availability, booking, ticket, standby) are edited on the Settings page and persisted in `system_config`. Send endpoints resolve each field as `requestBodyValue || savedSystemConfigValue || hardcodedDefault`.

**Storage model (do NOT just flip to getDb()):** `getSystemConfig`/`setSystemConfig` keep using the public `db`, but the `public.system_config` table holds BOTH infrastructure config (SMTP creds, Adobe Sign SMTP, auto_confirmation_pdf_path, Google Sheets, forms_webhook_secret, popup_*) AND email-template content. Infrastructure is INTENTIONALLY shared across DOND/CELEB — flipping these methods to `getDb()` would split SMTP creds too and break CELEB sending. Email templates ARE per-workspace via key namespacing: `resolveConfigKey()` prefixes only keys in `WORKSPACE_SCOPED_CONFIG_KEYS` with the workspace name (e.g. `celeb:availability_email_subject`); DOND uses bare keys. A scoped key with no row inherits the bare/DOND value as a seed; once a scoped row exists (even empty) its own value wins. **Why:** SMTP/PDF/Sheets must stay shared; templates/branding must differ. **How to apply:** when adding a new email-template/branding config key, add it to `WORKSPACE_SCOPED_CONFIG_KEYS`; leave infra keys out. The `celeb.system_config` schema table stays empty/unused.

**The trap:** a send dialog/page can carry its OWN copy of the template (e.g. hardcoded `DEFAULT_EMAIL_*` constants in component state) and pass them in the POST body. Because the request body has top priority, those stale dialog defaults silently override whatever the user saved on Settings — so "I edited the template but the email didn't change."

**Rule:** the saved `system_config` template is the single source of truth. Send UIs should NOT pass template text fields in the request body unless the user is actively editing them in that same UI. Live previews (e.g. `/api/email-preview/availability`) read from `system_config`, so if the send path passes body overrides, the preview and the actual sent email diverge.

**Why:** availability emails ignored Settings edits for the CELEB workspace because the send dialog passed hardcoded defaults.

**How to apply:** when wiring an email-send button, prefer omitting template fields and letting the backend fall back to saved config. If you must allow inline editing, hydrate those fields FROM saved config first so an untouched field still equals the saved template. Workspace is resolved server-side from the session cookie (`req.session.activeWorkspace`), so iframes and background `setImmediate` sends already carry the right workspace — workspace is rarely the cause; body-override is.
