# Production readiness review

The app now presents a cleaner, safer public experience, but a real deployment still depends on production infrastructure and provider setup. Do not advertise the unresolved items below as live functionality.

## Addressed in this update

- Demo owner reports and marketplace listings are excluded from public feeds; demo seeding is blocked in production and seeded demo credentials cannot sign in there.
- The login screen no longer displays shared demo passwords.
- Profile photos are hard-bounded to the profile avatar, preventing an uploaded photo from expanding over other pages.
- Missing listing and report photos have illustrated, labeled placeholders. They do not pretend to be real product photos.
- The “AI” wordmark uses a contrasting warm gold on the red navigation rail.
- Search-result sample content is not synthesized; real student listings and reports remain intact.

## Required before launch

1. **Database and accounts:** provision managed PostgreSQL, apply the schema, create a least-privilege database role, restrict network access, enable encrypted connections, and configure automated backups plus a restore drill. Review and remove any demo accounts from an existing database before opening the service.
2. **HTTPS and domains:** deploy behind HTTPS, set the exact `CLIENT_URL`, `GOOGLE_REDIRECT_URI`, and allowed origins to the production domains, and configure a secure proxy and health monitoring. Browser calls require HTTPS.
3. **OTP email:** OTP delivery works only when `RESEND_API_KEY` and a verified `EMAIL_FROM` sender are configured. Verify delivery, expiry, resend throttling, and bounce handling using production-domain accounts before launch.
4. **Google sign-in:** configure and verify OAuth client credentials and exact redirect URLs, or disable/hide the Google button until configured.
5. **Uploads:** local disk uploads are not durable in ephemeral hosting. Use persistent storage or object storage, set size limits, add malware/content scanning and image metadata stripping, and define retention/deletion policies. Keep ID-card files private and restrict access to the authorized verification path.
6. **Calls:** current in-app calling is browser audio via WebRTC. Configure production STUN/TURN infrastructure and test restrictive campus/mobile networks; a phone call is only a `tel:` handoff and depends on the user's device. No video calling is provided.
7. **Payments:** checkout, GPay/UPI collection, refunds, seller payouts and invoices are not implemented. Add a merchant account and a server-side provider integration that creates orders, verifies signed payment callbacks, records transaction state idempotently, handles refunds/disputes, and issues tax-compliant invoices before enabling transactions. A UPI deep link alone is not proof of payment.
8. **Operational security:** rotate all secrets, keep `.env` out of source control, configure log redaction and error monitoring, run dependency/security review, establish incident response and privacy/retention policies, and validate account deletion and data export obligations.
9. **Release verification:** exercise registration/OTP, Google OAuth, visitor access, claims, messages, calls, uploads, image fallbacks, mobile layouts, listing state changes, rate limits, and recovery from a database outage on a staging deployment before launch.

## Practical feature limits

- A visitor can browse public active reports and listings; account-only actions remain gated.
- Marketplace “Ask to buy” and “Ask about rental” start a conversation. They do not reserve goods, collect payment, issue an invoice, verify handover, or guarantee seller availability.
- Missing photos use an illustration and “Photo not added” label. Ask users to upload an image for accurate item identification.
- Profile and chat avatars fall back to initials when an image fails to load.
- Student accounts use the configured Somaiya email-domain policy. A visitor can use a personal Gmail address only for browsing and must create/sign into an eligible campus account for protected actions.
