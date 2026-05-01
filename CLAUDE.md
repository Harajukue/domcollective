# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step — open `index.html` directly in a browser, or serve with any static file server:

```bash
python3 -m http.server 8080
# or
npx serve .
```

There are no tests, no package.json, no bundler.

## Architecture

This is a **vanilla JS SPA** — a single HTML page (`index.html`) with all application logic in one class in `script.js` (~5700 lines). `styles.css` handles all styling.

### The `CreativeCollective` class

Everything lives in a single class instantiated as `window.app`. It holds all state (`currentUser`, `members`, `events`, `needs`, etc.) and all methods. Sections are DOM elements shown/hidden via the `.section.active` class — call `app.showSection('sectionname')` to navigate.

The class is organized into these named sections (marked with `// ===` banners):
- **CONFIGURATION** — constants for Supabase, Stripe, Google Calendar, EmailJS
- **AUTHENTICATION** — PKCE session handling, Google OAuth + email/password
- **USER PROFILE MANAGEMENT** — load/save `profiles` table
- **ONBOARDING** — new user flow after first login
- **DATA LOADING** — fetches members, needs/missions, check-in statuses
- **NEEDS BOARD / EVENTS / MESSAGING / PROJECTS** — per-feature CRUD
- **RENDERING METHODS** — `showSection()` + DOM renderers for all data
- **ADMIN DASHBOARD** — check-in overrides, space requests, event/gallery management
- **CHECK-IN SYSTEM** — space check-in/out with live status feed
- **MEMBERSHIP & SUBSCRIPTIONS** — Stripe payment links, tier upgrade flow
- **BOOK THE SPACE** — space request form + admin approval workflow
- **ART GALLERY / PAINTING DETAIL / PAYPAL PAYMENT** — paintings for sale

### Navigation

There are **two parallel nav systems** that must stay in sync:
- **Mobile**: `.nav-btn` buttons in `#mobileNav`, toggled by hamburger
- **Desktop**: `.dropdown-nav-btn` buttons in `#dropdownNav`, toggled by clicking the logo

Auth-gated nav buttons (`profileNavBtn`, `checkInNavBtn`, `bookSpaceNavBtn` + their `Dropdown` variants, `adminNavBtn`) are `display:none` by default and shown on login via `updateAuthButton()`.

### Auth & User Tiers

- Auth uses Supabase PKCE flow; session stored in `localStorage` under key `dom-collective-auth`
- After login, `profiles` row is loaded and attached to `this.currentUser`
- Access check: `hasCreatorAccess()` returns true for `subscription_tier` in `['member','contributor']` or `user_status === 'admin'`
- Tier mapping (DB value → display name): `visitor→Community`, `member→Creator`, `contributor→Collaborator`, `donor→Contributor`, `admin→Catalist`
- `profiles.user_status` and `profiles.subscription_tier` are separate fields — status tracks verification; tier tracks paid plan

### External Services

| Service | Purpose | Key |
|---|---|---|
| Supabase | Auth + all DB tables | Project: `lnoixeskupzydjjpbvyu` |
| Stripe | Membership payments, art sales, donations | Publishable key in `STRIPE_PUBLISHABLE_KEY` |
| Google Calendar API | Events calendar (read-only) | `GOOGLE_CALENDAR_API_KEY` |
| EmailJS | Admin email on space booking submission | `EMAILJS_*` constants (set to `YOUR_*` placeholders until configured) |

### Other Pages

- `event.html` — redirect shim only; converts `?e=EVENT_ID` query params to `/#event=EVENT_ID` deep link hash for shareable event URLs
- `privacy-policy.html` — standalone static page, no JS
- `schema-reference.sql` — **reference only, do not run** — documents the live Supabase schema

### Database

See `schema-reference.sql` for full schema. Key tables:
- `profiles` — user info + `user_status` + `subscription_tier`
- `check_ins` / `current_check_in_status` — space occupancy
- `missions` — needs board posts
- `event_settings` — admin metadata per Google Calendar event (no RLS — accessible via anon key)
- `space_requests` — Book the Space submissions
- `space_status` — single-row table (id=1) tracking if the physical space is open
- `paintings` / `painting_purchases` — art gallery

Storage buckets: `avatars`, `profile-galleries`, `project-images`, `painting-images`
