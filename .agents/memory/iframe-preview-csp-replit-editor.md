---
name: iframe preview CSP in Replit editor
description: Why same-origin iframe previews render blank in the Replit editor but work in production, and how to fix.
---

# In-app iframe previews and `frame-ancestors`

Server endpoints that return HTML meant to be embedded in an in-app `<iframe>`
(e.g. email-preview routes) commonly set `Content-Security-Policy: frame-ancestors 'self'`.

**Symptom:** the iframe network request returns 200 with valid HTML, but the
preview shows blank — only inside the Replit editor/workspace preview.

**Why:** in the Replit editor the app itself runs inside Replit's own preview
iframe (top-level origin = a Replit domain, cross-origin). A preview iframe is
then nested two levels deep. The CSP `frame-ancestors` directive is checked
against the **entire** ancestor chain, not just the immediate parent, so the
cross-origin Replit top-level ancestor causes the browser to silently block
rendering. In production (deployed top-level, e.g. a VPS) the app is the
top-level document, so `'self'` matches and the preview renders fine.

**Fix:** widen `frame-ancestors` to also allow Replit preview domains, e.g.
`frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com`.
Production stays effectively same-origin-locked because those Replit domains are
never ancestors there.

**How to apply:** whenever a user reports a blank in-app preview that returns 200,
suspect this before touching the preview HTML or the endpoint logic.
