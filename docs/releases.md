# Release history and maintainer checklist

[Back to Wanderlust Studio](../README.md) · [Canonical upgrade and recovery runbook](../ARCHITECTURE.md#app-upgrades-and-supported-recovery)

Historical release notes follow. They record release-specific changes, not a promise that an old image is a safe downgrade target. The current recovery runbook and release gate take precedence over historical rollback statements.

### Cutting a release

**v0.23.0 — AI story drafts from trip events** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.23.0`). Changes since v0.22.0 (PR #580):

- **Draft with AI** (#579): an empty story language can be drafted from a list of trip events. The author
  ticks which story details to share, reviews a plain-text preview and applies it as an unsaved edit.
  Spec: `superpowers/specs/2026-11-12-issue-579-ai-post-drafting.md`.
- **Settings:** a new Story drafting assignment (provider, model, timeout, editable instructions with Reset).

Upgrade notes for v0.22.0 → v0.23.0 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.23.0`).
- **Schema:** no changes. Drafting settings live in the existing settings storage and need no migration.
- **Compose and `.env`:** no changes.
- **Rollback to v0.22.0:** supported by reverting the image tag; unused drafting settings are ignored.
- **Privacy:** when Story drafting follows the default provider, signed-in authors receive that provider's key
  for the one request (see `SECURITY.md`).

**v0.22.0 — publish-time language choice, media exposure details, posts bulk bar** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.22.0`). Changes since v0.21.3 (PRs #571, #572, #573, #574, #575):

- **Publish languages** (#574): choose which languages to publish in the Publish dialog, plus a Translate action (#567/#568).
- **Media details** (#573): photo exposure settings (focal length, aperture, ISO, shutter) parsed from EXIF, a
  `backfill-exif` CLI for older rows, version listing and a viewer (#570).
- **Posts list** (#575): floating bulk-action bar, filter menus and hover checkboxes (#566).
- **Editor** (#572): one-line stop controls with icon Find coordinates (#569).

Upgrade notes for v0.21.3 → v0.22.0 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.22.0`).
- **Schema:** additive only — five nullable `media` exposure columns added by `ensureSchema` on boot
  (`ADD COLUMN IF NOT EXISTS`, no row rewrite). Optionally run `backfill-exif` to fill older photos.
- **Compose and `.env`:** no changes.
- **Rollback to v0.21.3:** supported by reverting the image tag; the extra nullable columns are ignored.

**v0.21.3 — Admin Studio UI/UX overhaul and repository rename** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.21.3`). Changes since v0.21.2 (PRs #562, #563):

- **Admin Studio UI/UX overhaul** (#563): shared `admin-ui.js` / `manuscript-bar.js` modules,
  consistency review fixes across admin pages (spec:
  `superpowers/specs/2026-11-10-admin-consistency-review-fixes.md`), and updated
  `DESIGN.md` / `PRODUCT.md` conventions.
- **Media alt-text filter** (#563): `GET /media?alt=missing` lists ready photos with no DE/EN alt
  text, and the response carries an `altMissing` count for the Media page.
- **Repository rename** (#562): repository is now `laboef1900/wanderlust-studio`; legacy
  uploader naming and pre-rebuild research memos removed from docs.

Upgrade notes for v0.21.2 → v0.21.3 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.21.3`).
- **Compose, `.env`, and schema:** no Compose changes, no `.env` changes, no schema migrations, and no
  dump-format changes (writer stays v15); no site rebuild required.
- **Rollback to v0.21.2:** fully supported by reverting the image tag.

**v0.21.2 — backend UI proportions and design consistency** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.21.2`). Changes since v0.21.1 (PRs #558, #559):

- **Admin UI refinements** (#559): reduced masthead height to 48px, unified button sizing and
  proportions across admin pages, introduced `.btn-sm` hierarchy, consolidated Review story into
  More actions, and aligned gallery and settings controls.
- **Brand accents and UI conventions** (#558): documented and aligned brand palette accents
  (`--red: #d23b30`, `--navy: #263b51`), contrast requirements, and editorial desk design rules
  across admin surfaces and documentation.

