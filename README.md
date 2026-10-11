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

1. Checkout persists only anonymous tracking and an immutable price/original-form hash before creating an INR order with partial payments disabled. **Unpaid name, phone, address and partner details are not stored in PostgreSQL.** The opaque booking key and owner capabilities remain on the booking device; that customer's original form is kept only in the current tab's session storage until payment completes, not in the admin roster or persistent local storage.
2. Callback verification uses the stored order ID for signature verification, then fetches the provider order and payment. Identifiers, amount, INR, captured payment, fully paid order and refund state must agree. The original form must match its server-saved hash, so callback data cannot replace attendee details, price or quantity. Only then are personal details and eligibility committed atomically. Replays produce no new admissions. Customer-visible codes use the existing unique database sequence (`JMU-00012`); the random 128-bit internal association and ID-only QR remain unchanged. Short codes are references, never authentication. Gate lookup accepts both; historical numeric-code ambiguity is rejected rather than admitting the wrong person. Five-digit aliases support sequence values 1–99999; larger historical IDs are not silently truncated.
3. Signed raw-body webhooks for `payment.captured`, `order.paid` and `refund.processed` use the same reconciliation service. Duplicates are durable and idempotent; failed reconciliation returns non-2xx for retry. Any confirmed processed refund revokes admission permanently, including partial refunds. A signed refund event is not marked done against a stale pre-refund provider response: its durable work remains retryable, callbacks and organizer reconciliation cannot approve from that response, and pending refund work blocks gate admission even for a previously verified ticket.
4. An interrupted create is recovered automatically on customer retry by fetching the provider order with the saved receipt and validating its frozen amount/currency. A missing result alone never authorizes another POST. Only a durably recorded explicit provider rejection allows one locked retry on the same booking; this claim is consumed with an append-only audit event. Customers whose checkout never opened and who confirm no payment was made may explicitly start a separate fresh checkout; old price/reservations are not rewritten. Uncertain/debited payments must not be restarted blindly. Unmatched/refund/late-payment exceptions still require review; ordinary checkout no longer asks the organizer to confirm each attempt. A bounded origin-validated, throttled `{operation:"availability"}` POST to create-order checks gateway readiness using only a provider GET, creating no booking or provider order.
5. Organizer Reconcile Payment validates current provider evidence; it cannot approve an unpaid ticket. Historical records whose provider receipt/pricing do not match are retained for owner review, not guessed or auto-approved.
6. My Pass automatically checks a saved booking when opened and offers Show Digital Pass / Download Ticket for verified, active tickets. Its saved 256-bit recovery capability is used in the background; the customer does not enter a private recovery code. Old short ticket IDs alone reveal no details. On a different device or after clearing browser storage, contact the organizer for a private replacement link. Verify attendee identity outside this application before issuing it. Links carry the capability in a URL fragment, immediately removed by the page before lookup; never place capabilities in QR codes or query strings. Share privately. A recovery action rotates earlier access while retaining the old ticket ID.
7. Gate staff sign in to the existing admin screen and require a live server connection. Admission is atomic and applies to the whole booking. Repeated entry is denied. Undo Entry requires a reason and is audited. Never use the screen's cached list as admission authority.

The admin roster and CSV expose contact details only to authenticated organizers. Ticket responses omit phone, address, Instagram and provider identifiers. Roster data stays in page memory, clears on logout/expiry/authentication failure, and is never an offline gate fallback. Recovery capabilities stored on the booking device are bearer credentials: protect devices and do not share them publicly.

Unpaid attempts are not attendee-list entries. If a signed webhook arrives before the browser callback, payment evidence is retained, but no short ticket or admission is granted until the owner returns the original matching form; My Pass can resume this automatically in the booking tab without an organizer or callback signature, using its private owner capability and fresh provider evidence. If the tab's form is lost, re-enter the original booking form on the same device. This is the trade-off of not retaining unpaid personal details on the server. Existing historical records are preserved, not deleted by this release.

My Pass also checks captured provider evidence when the browser callback and webhook have not completed yet. An unpaid order remains pending without requesting routine organizer reconciliation. Refunds, mismatches and late promotional payments still fail closed. The shared WhatsApp group invite is configured in `DEFAULT_CONFIG` in the released `app.js` and shown on the verified-ticket screen; attendees choose whether to join. The admin community setting is explicitly a device-only preview, not a shared update. It cannot approve payments or change ticket access. Invalid links and the obsolete `/invite` placeholder are rejected.

## Deployment boundary and release gate

Use the repository root as the Vercel project root, Node.js 24, `npm run build`, and output directory `public`. Only allowlisted frontend files and image assets enter this generated output. Backend helpers live in `server/`, outside the routable `api/` tree. Do not serve the repository itself or deploy the nested legacy mirror. Do not put environment files, reports or scripts in the static directory.

No deployment is included in this change. Before any production release, complete the owner-dependent prerequisites in [CODEX_SECURITY_AUDIT.md](CODEX_SECURITY_AUDIT.md): revoke historically exposed credentials, reconcile legacy payments, back up and review/apply migrations, confirm deployment exclusions, configure webhook/automatic capture in the provider dashboard, and execute isolated staging checks. Credential removal alone does not revoke compromised keys or erase Git history.
