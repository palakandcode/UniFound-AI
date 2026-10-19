# UniFind AI Backend

Node.js + Express + PostgreSQL backend for UniFind AI.

## 1. Configure PostgreSQL

You already created the `unifind` database.

Copy:

```text
.env.example -> .env
```

Then edit `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/unifind
JWT_SECRET=put-a-long-random-secret-here-at-least-32-characters
CLIENT_URL=http://127.0.0.1:5500
```

Do NOT commit `.env` and do NOT share your database password.

## 2. Install dependencies

From the `backend` folder:

```bash
npm install
```

## 3. Create database tables

```bash
npm run db:init
```

## 4. Start the API

```bash
npm run dev
```

Test:

```text
http://localhost:5000/api/health
```

Expected:

```json
{
  "success": true,
  "message": "UniFind API is running",
  "database": "connected"
}
```

## 5. Optional demo user

```bash
npm run db:seed
```

Demo credentials:

- Email: demo@somaiya.edu
- Member ID: DEMO001
- Password: ChangeMe123!

This is development-only. Change/remove it before production.

## Implemented API areas

- Authentication: register, login, me, Google OAuth scaffold
- Email OTP: Resend scaffold
- Profile and contact preferences
- Avatar upload/delete
- Private ID-card upload
- Lost/found item CRUD
- Campus marketplace listings for sale or rent, owner availability updates, and listing-specific conversations
- Image upload
- Search/filter/sort
- Deterministic potential matching
- Claims and claim approval/rejection
- Conversations and messages
- Notifications
- Saved items
- Admin stats/user/claim endpoints
- Authorization checks
- Rate limiting and security headers

## Not yet configured

Real external services require your own credentials:

1. Email OTP: Resend API key + verified sender/domain. Without these, signup/reset returns a clear 503 and no code is generated.
2. Google login: Google OAuth client ID/secret + redirect URI. Only verified emails at the configured Somaiya domain are accepted.
3. Production file storage: object storage such as S3/Cloudinary instead of local uploads.
4. Production OCR: server-side OCR/verification service.
5. Production AI: optional semantic/vector matching.
6. Marketplace payments are not enabled. Do not mark a listing paid based on a client callback or UPI redirect; configure an approved gateway, verify captured payment server-side and decide seller settlement/refunds before enabling checkout.

Never put these secrets in frontend JavaScript.


## Calls

In-app audio calls use browser WebRTC with REST-polled signaling and a public STUN server. Run the schema initializer again to create call signaling tables. Production calling requires HTTPS; restrictive NAT/firewalls may need a configured TURN service. A phone-app link is shown as a fallback when available.