Upgrade notes for v0.21.1 → v0.21.2 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.21.2`).
- **Compose, `.env`, and schema:** no Compose changes, no `.env` changes, no schema migrations, and no
  dump-format changes (writer stays v15); no site rebuild required.
- **Rollback to v0.21.1:** fully supported by reverting the image tag.

**v0.21.1 — OpenAI provider kind and Anthropic endpoint compatibility** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.21.1`). Changes since v0.21.0 (PR #555):

- **OpenAI provider kind** (#555): dedicated OpenAI option in Settings → AI models with endpoint
  prefilling (`https://api.openai.com/v1`), credential management, and registration across reviews,
  excerpts, photo descriptions, and article translation.
- **Anthropic endpoint compatibility** (#555): omits `response_format` and vision `temperature`
  when querying `https://api.anthropic.com` to adhere to Anthropic's OpenAI-compatible endpoint
  constraints, and adds fallback error recognition for `response_format.type` validation errors.

Upgrade notes for v0.21.0 → v0.21.1 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.21.1`).
- **Compose, `.env`, and schema:** no Compose changes, no `.env` changes, no schema migrations, and no
  dump-format changes (writer stays v15); no site rebuild required.
- **Rollback to v0.21.0:** fully supported by reverting the image tag.

**v0.21.0 — visual manuscript editing, AI translation and editorial desk** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.21.0`). Changes since v0.20.0 (PRs #540–#552):

- **Visual post editor with Markdown source toggle** (#548, #552): rich-text manuscript writing powered
  by Tiptap as the default editor surface with an EasyMDE Markdown source toggle. Retains clean Markdown
  persistence, safe HTML preservation, gallery directives, and borderless focus.
- **Protected AI article translation** (#550, #551): in-browser DE↔EN story translation using configured
  AI providers. Preserves galleries, media references, occurrence overrides, and frontmatter, with full
  review and draft apply confirmation.
- **Anthropic provider kind** (#549): dedicated Anthropic option in Settings → AI models with endpoint
  prefilling (`https://api.anthropic.com/v1`), browser-direct transport, and model discovery.
- **Editorial desk, media and settings refinements** (#541–#547): prioritized writing desk, pinned
  manuscript toolbar, folded story details, photo-first media drawer, and task-oriented settings layout.
- **Interactive map polish** (#540): place names, pin clustering, graticule lines, photo popups, region
  filters, and expedition log ledger.

Upgrade notes for v0.20.0 → v0.21.0 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image and deployment:** apply this release's image tag (`0.21.0`).
- **Compose, `.env`, and schema:** no Compose changes, no `.env` changes, no schema migrations, and no
  dump-format changes (writer stays v15); no site rebuild required.
- **Rollback to v0.20.0:** fully supported by reverting the image tag.

**v0.20.0 — street-routing regions follow the stories** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.20.0`). Changes since v0.19.1 (PR #523):

- **Automatic routing regions** (#523): no `.env` region list. When a story has two or more
  stops, the app resolves its country to one Geofabrik extract (ambiguous codes are
  unsupported, never guessed), and the bundled OSRM downloads, builds and serves car, bike and
  foot for that country, one build at a time. Countries no longer used stop serving. A leg
  between two countries is a flagged straight line. The editor shows preparing, failed or
  unsupported in both languages
  ([spec](superpowers/specs/2026-11-04-osrm-automatic-regions-design.md)).
- **Allow-list:** `ROUTING_INTERNAL_ORIGINS` accepts one host with a port range
  (`http://osrm:5100-5999`); exact origins are unchanged and malformed ranges refuse boot.
  Settings → Street routing URLs are now optional external services, used only where no bundled
  country is ready.

Upgrade notes for v0.19.1 → v0.20.0 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image, Compose and `.env`.** Apply this release's `docker-compose.yml` with the image.
  `osrm-prepare` and `osrm-car` / `osrm-bike` / `osrm-foot` are replaced by the long-running
  `osrm-fetch` and `osrm`. Remove `OSRM_PBF_URLS` and `OSRM_PREPARE_MEM_LIMIT` from `.env`;
  optionally set `OSRM_MEM_LIMIT` (default `4g`, the peak of the largest single country). Run
  `docker compose up -d --remove-orphans` to drop the old OSRM containers.
- **Settings:** clear the `http://osrm-*:5000` Street routing URLs; those hosts are no longer
  allow-listed. No settings migration is written.
- **Network:** `app` fetches the Geofabrik index (`download.geofabrik.de`, via `safeFetch`,
  cached 24 h); `osrm-fetch` needs outbound HTTPS to Geofabrik and the Debian mirror.
- **Map data:** the first start deletes v0.19.x's merged graph from the `osrm` volume;
  countries are rebuilt from the stories ([install §4g](install.md#4g-street-routing-bundled-osrm)).
  The volume stays rebuildable map data, not recovery material.
- **Schema, dumps and rebuild:** no schema, dump-format (writer stays v15) or image-archive
  change; no site rebuild required.
- **Rollback to v0.19.1:** supported (same schema and dump format) together with v0.19.x's
  Compose file and an `OSRM_PBF_URLS` list in `.env`; its `osrm-prepare` rebuilds the merged
  graph, then re-enter the `http://osrm-*:5000` Settings URLs.

**v0.19.1 — direct Anthropic provider and sidebar account trigger** (linux/amd64 and
linux/arm64, `ghcr.io/laboef1900/wanderlust-studio:0.19.1`). Changes since v0.19.0
(PRs #524–#526):

- **Direct Anthropic** (#525): a Custom AI provider at `https://api.anthropic.com/v1` now lists
  models and runs reviews, excerpts and captions from the browser. For that exact HTTPS origin
  only, requests carry Anthropic's browser-access opt-in and API-version headers
  ([spec](superpowers/specs/2026-11-04-anthropic-browser-access.md)). Existing providers,
  stored keys and assignments are kept.
- **Admin sidebar** (#524): the account trigger is the avatar alone; name and role head the
  account panel above Log out, so long usernames no longer wrap.
- **Docs** (#526): authoring workflow documents the reload-pending Save/Publish refusal and
  the Save-draft-and-attach-route scope.

Upgrade notes for v0.19.0 → v0.19.1: swap `IMAGE_TAG` only. No Compose, `.env`, schema,
settings, dump-format (writer stays v15) or image-archive change; no rebuild required.
Rollback to v0.19.0 is supported (same schema and dump format).

**v0.19.0 — street routing for stops** (linux/amd64 and linux/arm64,
`ghcr.io/laboef1900/wanderlust-studio:0.19.0`). Changes since v0.18.1 (PRs #511, #515–#520):

- **Stop routing** (#513): stories without a published GPX track can show a line along their
  ordered stops, per leg by car, bike, foot or straight, with via points that never appear
  publicly. Unroutable legs fall back to flagged, dashed straight lines (#517).
- **Bundled OSRM** (#519, #520): the Compose stack downloads and merges the OpenStreetMap
  extracts listed in `OSRM_PBF_URLS` and runs `osrm-car` / `osrm-bike` / `osrm-foot`
  (memory-mapped). The app reaches them only through the exact-origin allow-list
  `ROUTING_INTERNAL_ORIGINS`. Every leg bounds snapping to 5 km, so stops outside the map data
  become flagged straight legs instead of a false road at the extract's edge.
- **Editor:** Story details framed with the manuscript, collapsible image sections (#515); the
  Route caption is scoped to the GPX route section (#512, #516); About Me equipment is editable
  (#514, #518). Release evidence for v0.18.1 recorded (#511).

Upgrade notes for v0.18.1 → v0.19.0 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image, Compose and bootstrap.** Apply this release's `docker-compose.yml` with the image.
  Set **`OSRM_PBF_URLS`** (one or more HTTPS `.osm.pbf` extracts) in `.env` **before any
  Compose command**: without it every command, including `stop`, `run` and the restore
  runbook, fails to interpolate. Optional `OSRM_PREPARE_MEM_LIMIT` (default `4g`) bounds the
  graph build. New services: `osrm-fetch` (digest-pinned `debian:trixie-slim`; installs `curl`
  and `osmium-tool` from Debian at run time, so it needs outbound HTTPS to the Debian mirror
  and the extract host), `osrm-prepare`, and `osrm-car` / `osrm-bike` / `osrm-foot` (no host
  ports). `app` gains the literal `ROUTING_INTERNAL_ORIGINS`. The proxy topology,
  `TRUSTED_PROXY` and Postgres 18 are unchanged. The first full `up -d` downloads and builds
  (the app does not wait); then set **Settings → Street routing** to
  `http://osrm-car:5000`, `http://osrm-bike:5000`, `http://osrm-foot:5000`
  ([install §4g](install.md#4g-street-routing-bundled-osrm)).
- **Capacity.** The graph build sizes the host. Measured peaks (arm64): Costa Rica + Ecuador
  (158 MB) 3.5 GB with a 1.1 GB graph per mode; Mexico + Costa Rica + Ecuador (780 MB) exceeded
  12 GB. Choose `OSRM_PBF_URLS` against a measured build. The `osrm` volume is rebuildable map
  data, not recovery material.
- **Schema migrations** (forward and additive at boot, no `DROP`, no data rewrite):
  `posts.stop_route jsonb` (`ADD COLUMN IF NOT EXISTS`).
- **Settings migration:** none. Three new keys `routingCarUrl` / `routingBikeUrl` /
  `routingFootUrl` default to empty (routing disabled); no migration copy is written.
- **Dumps:** the writer is **v15** (adds the private `posts.stop_route` and
  `published_snapshot.stop_route`); this release reads v1–v15. v0.18.1 reads only v1–v14, so no
  dump taken after the upgrade restores on it. v1–v9 still cannot supply private GPX routes.
  No image-archive format or cutoff change.
- **Recovery material:** before upgrading, capture one generation on v0.18.1 under a write
  freeze, per the [canonical runbook](../ARCHITECTURE.md#app-upgrades-and-supported-recovery):
  the v14 dump with its route archive, the complete image chain, `settings.json`, Compose and
  `.env`, and the separately escrowed `ENCRYPTION_KEY` association.
- **Rebuild:** not required. Deploying does not rebuild; published stories carry no stop route
  until an author calculates one and publishes. The next Publish or **Settings → Rebuild site
  now** ships the new mini-map rendering.
- **Recovery direction: roll-forward only; no supported downgrade.** v0.18.1 cannot read v15
  dumps.
- **Evidence (2026-11-03, bounded):** disposable local rehearsal on macOS Docker Desktop
  (arm64 Linux VM, Compose 5.6.1), separate project, volumes and data directory:
  1. Published `0.18.1` (`sha256:6a12b5fb85be…`) fresh install: setup, one bilingual draft with
     two stops, and a v14 dump.
  2. This release's Compose and `.env` (Costa Rica), then `up -d --no-deps app` with a candidate
     image built from `8c67a0f` (the version-bump commit; the tagged image is a later build).
     Result: healthy, `posts.stop_route` added, draft intact, routing URLs empty.
  3. Full `up -d`: the OSRM fetch and build exited 0. Saving the routing URLs returned 200 and
     `POST /posts/:tk/stop-route` returned a road leg.
  4. A v15 dump (2 `stop_route` rows).
  5. An offline `restore --yes` of the **v14** dump on the new image verified a pre-restore set,
     restored 1 user and 2 posts, and after restart the draft was intact with no stop route.

  Not covered: native Linux, amd64, a production-size corpus, images, GPX archives, comments
  or a TLS proxy.

**v0.18.1 — first release as `ghcr.io/laboef1900/wanderlust-studio`** (linux/amd64 and
linux/arm64). The `v0.18.0` tag's release workflow failed before publishing (it overrode the
Dockerfile's digest-pinned DHI bases with floating tags, which the native-build stage
refuses): there is no v0.18.0 image or GitHub Release. The product is now **Wanderlust
Studio**; the software is AGPL-3.0-only and stories, photos and the blog's brand are
excluded (`NOTICE`). Changes since v0.17.1 (PRs #401–#508; the GitHub release lists each one):

- **Site identity** in Settings: site and author name, canonical blog origin, taglines,
  social links, logo and favicons (#433, #454, #478).
- **Language modes:** DE+EN, EN+DE, DE-only or EN-only, chosen at first run (#476, #477, #482).
- **Editable pages** (About, Contact, Privacy, Legal notice) with draft/publish and
  configurable navigation (#484, #485).
- **Journeys:** ordered groups of stories with their own localized pages and overview maps
  (#490, #491).
- **First-run onboarding** with role-safe empty states (#474, #483).
- **Truthful writes and publication:** ambiguous saves and uploads are reconciled, draft
  recovery is isolated, and Publish reports the actual build outcome and release inclusion
  (#479, #486–#488).
- **Phone authoring:** compose, preview and background stash on a phone; Publish is
  admin-only there; unusable phone photos are refused before transfer (#500, #501).
- **Licensing:** `LICENSE`, `NOTICE`, `/legal/` and `/admin/legal/` notice pages, OCI
  license labels and a third-party inventory (#455, #499).
- **Security:** sharp 0.35.5 (libvips 8.18.7, libheif 1.23.5, librsvg 2.63.2) for untrusted
  AVIF/SVG input (#403); patched production dependencies and explicit proxy trust (#404);
  fresh consent per destructive confirmation (#401); atomic last-admin deletion (#414).
- Fixes across the editor, galleries, media library, comments moderation, WordPress import,
  backups, maps and public-page contrast (WCAG AA).

Upgrade notes for v0.17.1 → v0.18.1 (the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)):

- **Image, Compose and bootstrap.** Apply this release's `docker-compose.yml` together with
  the image. `IMAGE_TAG` (no default), `PUBLIC_BASE_URL` and `IMG_HOST` are now required in
  `.env`; the old `simonswanderlust.com` defaults are gone. Compose sets
  `TRUSTED_PROXY: docker-gateway`, valid only for a host TLS proxy → loopback port →
  Compose bridge; the old hop-count setup does not satisfy it and other topologies are
  unsupported. Postgres stays at 18.
- **Schema migrations** (forward and additive at boot, no `DROP`): new tables
  `site_identity`, `site_identity_assets`, `site_language`, `site_nav`, `journeys`,
  `journey_locales`, `journey_members`, `onboarding_state` and `upload_receipts`; `pages`
  gains `slug`/`status`/`published_at` (About becomes published); `posts` gains `omitted`
  with the `posts_omitted_unpublished` check; `posts`/`pages` gain `last_save_id`/`last_save_by`;
  orphaned `page_revisions` rows are deleted. An existing install is seeded with the legacy
  identity (`Simon's Wanderlust`, `https://simonswanderlust.com`), DE-primary DE+EN, default
  navigation, and onboarding retired.
- **Settings migration:** with the legacy identity, a valid `settings.json` without
  `reviewPrompt` gets the previous brand-specific review prompt written into it (no copy is
  kept; the key was absent). An unreadable or invalid file is left alone. Nothing else changes.
- **Dumps:** the writer is **v14** (identity v11, language v12, pages/navigation v13,
  journeys v14); this release reads v1–v14. v0.17.1 reads only v1–v10, so no dump taken
  after the upgrade restores on it. v1–v9 still cannot supply private GPX routes. A ≤ v10
  restore seeds the legacy identity and DE+EN. No image-archive format or cutoff change.
- **Recovery material:** before upgrading, capture one generation on v0.17.1 under a write
  freeze, per the [canonical runbook](../ARCHITECTURE.md#app-upgrades-and-supported-recovery):
  the v10 dump with its route archive, the complete image chain, `settings.json`, Compose and
  `.env`, and the separately escrowed `ENCRYPTION_KEY` association.
- **Rebuild:** deploying does not rebuild. The blog keeps serving its v0.17.1 output until
  the next Publish or **Settings → Rebuild site now**. Rebuild once after verifying the
  upgrade (check **Settings → Site identity** first) to ship the `/legal/` pages, map
  attribution and rendering fixes.
- **Recovery direction: roll-forward only; no supported downgrade.** v0.17.1 lacks #347's
  codec floor and cannot read v11+ dumps or the new tables.
- **Evidence:** no v0.17.1 → v0.18.1 upgrade rehearsal was run for this release. Existing
  evidence covers a DHI candidate pair at dump v10 (#298, 2026-10-29), the native v0.17.1
  clean install ([record](2026-10-29-clean-install-rehearsal.md)) and N13 → N14 restores
  during the journeys work. Treat this upgrade as unrehearsed and capture recovery first.

**v0.17.1** (last release as `ghcr.io/laboef1900/simonswanderlust-app:0.17.1`) fixed
stale-locale gallery reloads, end-of-story galleries, antimeridian route framing, publish
readiness against rendered images and incremental image-archive boundaries. Its first image
backup after upgrading created a full image archive.

Upgrading from before v0.17.0: GPX recovery requires the private v10 database dump **and
its matching route archive**. Restore is offline: stop the app before running the restore
CLI, then restart it after inspecting the result. API clients calling
`POST /posts/:tk/publish` must send `baseUpdatedAt` and `baseRouteVersion`; the bundled
editor already does so. GPX originals, elevation and timestamps stay private but are
readable by authenticated authors. Publish creates a simplified, four-decimal 2D route;
explicitly adopted waypoints remain shared stops at their exact coordinates.
Deploying does not publish drafts or rebuild the live blog. Route precision is not
anonymization: remove sensitive points and inspect separately adopted stops before Publish.

**Historical v0.15.0 migration/recovery note — not a supported downgrade target.**
The v0.14.1 → v0.15.0 transition migrated `settings.json` and the legacy stored AI key into
the provider registry, retaining `settings.json.pre-ai-registry`, and widened the region
constraint. Before such a migration, the recovery point must include an old-app pre-deploy
dump and matching pre-upgrade settings/bootstrap with separate master-key escrow.
Recovering the legacy registry/key arrangement would require **both** that pre-deploy dump
and the pre-upgrade settings (or a verified matching `settings.json.pre-ai-registry`), plus
the exact target schema and release-specific procedure. A post-upgrade dump does not undo the
registry migration even when its format version is unchanged; a migration copy is not a
snapshot of later settings edits.

Every retained story would also need a region accepted by the old renderer. A pre-upgrade
snapshot may remove newer region values at the cost of losing later edits; there is **no
automatic region reassignment, slug change or owner-content rewrite**. Otherwise retain a
compatible secure release and repair forward. These old tags are historical, not current
security-supported recovery targets. The owner amended the historical downgrade rehearsal
criterion on 2026-10-28: qualify supported upgrade/roll-forward recovery instead, and report
backward recovery as unsupported/pending until an eligible pair exists. No historical
downgrade or region-reassignment rehearsal is claimed.

**Release gate:** complete the [release recovery checklist](../ARCHITECTURE.md#release-recovery-checklist)
before tagging. Notes must state schema/settings migrations (including “none”), dump writer
and reader versions/fidelity exclusions, full recovery material and capacity, actual
Compose/bootstrap/proxy changes, explicit rebuild requirements, and release-specific
recovery steps with evidence or **“roll-forward only; no supported downgrade.”** Eligibility
is limited to the immediately previous security-supported, rehearsed pair; none is established
today. #347's patched codec floor is mandatory and its recovery remains roll-forward only.
An app upgrade does not authorize a [Postgres-major change](../ARCHITECTURE.md#upgrading-a-postgres-major-eg-17--18).

Each release is a separate, owner-authorized action. Satisfy the release gate above before
tagging; generated notes alone do not qualify.

1. On a `feature/*` branch from `dev`, choose an unused next release version and
   update both apps' package and lockfile versions. Keep `IMAGE_TAG` explicit (no
   historical default); document the new version and the
   `ghcr.io/laboef1900/wanderlust-studio` package in the release notes.
2. Merge a green PR into `dev`, then a green release PR from `dev` into `main`.
3. Only with owner release authorization, create and push a **new** `vX.Y.Z` tag
   on the merged `main` commit. Do not recreate `v0.17.1` or replay earlier releases.
4. Confirm the workflow published the version for both architectures under the
   new name, record its digest and verify package visibility/access for intended
   installers. Only then may an operator set that version as `IMAGE_TAG` and
   pull/deploy with the new Compose file. Existing private `.env` files must be
   updated deliberately, not copied over or silently rewritten.

Never push directly to protected branches, tag an unmerged feature branch or replace a
published tag. Only stable tags at the current `main` tip with green CI for that revision
are eligible. The workflow builds once per native amd64/arm64 architecture, qualifies those
exact images (ownership/restore and legal assets), then promotes their digests to version,
minor and `latest` tags in `ghcr.io/laboef1900/wanderlust-studio` and creates the GitHub Release.
Staging candidate tags are not deployment tags. See the
[automation contract and test commands](superpowers/specs/2026-11-13-github-automation-hardening.md).
It requires repository variable `DHI_USERNAME` and secret
`DHI_TOKEN` to pull the hardened base images. Verify the workflow before deployment;
publishing a release does not deploy it or rebuild the live blog.

See the [image-name cutover record](superpowers/specs/2026-10-27-issue-291-image-name-cutover.md)
for scope, retained history and recovery constraints.

