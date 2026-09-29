# Raaga Raas — Event Experience Prototype

This standalone prototype runs by opening `index.html` in a modern browser. It is deliberately dependency-free so it can be reviewed immediately.

## Included flows

- Data-driven public event site with countdown, schedule, venue, gallery treatment and FAQ.
- Original campaign photography: a cinematic dance-floor hero and a human-scale editorial gallery image, stored in `assets/`.
- Three-step, mobile-first registration flow with client-side validation.
- A generated digital QR-style pass, registration lookup, and downloadable/printable pass action.
- Local browser persistence for test registrations.
- Organizer console: capacity metrics, attendee search, CSV export and QR/pass-ID check-in simulation, including repeat-entry prevention.

## Configuration

Update the `EVENT` object at the top of `app.js` to change the event, capacity, schedule or FAQs. These values are illustrative placeholders and should be replaced before a real event launch.

## Production handoff

The client-side persistence and QR-style visual code are prototype-only. A production implementation should replace them with a protected API, a relational database (registrations, members, payments, tickets, check-ins, event settings), authenticated role-based staff access, server-side validation/rate limiting, and a signed QR token. Payment and notification providers should be configured only when final event details are supplied.
