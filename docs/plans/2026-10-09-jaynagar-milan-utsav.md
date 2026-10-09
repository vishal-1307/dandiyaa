# Jaynagar Milan Utsav Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a client-side (no-backend) event website for Jaynagar Milan Utsav 2026 organized by Motion Arts Academy, featuring complete multi-step registration, custom UPI payment QR flow, instant Ticket Pass ID generation, WhatsApp payment screenshot verification flow, self-service Pass lookup, and organizer gate check-in terminal.

**Architecture:** A static, mobile-first web architecture living in `jaynagar-milan-utsav/dist/` deployable directly to static hosting (Vercel / Netlify / GitHub Pages). All data persists locally via `localStorage`, QR codes generate in pure client-side JavaScript, and ticket verifications seamlessly route to WhatsApp (+91 70505 51310).

**Tech Stack:** Semantic HTML5, Modern CSS3 with festive royal gold & Mithila wine design tokens, Pure Vanilla JavaScript (ES6+), Client-side vector QR Code generation, Canvas / Printable Pass generation.

---

### Task 1: Organize Assets and Motion Arts Academy Logo Branding
**Files:**
- Create/Process: `jaynagar-milan-utsav/dist/assets/motion-arts-badge.png`
- Create/Process: `jaynagar-milan-utsav/dist/assets/motion-arts-badge.webp`
- Verify: `jaynagar-milan-utsav/dist/assets/` images and posters

**Step 1:** Verify circular medallion badge with festive gold rim and ensure high quality.
**Step 2:** Ensure image assets are correctly referenced.

---

### Task 2: Build the Core Client-Side Engine (`app.js`)
**Files:**
- Create: `jaynagar-milan-utsav/dist/app.js`

**Step 1:** Implement config object with configurable UPI ID, Payee Name, WhatsApp number, and event details.
**Step 2:** Implement pure JS offline QR code generator for UPI payment and Pass IDs.
**Step 3:** Implement live countdown timer for 19 October 2026, 6:00 PM.
**Step 4:** Implement 3-Step Registration Wizard (Category selection & details -> Payment QR & mobile UPI intent -> Pass generation & WhatsApp redirection).
**Step 5:** Implement Self-Service "My Pass" Lookup portal (search by Phone or Pass ID).
**Step 6:** Implement Organizer Admin Terminal (view registrations, CSV export, gate check-in duplicate prevention, and live UPI ID configuration).

---

### Task 3: Build Complete Responsive HTML Interface (`index.html`)
**Files:**
- Modify: `jaynagar-milan-utsav/dist/index.html`

**Step 1:** Add countdown timer bar and enhanced header with Motion Arts Academy and JMU branding.
**Step 2:** Add rich content sections: About, 3 Core Experiences, Hourly Event Schedule (6–10 PM), Event Highlights & Awards, Categorized Rules & Guidelines, Interactive Venue & Google Maps, FAQ Accordion.
**Step 3:** Add Ticket Selection cards with direct triggers into the Registration Wizard.
**Step 4:** Add Modals:
  - Multi-step Registration Wizard modal
  - My Pass Lookup modal
  - Admin Organizer modal
**Step 5:** Add Mobile Sticky Dock with "Book Ticket" and "My Pass".
**Step 6:** Update footer with Motion Arts Academy branding and developer attribution to Vishal (vishalthakur.tech).

---

### Task 4: Complete Festive & Luxury Styling (`styles-v2.css`)
**Files:**
- Modify: `jaynagar-milan-utsav/dist/styles-v2.css`

**Step 1:** Add styles for countdown timer, schedule timeline, awards cards, and rules grid.
**Step 2:** Add modal dialog styling with smooth animations, step progress indicators, and form inputs.
**Step 3:** Add Royal Gold Pass Plaque styling with ornate borders, gold metallic gradients, pass ID badge, QR code, and print/download layout.
**Step 4:** Add Admin Terminal styling (data cards, registration table, check-in badges).
**Step 5:** Ensure full mobile responsiveness (tested across 360px, 700px, 1000px, and desktop).

---

### Task 5: Testing and Verification
**Files:**
- Test all interactions in browser / headless script.
- Verify 10-digit phone validation, couple vs solo ticket amounts, UPI QR string, Pass ID generation, WhatsApp payload format, localStorage saving & retrieval, and CSV download.
