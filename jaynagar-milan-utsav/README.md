# Jaynagar Milan Utsav 2026

Official Event & Registration Website for **Jaynagar Milan Utsav 2026** (Dandiya & Jhijhiya Special Night), organised with pride by **Motion Arts Academy**.

- **Event Date:** Monday, 19 October 2026 • 6:00 PM – 10:00 PM
- **Venue:** Marwadi Vivah Bhavan, Jaynagar, Bihar
- **Pricing:** Solo Pass ₹249 • Married Couple Pass ₹399
- **Organizer Helpline & WhatsApp:** +91 70505 51310
- **Official WhatsApp Group:** [Join Community Group](https://chat.whatsapp.com/FJt21SRONmx3cnrgsd2QK0?s=sh&p=a&mlu=4&ilr=4&iam=)
- **Official UPI ID:** `8252969861lol@ibl` (Payee: Mr SONU KUMAR BHANDARI)

---

## 📁 Directory Structure & Organization

```
jaynagar-milan-utsav/
├── dist/                                # Production deploy directory (static hosting target)
│   ├── index.html                       # Semantic, accessible, mobile-first festival landing page
│   ├── styles-v2.css                    # Royal Mithila Wine & Festive Gold stylesheet
│   ├── styles.css                       # Synced mirror stylesheet
│   ├── app.js                           # Core client-side engine (Registration, QR, Pass, Admin)
│   ├── qrcode.bundle.js                 # Standalone offline vector QR code generator (23KB)
│   ├── html2canvas.bundle.js            # Standalone pass-to-image download engine (199KB)
│   └── assets/                          # Ultra-optimized responsive assets
│       ├── motion-arts-badge.webp       # Royal circular gold-rimmed academy logo badge
│       ├── motion-arts-badge.png        # High-res circular academy badge
│       ├── jmu-logo-small.webp          # Circular JMU festival crest
│       ├── jmu-logo.png                 # Master JMU festival crest
│       ├── payment-qr.webp              # Verified PhonePe scanner image (Mr Sonu Kumar Bhandari)
│       ├── payment-qr.png               # High-res PhonePe payment QR
│       ├── whatsapp-group-qr.webp       # Official JMU WhatsApp group QR scanner
│       ├── whatsapp-group-qr.jpg        # Master WhatsApp group QR
│       ├── event-poster-display.webp    # Official invitation poster display
│       ├── event-poster.png             # Full uncompressed invitation poster (HD)
│       ├── dandiya-hero-desktop.webp    # Wide festival hero background
│       ├── dandiya-hero-mobile.webp     # Vertical mobile hero background
│       └── dandiya-evening-compact.webp # Cultural dance showcase image
├── scripts/
│   ├── verify-assets.js                 # Automated asset reference validation
│   ├── test-registration-flow.js        # Automated test suite for registration & payment engine
│   └── optimise-images.py               # PIL image optimization & webp pipeline
└── README.md                            # Complete documentation & operations manual
```

---

## ⚡ Master Features Implemented

### 1. Zero-Backend Client Architecture
- No servers, databases, or third-party paid gateways required.
- Everything runs 100% in modern browsers with `localStorage` persistence.
- Zero server maintenance costs; can be deployed on Vercel, Netlify, or GitHub Pages with zero latency.

### 2. 3-Step Guided Registration & Payment Engine
- **Step 1: Attendee Details Form:**
  - Category selector: **Solo Pass (₹249)** vs **Couple Pass (₹399)**.
  - Form fields: Full Name, 10-digit WhatsApp Number, Address / City, Optional Instagram ID (`@username`).
  - Married Couple dynamic fields: Spouse Name and Spouse Mobile.
  - Live client-side validation.
- **Step 2: Live Payment & UPI Verification:**
  - Order summary card with exact payable amount (₹249 or ₹399).
  - Official PhonePe payment QR code & dynamic vector QR code.
  - Payee: `Mr SONU KUMAR BHANDARI` • UPI ID: `8252969861lol@ibl`.
  - One-tap "📋 Copy UPI ID" button.
  - Mobile "⚡ Pay via UPI App" one-tap intent (`upi://pay?...`).
- **Step 3: Instant Pass Generation & WhatsApp Submission:**
  - Generates unique Pass ID (e.g., `JMU-8K21`).
  - Renders the **Royal Gold Digital Pass Plaque** on screen.
  - Automatically formats the WhatsApp verification message with all attendee details.
  - Prominent pulsing green button opens WhatsApp to `+91 70505 51310` so the attendee sends the message and attaches their payment screenshot.

### 3. Self-Service "My Pass" Lookup Portal
- Any attendee can click **"🎫 My Pass"** at any time.
- Search by 10-digit Mobile Number or Pass ID.
- Instantly retrieves their digital pass from localStorage without re-booking.
- Provides 1-tap download and WhatsApp support link.

### 4. Organizer Operations Portal & Gate Terminal
- Access via **"Organizer Portal"** in footer or by visiting `#admin` with PIN `motion13`.
- **Live Metrics Dashboard:** Total bookings, Total Revenue (₹), Solo vs Couple breakdown, Gate admitted count.
- **Gate Check-In Scanner:** Enter or scan Pass ID at the gate:
  - Green Alert: "✓ ENTRY APPROVED! Welcome [Attendee Name]".
  - Red Alert: "⚠️ ALREADY CHECKED IN" with duplicate prevention.
  - Red Alert: "❌ PASS NOT FOUND".
- **1-Click CSV Export:** Downloads `JMU_Registrations_[Date].csv` for offline roster management in Microsoft Excel.
- **Live Settings:** Allows updating UPI ID, payee name, and WhatsApp number directly in browser localStorage.

### 5. Rich Festival Storytelling Content
- Real-time countdown timer to **19 October 2026, 6:00 PM**.
- About Mithila heritage and Jhijhiya folk traditions.
- 3 Core Experience Showcase cards.
- Hourly event timeline (6:00 PM to 10:00 PM).
- 6 Prestigious awards & highlights cards.
- Official JMU WhatsApp community banner with direct join link.
- Categorized rules, dress code, and safety protocols.
- Embedded interactive Google Map for Marwadi Vivah Bhavan.
- Expandable FAQ accordion.
- Official poster preview with HD download link.
- Developer attribution badge linking to [vishalthakur.tech](https://vishalthakur.tech).
