# Fit Strong Club — Developer Notes

Marketing site for Rico Armstrong's personal strength training + Thai bodywork
business in Phoenix, AZ. Single-page static site, no build step, no backend,
no user accounts.

## Tech stack

- **Plain HTML/CSS/JS.** No framework, no bundler, no package.json. One page
  (`index.html`), one stylesheet (`css/styles.css`), one script (`js/main.js`).
- **Fonts:** Geist / Geist Mono, loaded from Google Fonts via `<link>` tags in
  `<head>` (no self-hosting).
- **GSAP 3.12.5 + ScrollTrigger**, loaded from jsDelivr CDN (`<script>` tags
  right before `js/main.js`). Used for the hero headline line-reveal on load
  and a couple of decorative continuous animations (bodywork icon "breathing"
  pulse, About portrait float). Everything else (scroll reveals, stat
  counters, mobile "backlit" card glow) is hand-rolled with
  `IntersectionObserver` in `main.js`, deliberately *not* GSAP/ScrollTrigger —
  see the comment above `setupReveal()` in `main.js` for why.
- **Lunacal.ai** booking embed (Cal.com-style API) — a popup calendar
  triggered from CTA buttons via `data-cal-link`/`data-cal-namespace`
  attributes, and an inline calendar in the Book section
  (`#my-lunacal-inline-personal-training-demo-session-and-consultation`). The
  init script and theme config live inline at the bottom of `index.html`. The
  Cal link/namespace is hardcoded as
  `fitstrongclub/personal-training-demo-session-and-consultation` in several
  places — if the underlying Lunacal event type ever gets renamed, all of
  these need updating together.
- **Hosting: Cloudflare Workers** (static assets), *not* Cloudflare Pages and
  *not* GitHub Pages. See "Deployment" below — this took a few false starts.

## File structure

```
index.html          All markup, single page, anchor-linked sections (#home,
                     #services, #studio, #recovery, #about, #stats, #results,
                     #testimonials, #location, #book)
css/styles.css       All styles. Organized in commented sections matching
                     the page's sections, top-down. Design tokens (colors,
                     spacing, fonts) live in :root at the top.
js/main.js           All behavior, one big IIFE, sub-IIFEs per feature
                     (mobile nav, magnetic buttons, ambient video
                     play/pause, scroll reveal, backlit cards, tagline
                     rotator, hero word rotator, stat counters, GSAP bits).
wrangler.toml        Cloudflare Workers config — `[assets] directory = "./"`
                     serves the repo root as static files, no Worker script.
assets/images/...    Photos, organized by section (about/, bodywork/,
                     location/, results/).
assets/video/...     Ambient background videos + poster images.
.claude/skills/...   Claude Code tooling/skills, unrelated to the site itself.
```

There is no `src/`, no build output directory — what's in the repo is
exactly what gets deployed.

## Authentication

**There is none.** This is a public static marketing site with no logins, no
user accounts, no sessions, and no backend/API of its own. The only
"third-party auth" surface is the Lunacal booking widget, which handles its
own auth internally (as an embedded iframe) — nothing in this repo touches
credentials.

## Deployment

- **Host:** Cloudflare Workers (static assets mode), auto-deploying on every
  push to the `claude/install-frontend-design-skill-ba9wag` branch via
  Cloudflare's GitHub integration ("Workers Builds"). Deploy command is
  `npx wrangler deploy` (not `wrangler pages deploy` — this project was set
  up under Cloudflare's newer unified Workers/Pages system, and mixing the
  two command styles is what caused early deploy failures).
- **Domain:** `fitstrongclub.com`, connected via Cloudflare DNS (nameservers
  point to Cloudflare) + a Workers **Custom Domain** binding — not a plain
  CNAME. The old DNS host (GoDaddy) still owns registration; Cloudflare owns
  DNS resolution.
- **No GitHub Pages.** A GitHub Actions Pages workflow existed briefly early
  in the project but was removed — GitHub's default `GITHUB_TOKEN` can never
  auto-create a new Pages site (needs a one-time manual dashboard click by an
  org admin), so Cloudflare was used instead. Don't re-add a Pages workflow
  without knowing that limitation.
