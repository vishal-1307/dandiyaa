# Jaynagar Milan Utsav 2026

Mobile-first event registration and Razorpay ticketing for Motion Arts Academy. The repository root is the canonical application. The nested `jaynagar-milan-utsav/dist` tree is a legacy visual mirror, not another deployment or source of backend changes.

Solo: ₹249 per person, quantity 1–10. Married-couple pass: ₹399, quantity one, two people. A booking is admitted as one group. Only captured, server-verified Razorpay payments qualify. Manual approval, complimentary issuance and offline admission are disabled. The quantity stepper defaults to one and does not display the maximum; `campaign-config.js` shares booking limits between presentation and server validation. The reviewed SQL migrations enforce the same limits.

## Confirmed early-bird campaign

`campaign-config.js` is the centralized public policy; `server/pricing.js` validates and calculates server quotes. Early bird applies **only to Solo**, at ₹199 for up to **100 individual discounted attendees**, not 100 bookings or unique phone numbers. Four Solo tickets consume four promotional units when available. If only two units remain, four Solo tickets cost 2×₹199 + 2×₹249 = ₹896. Couple remains ₹399. Previously persisted registrations and orders are never repriced or retroactively discounted.

Reservations last **20 minutes**, measured by PostgreSQL's clock. The verification transaction must redeem the reservation before its deadline. Unpaid expired reservations are released under the campaign row lock on subsequent allocation (lazy cleanup); no cron worker is necessary for availability. Retrying the original booking never allocates more units, extends its deadline or changes its price. Expired order retries are rejected; the UI permits a new booking only after an explicit no-payment-made confirmation.

Razorpay orders may remain payable after our reservation expires. **A late captured promotional payment is persisted as `review_required`, is not admitted, and needs owner-handled review/refund.** No automatic refund or higher-price charge is initiated. This includes delayed confirmation after an outage: provider payment/signature validity alone cannot restore a released promotional slot. Explain this policy to attendees and staff before enabling the promotion in production. Reservations already redeemed remain consumed even if later refunded, preventing more than 100 successful promotional allocations over the campaign lifetime; refunding still revokes the ticket.

Allocation uses a locked campaign row and reservation state transitions, not an unprotected COUNT. Campaign policy hashes reject an incompatible configuration under the same key. Final price, promotional quantity and deadline are frozen on both registration and order; callbacks/webhooks verify the saved order amount, never today's availability or browser claims. Changing the campaign identity or pricing requires explicit owner review and compatible migrations; it is not a way to reset the first-100 limit.

## Local checks

Use Node.js 24 and `npm ci`. These commands do not load `.env` or contact production databases or Razorpay:

```text
npm test
npm run check
npm run build
npm run dev
```

Preview: http://127.0.0.1:3000. Without explicit server environment configuration the APIs fail closed. Browser UI checks can still run. `scripts/verify-full-flow.js` is intentionally retired because its former implementation connected to a cloud database and deleted records.

## Server configuration

Set these exclusively in server deployment environment variables. `.env.example` contains names only; no credential defaults exist. Test/migration commands never load `.env`.

| Name | Required value |
| --- | --- |
| `DATABASE_URL` | Owner-approved Neon connection; do not use it for local integration tests |
| `APP_ORIGIN` | Exact HTTPS site origin, without trailing slash/path; loopback HTTP permitted locally |
| `ADMIN_PASSWORD_HASH` | `scrypt$<32-hex salt>$<128-hex digest>`, generated below |
| `ADMIN_SESSION_SECRET` | Unique cryptographically random secret, at least 32 characters |
| `RAZORPAY_KEY_ID` | Provider key ID; returned as the public checkout key by the server |
| `RAZORPAY_KEY_SECRET` | Provider secret; server only |
| `RAZORPAY_WEBHOOK_SECRET` | Unique webhook secret, at least 32 characters; server only |

Choose a unique organizer password of 16–256 characters. In PowerShell, generate its hash without putting the password in command arguments or displaying it:

```powershell
$taskCredential = Get-Credential -UserName organizer -Message 'Choose the organizer password'
$taskCredential.GetNetworkCredential().Password | node scripts/hash-admin-password.js
Remove-Variable taskCredential
```

Store the resulting hash as `ADMIN_PASSWORD_HASH`; keep the password private. Hashing uses fixed scrypt parameters N=32768, r=8, p=3 (32 MiB), following an [OWASP recommended configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt). Generate the hash with this utility, not another work factor. Login uses a 30-minute HTTP-only, Secure HTTPS, SameSite=Strict cookie; logout revokes the persisted session. Every administrative mutation requires the site origin and session-bound CSRF token. Database-backed login throttling permits five attempts per IP per fixed 15-minute window, including successful attempts.

## Private release credential handoff (Windows PowerShell 7)

`scripts/release-secrets.ps1 -Action Initialize` generates separate random session and webhook secrets into a user-restricted DPAPI-encrypted vault under `%LOCALAPPDATA%/JMU`, outside the repository. It never updates providers or prints values. Each Initialize action makes a new vault; existing ones remain intact. Use the explicit `-VaultPath` printed by Initialize when several vaults exist.

Run these yourself in an interactive local terminal, not in chat:

```powershell
pwsh -NoProfile -File scripts/release-secrets.ps1 -Action Admin
pwsh -NoProfile -File scripts/release-secrets.ps1 -Action CopySession
pwsh -NoProfile -File scripts/release-secrets.ps1 -Action CopyWebhook
```

