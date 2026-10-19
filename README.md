# UniFind AI V2 — Connected Campus Lost & Found

This package keeps the existing Express + PostgreSQL architecture and upgrades the V2 user flow without replacing the matching engine.

## Run

1. Open `backend/`.
2. Copy `.env.example` to `.env` and configure PostgreSQL/JWT.
3. Run:
```bash
npm install
npm run db:init
npm run db:seed
npm run dev
```
4. Serve the project root with Live Server, or any static file server, and open `index.html`.

If this database was initialized before the marketplace update, run `npm run db:init` again from `backend/` before starting the server. The schema setup is idempotent and adds the marketplace tables and conversation link.

The frontend automatically uses `/api` when served from port 5000, otherwise it falls back to `http://localhost:5000/api`. You can override this with `window.UNIFIND_API`.

## Local demo data

`npm run db:seed` creates local-only demo accounts. Never run it in production; the script refuses when `NODE_ENV=production`. Demo accounts cannot sign in in production, and their seeded reports are kept out of public feeds.

## Updated flow

- Sign in with password or Google OAuth when Google keys are configured.
- Only accounts with an approved Somaiya email domain can sign in. Visitors can browse anonymously; personal Gmail is not accepted for student accounts. New student accounts need an email OTP and a Somaiya ID card.
- ID-card OCR is attempted automatically. The OCR text is stored privately and a strong name + member-ID match can mark the account verified.
- Unverified users cannot submit ownership claims.
- Found-item owners review claims and approve/reject them.
- Approval changes the found item to `CLAIMED`, rejects competing pending claims, and creates a private conversation for the finder and approved claimant.
- The claimant confirms **I received it**. Only the approved claimant can perform this action; then the item becomes `RETURNED`.
- Item photos are served through the configured API origin rather than a hard-coded localhost URL.
- Profile preferences control messaging, browser audio calls, phone-app links and email contact. Browser calls need microphone permission, HTTPS (or localhost), and a network that permits peer connections; the phone-app link is the fallback.
- Visitors can browse active lost-and-found reports and marketplace listings before creating an account.
- The campus marketplace supports student listings for sale or rent, rental pricing periods, search/category filters, listing management, and private owner messages. Payments are not processed or verified in UniFind yet. Direct GPay/UPI links cannot confirm payment or create a trustworthy paid invoice. A live gateway needs a registered merchant, backend credentials, payment-status verification and a seller payout/refund plan.
- Public item and avatar images allow cross-origin display for the separately served frontend; private ID cards remain unserved.
- Campus locations include Aryabhatt (A101–A418), Bhaskaracharya (B101–B618), the named canteens, libraries, hostels and major campus facilities.

## Deployment readiness

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the remaining external setup and launch checks. In-app checkout, GPay/UPI collection and paid invoices are intentionally not represented as available until a payment provider is configured and its server-side payment verification is implemented.

## Google OAuth

Configure:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

The callback returns to the frontend using the JWT hash callback already supported by the V2 client.

## Important

ID cards and their OCR text are private. Only authenticated profile/admin flows can access them. Never commit `.env` or real credentials.
