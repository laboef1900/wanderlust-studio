# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Simon (sole author and admin): a travel photographer and writer who manages a bilingual (DE/EN) travel blog. Publishes trip reports with rich photography, interactive maps, and key facts from expeditions around the world. The platform itself is configurable for other single-author installs: German or English as the primary language, with or without the other as a secondary language.

## Product Purpose

Simon's Wanderlust is a personal travel journal that presents expedition-style trip reports with professional photography (shot on Leica Q2 and Canon AE-1), interactive route maps (Protomaps/PMTiles), and bilingual content. The admin ("Wanderlust Studio") is the content management backend: authoring, editing, uploading photos, publishing, and managing the live site.

## Positioning

Self-hosted, single-author travel CMS with a custom bilingual editor, automatic responsive image pipeline (AVIF/WebP variants), interactive map integration, and a publish/snapshot workflow that keeps drafts isolated from the live site. Four language modes — DE+EN DE-primary (the live site), DE+EN EN-primary, DE-only, EN-only — are stored in Postgres and locked at the first publish so no published URL moves.

## Operating Context

- Simon accesses the admin on desktop browsers (primarily) to write and edit posts, upload and manage photos, and publish to the live site.
- The editor handles DE/EN post pairs with a shared translation key (only enabled languages appear; Publish chooses which of them go live), a Visual rich-text body and editable Markdown source, hero image and body image management, key facts, stops/route data, and coordinates.
- Publishing triggers a static site rebuild (Astro) inside a Docker container; the live blog is served as pre-rendered HTML.
- Image uploads are processed through a pipeline that generates responsive AVIF/WebP variants at multiple sizes.

## Capabilities and Constraints

- **Pages:** Login (with first-run admin setup), Desk (with an optional first-run checklist), Posts list, Story editor, Media library, Journeys list and journey editor, Pages list and page editor (About, Contact, Privacy, Legal notice), Comments moderation queue, Import (WordPress WXR), Settings (AI models, Images, Comments, Site identity, Navigation, Languages, Site & backups), Users management, License and source.
- **Comment moderation queue:** Reader comments on trip reports are held until an admin approves them (`/admin/comments.html`). Admins approve, unapprove, delete (erasure, with confirmation) and reply as the author; author replies publish immediately. Comments are self-hosted in Postgres — Principle 4 still holds, no third-party comment service.
- **Auth:** Cookie-based sessions with admin/non-admin roles; rate-limited login.
- **Editor:** Bilingual DE/EN tabs (enabled languages only, primary first), slug preview, hero image picker (library only), Visual Tiptap editing by default with an EasyMDE Markdown switch, key facts and stops editors, GPX route import, revision history, preview, publish/unpublish. Publish opens a dialog that confirms the languages going live: the primary always publishes and a published secondary cannot be dropped. Markdown remains the canonical draft. The page editor uses the same command bar and Visual / Markdown manuscript (2026-11-10). Country names can fill approximate map coordinates offline without replacing saved/manual locations. Optional browser-direct excerpt suggestions reuse Story Review settings and require explicit acceptance. Browser-direct AI **Translate** carries the latest unsaved draft to the other enabled language (#550), and an empty story language can be drafted with AI from a list of trip events and opt-in story details (#579); both are previewed and applied explicitly, never saved or published automatically.
- **Pages and navigation:** Admins edit About (fixed, undeletable) and optional Contact, Privacy and Legal notice pages; live pages are published by saving. Settings → Navigation edits the header (up to 5 links), footer (8) and legal strip (4) from site sections, pages, relative paths and external HTTPS links; saving rebuilds the site, and links to unpublished or untranslated targets are left out. Settings → Languages changes the language mode (the primary language locks at the first publish; only adding the secondary stays possible) and prepares inactive-language pages.
- **Media library:** One browsable store for every hosted photo — bulk drag-and-drop upload, virtual folders, search, per-item alt text. Optional browser-direct AI suggests title, DE/EN alt text and captions and tags for one photo (reviewed before saving) or fills empty fields for a selection or a whole folder view (saved as it runs; overwriting is opt-in per run). Encoding runs asynchronously behind a queue that a site build preempts; publishing is refused while a referenced photo is still encoding. GPS and uploader identity are redacted for non-admin authors.
- **Galleries:** Multiple photos render as one grid from a fenced `gallery` block, composed via the editor's **Gallery** toolbar picker (**Edit photos and layout** on an existing gallery preview) that reuses the library's own alt text. Three layout modes (justified rows at breakout or column width, or a slider), each with a lightbox.
- **Photo privacy:** Published variants carry an eight-tag EXIF allow-list — no GPS, XMP or IPTC — applied at encode time, so it covers WordPress-imported photos as well as direct uploads.
- **Tech stack:** Fastify server, primarily plain HTML/CSS/JS admin UI, PostgreSQL, Docker.
- **Constraint:** The admin UI is vanilla HTML/CSS/JS served from `uploader/public/`, except for the owner-approved, self-hosted rich-text editor bundle (2026-11-07), which the story editor and — since 2026-11-10 — the page editor load. `copy:vendor` uses esbuild to bundle its TypeScript at build time; fonts and vendor assets are generated locally, not fetched from a CDN. The rest of the admin remains vanilla. The exception's controls and review point are recorded in the [rich-text editor spec](docs/superpowers/specs/2026-11-07-rich-text-post-editor.md) and its extension in the [consistency review spec](docs/superpowers/specs/2026-11-10-admin-consistency-review-fixes.md).

## Brand Commitments

- Name: "Simon's Wanderlust" (blog), "Wanderlust Studio" (admin), with the descriptor "Simon's travel journal".
- Fonts: Inter (sans), IBM Plex Mono (mono) — self-hosted from `uploader/public/fonts/`
- Public blog colors: Navy (#142a42), Brand Red (#d23b30), Canvas (#fbfbfd).
- Public visual identity: Expedition/cartography theme with dashed route dividers, passport stamps, mono-tracked uppercase labels.
- Admin shell and Posts: **Editorial desk** — light gray navigation, frosted white workspace, compact lists, and steel-blue active navigation/New post. Publish and destructive actions retain red; the public blog is unchanged. Exact scoped tokens and responsive behavior live in `DESIGN.md`.

## Evidence on Hand

- Original content reference: travel reports spanning Europe, North America, and South America (not a live publication inventory)
- Real photography from Leica Q2 and Canon AE-1
- Interactive map with Protomaps PMTiles

## Product Principles

1. **Author-first workflow** — Every admin interaction serves the solo author's publishing workflow; no multi-tenant complexity.
2. **Photography leads** — The image pipeline and visual presentation treat photos as the primary content, not decoration.
3. **Bilingual by design** — DE/EN content lives as a first-class pair, not a translation afterthought. Single-language modes are supported without leaking the absent language.
4. **Self-hosted independence** — The stack is `app` (Fastify, which also builds the Astro site in-process) and `db` (Postgres), plus bundled OSRM street-routing services (`osrm-fetch`, `osrm`) that the blog and admin never depend on, with no third-party runtime services for readers.
   Owner-approved exception (2026-10-16): explicit waypoint searches in the editor
   use external Nominatim through the authenticated app, with caching/rate limits
   and manual-coordinate fallback. Public maps remain entirely self-hosted.

## Accessibility & Inclusion

WCAG 2.1 AA minimum. Admin must be keyboard-navigable and screen-reader usable.