Admin securely prompts twice for a NEW unique 16–256-character password, invokes the existing compatible hash utility through stdin, and copies only the resulting hash to your clipboard for Vercel `ADMIN_PASSWORD_HASH`. CopySession supplies `ADMIN_SESSION_SECRET`. CopyWebhook supplies the SAME replacement secret for the existing Razorpay webhook and Vercel `RAZORPAY_WEBHOOK_SECRET`; do not add a duplicate webhook. Clear the clipboard after each handoff (`Set-Clipboard -Value ''`), and do not use screenshots or chat to transfer values. Clipboard-history/sync software can retain copied secrets; disable it or use your approved secret-transfer process. Updating variables does not update an existing deployment: redeploy the verified release with the intended environment scope afterward.

Checkout assets use one revision and `no-store` revalidation for application/pricing scripts. The SDK loader waits at most 20 seconds, validates the constructor, removes failed script tags, and permits a fresh user retry. SDK errors happen before server allocation; backend/configuration errors are displayed separately. The restrictive CSP permits the specific Razorpay risk-detection script observed in Checkout, without permitting arbitrary inline scripts or wildcard script hosts. Promotional terms are available in the expandable checkout-timing disclosure; the displayed regular estimate changes to the frozen server quote before Checkout opens.

## Database migration and safe integration tests

Never run the migration against production without owner-authorized backup, preflight and schema review. The supplied command deliberately permits only an explicit `TEST_DATABASE_URL` targeting loopback PostgreSQL with a database name beginning `jmu_test_`. It refuses `DATABASE_URL`, cloud hosts, non-test names and URL connection overrides. No production migration command is supplied.

Against a disposable local PostgreSQL instance:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://test_user:test_password@127.0.0.1:55432/jmu_test_security'
npm run db:preflight
npm run db:migrate:local
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

`db:preflight` issues only SELECTs and reports counts, never attendee rows. Duplicate case-insensitive ticket IDs, duplicate legacy order/payment IDs, invalid ticket identifiers and invalid basic quantities/amounts block migration. Catalog inconsistencies and historical approvals are flagged for review. The local runner applies `migrations/001_security.sql` and `002_early_bird.sql` together inside **one transaction**; failure in either step rolls back the entire set. An owner-reviewed staging/production procedure must preserve that all-or-nothing boundary rather than committing the files separately. Incompatible data is not deleted or silently rewritten. Historical records become `legacy_unverified`, irrespective of old `approved` flags; those flags are not payment evidence. Existing check-in history is retained. Integration tests create and remove their own randomly named schemas in the explicitly selected disposable database.

## Payment, retrieval and organizer workflow

1. Checkout persists an immutable registration price snapshot before creating an INR order with partial payments disabled. The browser saves only ticket/recovery capabilities and an opaque booking key, not a roster or attendee records.
2. Callback verification uses the stored order ID for signature verification, then fetches the provider order and payment. Identifiers, amount, INR, captured payment, fully paid order and refund state must agree. Only then is eligibility committed atomically. Replays produce no new admissions.
3. Signed raw-body webhooks for `payment.captured`, `order.paid` and `refund.processed` use the same reconciliation service. Duplicates are durable and idempotent; failed reconciliation returns non-2xx for retry. Any confirmed processed refund revokes admission permanently, including partial refunds. A signed refund event is not marked done against a stale pre-refund provider response: its durable work remains retryable, callbacks and organizer reconciliation cannot approve from that response, and pending refund work blocks gate admission even for a previously verified ticket.
4. If checkout creation has an ambiguous outcome, do not create/pay a second order. The pending record remains recovery-required. The organizer finds the provider order by its server-generated receipt and uses Reconcile Payment. Unmatched signed webhook events remain durable; organizer reconciliation drains them. There is no autonomous background retry worker—monitor and resolve pending/retry/unmatched records before provider retry windows expire.
5. Organizer Reconcile Payment validates current provider evidence; it cannot approve an unpaid ticket. Historical records whose provider receipt/pricing do not match are retained for owner review, not guessed or auto-approved.
6. My Pass requires the booking's saved 256-bit recovery capability or an organizer-issued replacement. Old short ticket IDs alone reveal no details. Verify attendee identity outside this application before issuing a recovery link. Links carry the capability in a URL fragment, immediately removed by the page; never place capabilities in QR codes or query strings. Share privately. A recovery action rotates earlier access while retaining the old ticket ID.
7. Gate staff sign in to the existing admin screen and require a live server connection. Admission is atomic and applies to the whole booking. Repeated entry is denied. Undo Entry requires a reason and is audited. Never use the screen's cached list as admission authority.

The admin roster and CSV expose contact details only to authenticated organizers. Ticket responses omit phone, address, Instagram and provider identifiers. Roster data stays in page memory, clears on logout/expiry/authentication failure, and is never an offline gate fallback. Recovery capabilities stored on the booking device are bearer credentials: protect devices and do not share them publicly.

## Deployment boundary and release gate

Use the repository root as the Vercel project root, Node.js 24, `npm run build`, and output directory `public`. Only allowlisted frontend files and image assets enter this generated output. Backend helpers live in `server/`, outside the routable `api/` tree. Do not serve the repository itself or deploy the nested legacy mirror. Do not put environment files, reports or scripts in the static directory.

No deployment is included in this change. Before any production release, complete the owner-dependent prerequisites in [CODEX_SECURITY_AUDIT.md](CODEX_SECURITY_AUDIT.md): revoke historically exposed credentials, reconcile legacy payments, back up and review/apply migrations, confirm deployment exclusions, configure webhook/automatic capture in the provider dashboard, and execute isolated staging checks. Credential removal alone does not revoke compromised keys or erase Git history.
