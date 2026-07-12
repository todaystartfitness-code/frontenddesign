# Build Spec: FitStrong Club Client Booking App (v3)

## Before you write any code

Ask me clarifying questions about anything ambiguous in this spec before starting.

Inspect the existing website codebase in this folder first. It is currently a frontend-only static site (HTML/CSS/JS — no backend, no login system, no database). You will be building the entire backend from scratch as part of this project. The booking app should live under the same site/domain, and clients will log in through it.

The site is hosted on Cloudflare Pages. Build the backend on Cloudflare's stack: Workers for server code, D1 for the database, and Cron Triggers for scheduled reminder jobs — so everything stays on one platform. Walk me through any Cloudflare dashboard setup you need from me (API tokens, bindings, etc.).

Before building, confirm with me that the code in this folder matches my live site. If I tell you the live site has newer changes, help me reconcile them first.

Do not remove or break the existing Lunacal.ai widgets (see "Coexistence with Lunacal" below). They must keep working exactly as they do now.

Build in phases (defined at the bottom). Get my approval before moving to the next phase.

## What this is

A 1:1 personal training booking app for my business, FitStrong Club. Clients buy session packages, then book individual sessions with me. Sessions deduct from their package balance. I (the admin) have full control over packages, pricing, scheduling rules, and overrides.

There are two user roles: Client and Admin (me). I am the only trainer.

## Coexistence with Lunacal (important)

My website currently has two Lunacal.ai widgets that are live and converting: (1) a popup calendar where new prospects book my 3-session trial offer, and (2) an embedded calendar showing my availability. These stay in place and untouched. For now:

- Lunacal handles new prospects booking the trial offer.
- This app handles existing clients with session packages.
- My Google Calendar is the shared source of truth between the two systems. Lunacal writes its bookings to my Google Calendar; this app must strictly respect all Google Calendar events (from Lunacal or anywhere else) when computing available slots — never offer a slot that conflicts with any calendar event.

Replacing the Lunacal widgets with this app's own public booking flow is a future phase (Phase 6), only after the app is proven with existing clients. Design with that migration in mind, but do not build it yet.

## Packages & Payments

I can create, edit, rename, archive, and re-price packages at any time from the admin panel. Examples: "FREE Consultation" ($0, 1 session), "24-Session Package," "12-Session Package." Package names, session counts, and prices are all editable by me — never hardcoded.

Clients purchase packages through the app using Stripe (connect to my existing Stripe account). Walk me through the Stripe API key setup when we get there.

Purchasing a package credits the client's account with that package's session count.

I can also manually add clients and manually credit/adjust session balances from the admin panel (for offline sales, comps, corrections — including clients converting from the Lunacal trial funnel).

Single-session option: when booking, a client either deducts from their package balance (default) or pays $125 for a one-off session via Stripe. That $125 drop-in price must be editable by me.

Nice-to-have (build last, don't block core features): discount codes I can create and manage (percentage or fixed amount, usable at checkout).

## Booking & Calendar

Clients see only available time slots. Available = within my business hours (which I set and can change) AND not conflicting with any event on my Google Calendar AND respecting session buffers.

Google Calendar sync, both directions: read my calendar to block conflicting slots (including Lunacal bookings), and write confirmed bookings to my calendar so everything lives in one place. Walk me through the Google OAuth setup.

Session structure: sessions are up to 60 minutes, with a 15-minute buffer before and a 30-minute buffer after each session. Both buffer values must be editable by me in admin settings at any time.

Booking a session deducts one credit from the client's package by default (or triggers the $125 single-session payment if they choose that path).

Admin override booking: I can manually book any client into any time slot, including outside business hours. When I book manually, it deducts from their package by default, with a checkbox/toggle to not deduct.

Timezone: everything runs on Arizona time (America/Phoenix — no daylight saving time). State all times to clients in this timezone.

## Rescheduling & Cancellation

Reschedule window: clients can self-reschedule through the app if they are outside the window (e.g., more than 24 hours before their session). Inside the window, self-reschedule is disabled and the app tells them to contact me directly — only I can reschedule them from the admin panel.

The reschedule window duration is a setting I control and can change anytime (default it to 24 hours).

Cancellation burns the session credit by default — but I am the decider. Every cancellation should surface in my admin panel with the option to restore the credit if I choose.

I can reschedule or cancel any session from the admin side at any time, with the same credit-burn-or-restore choice.

## Notifications

Client receives an immediate SMS confirmation when a session is booked (by them or by me).

Client receives an SMS reminder 90 minutes before their scheduled session (run via a Cloudflare Cron Trigger). This applies to sessions booked through this app only — Lunacal handles its own reminders.

Use Twilio for SMS. Walk me through account setup, phone number provisioning, and A2P 10DLC registration when we reach this phase. If SMS setup becomes a blocker, build email notifications first so the system works, then layer SMS on top.

Also send me (admin) a notification when a client books, reschedules, or cancels.

## Admin Panel — summary of everything I control

- Create/edit/rename/archive packages, session counts, and prices
- Edit the $125 single-session price
- Add clients manually; adjust any client's session balance
- Set and change business hours
- Set and change the reschedule window
- Set and change the before/after session buffers
- Book, reschedule, or cancel any session (any hours, deduct-or-not toggle)
- Approve or restore burned credits on cancellations
- View client list with package balances and session history
- (Nice-to-have) Create and manage discount codes

## Build Phases

- Phase 1 — Foundation: Cloudflare Workers + D1 backend setup, client accounts with login (integrated into the existing site without disturbing the Lunacal widgets), admin panel, package management, manual client/credit management.
- Phase 2 — Booking engine: business hours, buffers, booking flow with credit deduction, reschedule window logic, cancellation flow, Google Calendar two-way sync (strictly respecting all calendar events, including Lunacal's).
- Phase 3 — Payments: Stripe integration for package purchases and $125 single sessions.
- Phase 4 — Notifications: Twilio SMS confirmations and 90-minute reminders via Cron Triggers, admin notifications.
- Phase 5 — Nice-to-haves: discount codes, plus anything we've parked along the way.
- Phase 6 — Future (do not build yet): replace the Lunacal widgets with this app's own public trial-offer booking flow and embedded availability widget, once the app is proven with existing clients.

Stop for my approval at the end of each phase.