- To preview locally: no server needed, just open `index.html` in a browser,
  or run any static file server (`python3 -m http.server`) from the repo
  root if you want relative-path fetches (video/image `loading="lazy"`, etc.)
  to behave exactly like production.

## Design system conventions (important before editing CSS)

- **Dark-first theme with a light "paper" override.** Root tokens in
  `:root` (`--bg`, `--ink`, `--surface`, `--rust`, `--amber`, `--sage`, etc.)
  define the default dark theme. Add class `section--paper` to any
  `<section>` to flip it to a warm off-white theme — it works by
  **overriding the same custom properties** (`--ink`, `--surface`, `--border`,
  etc.) inside that section, so any component using those variables
  (cards, buttons, badges) re-themes automatically. Only things using
  *hardcoded* colors (not variables) need manual paper-specific overrides —
  search for `.section--paper .foo` rules to see the ones already needed.
- **`--ledger` and `--sage`/`--paper-sage` are deliberate, distinct accents**,
  not interchangeable "greens/creams": `--ledger` is a warmer parchment tone
  used only for the Results section (so it doesn't look like a repeat of the
  Services/Testimonials paper tone); `--sage` is the brighter green used for
  the Thai Bodywork card/Recovery section fill; `--paper-sage` is the darker
  green used for things that need to *contrast* against a `--sage` background
  (badges, icons, bullets sitting on top of it).
- **Hover vs. "backlit" (touch) states.** Cards with hover effects
  (`:hover`) are gated behind `@media (hover: hover) and (pointer: fine)` so
  touchscreens don't get stuck "sticky hover." Touch devices instead get an
  `.is-backlit` class toggled by an `IntersectionObserver` in `main.js`
  (`setupScrollBacklight()`) when a card crosses the vertical center of the
  viewport while scrolling. When adding a new hover effect to a card, check
  whether it should also get a matching `.is-backlit` rule and be added to
  that observer's selector list.
- **CSS specificity gotcha (already fixed once, watch for it again):** the
  reveal-on-scroll system adds `.is-visible` via JS, and
  `.js-ready .foo.is-visible { transform: ... }` has specificity `(0,3,0)`.
  A plain `.foo:hover { transform: ... }` (`0,2,0`) will silently lose to
  that rule on any element carrying both classes. Fix is to scope hover/
  backlit rules with the section's `#id` (e.g. `#results .result-card:hover`)
  so the ID selector wins outright.
- **Breakpoints:** `640px` (mobile), `860px` (tablet/mobile nav cutoff),
  `861px` used as the "desktop starts here" media query for a few
  desktop-only tweaks (hero headline line breaks). Not a formal system, just
  match whichever nearby rule you're extending.
- **`prefers-reduced-motion`** is respected globally (CSS resets animation/
  transition durations to ~0) and explicitly checked in `main.js` before
  starting any `setInterval`-driven loops (tagline rotator, hero word
  rotator) or IntersectionObserver-driven effects — always gate new
  continuous animations the same way.
- **Progressive enhancement:** `main.js` adds a `.js-ready` class to `<html>`
  as its first line. Anything that should be hidden-until-revealed by JS is
  scoped under `.js-ready` in CSS (e.g. `.js-ready .reveal`), so content is
  fully visible by default if JS fails to load, and only gets the animated
  hidden-state when JS is confirmed running.

## Things a new developer should double check before big changes

- Any copy/price change (e.g. the $57→$97 update) needs to be grepped across
  the whole file — the same number/phrase tends to appear in the meta
  description, the hero CTA, the service card price, and the Book section
  lede independently; there's no single source of truth/template.
- The hero headline ("Let your body show how [strong/resilient/capable] you
  really are.") has parallel desktop/mobile copies of some words
  (`.hero-how--desktop` / `.hero-how--mobile`) purely for responsive line-
  wrapping control — if you change the wording, update both.
