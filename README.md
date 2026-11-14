<h1 align="center">Wanderlust Studio</h1>

<p align="center">
  <strong>Turn your travels into stories worth exploring.</strong>
</p>

<p align="center">
  A bilingual travel blog CMS, responsive image pipeline, and static-site publisher built for expedition writing.
</p>

<p align="center">
  <a href="https://github.com/laboef1900/wanderlust-studio/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/laboef1900/wanderlust-studio/actions/workflows/ci.yml/badge.svg?branch=dev"></a>
  <img alt="Astro 7" src="https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white">
  <img alt="Node 26" src="https://img.shields.io/badge/Node-26-339933?logo=nodedotjs&logoColor=white">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white">
  <img alt="Docker amd64 · arm64" src="https://img.shields.io/badge/Docker-amd64%20%C2%B7%20arm64-2496ED?logo=docker&logoColor=white">
  <a href="LICENSE"><img alt="License: AGPL v3" src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/authoring-workflow.md">Authoring workflow</a> ·
  <a href="docs/install.md">Server install</a> ·
  <a href="https://github.com/laboef1900/wanderlust-studio/releases">Releases</a>
</p>

---

## More journey. Less publishing machinery.

Your best travel stories deserve more than a camera roll. **Wanderlust Studio** brings field notes, photographs, and the places between them into a travel journal you host yourself.

Write in a visual editor, give your photographs a full editorial spread, and trace the journey on a map. Publish in German, English, or both—from one browser-based studio, without committing Markdown to git or running a separate image service.

Originally built for **Simon's Wanderlust**, it pairs a photography-first public blog with the tools behind it: a writing desk, media library, and static-site publisher. **Bring the photographs. Tell the story. Make it yours.**

## Everything a travel story needs, built in

- **Write in visual mode or Markdown.** Draft in a clean rich-text studio or switch straight to Markdown source—with separate opening and title photography, key facts, ordered stops, revision history, and live preview before anything goes live.
- **Give your photography room to breathe.** Upload in bulk, organize into folders, and inspect camera exposure details (focal length, aperture, ISO, shutter). Every upload generates responsive **AVIF and WebP** variants automatically (with a JPEG option and side-by-side quality preview), while source originals stay private and published images strip GPS coordinates.
- **Describe a photo once, use it everywhere.** Drop justified gallery rows, full-bleed breakouts, or interactive sliders with a lightbox right inside your manuscript. Maintain German and English alt text and captions once in **Media**, and every story gallery picks them up on the next rebuild.
- **Put the places on the page.** Connect published stories on a global travel map, import GPX tracks (simplified cleanly for public routes), and generate car, bike, or foot legs between stops with bundled OSRM—all rendered over self-hosted map tiles and fonts with zero third-party map trackers.
- **Tell it in two languages.** Keep German and English editions paired in one editor—sharing routes and trip details while localizing titles, excerpts, countries, and key facts—or run a German-only or English-only site with your choice of primary root URL.
- **Optional AI copilot, strictly on your terms.** Draft from trip event notes, translate between German and English while preserving galleries and frontmatter, review stories, suggest excerpts, and bulk-caption photo folders using local models or your own OpenAI, Anthropic, or OpenRouter keys—sent straight from your browser, never required to write or publish.
- **Journeys, reader comments, and a clean escape from WordPress.** Group related stories into multi-leg **Journeys**, moderate self-hosted reader comments without collecting emails, migrate an existing WordPress blog via WXR import with preserved slugs and re-hosted photos, and export portable MDX plus database and image backups anytime.

## Is this your next writing desk?

**Built for:** independent travel writers and photographers who want their own editorial home, German and/or English publishing, and control over their content and hosting.

**Know before you start:** this is self-hosted software, not a managed service. You operate Docker, storage, HTTPS, upgrades, and offsite backups. Street-routing data can need substantial RAM and disk; check the [measured sizing and installation guide](docs/install.md) before choosing a server. AI is optional, but using a remote provider sends the selected material to that provider.

## Static speed on the outside. Full control underneath.

Readers get pre-rendered **Astro 7** HTML, with canonical URLs, `hreflang` alternates, JSON-LD, sitemaps, and RSS. Blog pages are served from static releases; optional reader comments are loaded separately from the app at request time. Maps use self-hosted tiles and fonts.

Underneath, **Node 26**, **Fastify 5**, **sharp**, and **PostgreSQL 18** power the studio. Saving a story draft leaves its published snapshot untouched; **Publish** builds a fresh static release and switches to it atomically. Pages have a different contract: saving an already-live page publishes that edit and requests a rebuild.

## Made for your server

Wanderlust Studio runs as a Docker Compose stack: `app` (CMS, image pipeline, builder, and static server), `db` (PostgreSQL 18), and two bundled street-routing services, `osrm-fetch` and `osrm`. Release images target **Linux `amd64` and `arm64`**; Docker Desktop supports local trials.

### Quick start

Installing on a production server? Start with the [installation guide](docs/install.md) for measured hardware sizing, secrets, reverse-proxy setup, blog and image domains, and backups.

For a local trial on your own machine:

```bash
cp uploader/.env.example .env
```

Edit `.env` and set all four required variables:

- `POSTGRES_PASSWORD` — generate with `openssl rand -hex 32`
- `PUBLIC_BASE_URL=http://localhost:3000`
- `IMG_HOST=localhost:3000`
- `IMAGE_TAG` — the numeric tag of a current published release, such as `0.23.0` (not `v0.23.0`), or `local` after building from source. Check [Releases](https://github.com/laboef1900/wanderlust-studio/releases) for available versions.

On Linux, prepare the data directory for uid `1000`, then start the stack:

```bash
mkdir -p uploader/data
sudo chown -R 1000:1000 uploader/data
docker compose pull      # skip for IMAGE_TAG=local
docker compose up -d
```

Open **http://localhost:3000/login** to create your first admin account and walk through the first-run checklist. Street routing automatically downloads and prepares only the countries your multi-stop stories use.

### Build from source

To run your own changes with `IMAGE_TAG=local` (requires access to the `dhi.io/node` hardened base images used in `Dockerfile`):

```bash
docker build -t ghcr.io/laboef1900/wanderlust-studio:local .
IMAGE_TAG=local docker compose up -d
```

> **Note:** Redeploying the container does not rebuild already-published static pages. Trigger **Publish** on a story or **Settings → Rebuild site now** to regenerate the live site.

### Connect an optional AI provider

Configure providers and per-use-case models under **Settings → AI models**. Local-only setups need no encryption master key. Remote API keys require a private `ENCRYPTION_KEY` (with separate key escrow for recovery); keys are encrypted at rest and decrypted only for signed-in authors making browser-direct requests. See [provider setup and credential recovery](uploader/README.md#ai-providers-and-encrypted-credentials-214-registry-2026-10-19).

### Under the hood & backups

| Part | Responsibility | Stack |
| :--- | :--- | :--- |
| [`site/`](site/) | Photography-first public blog built from published Postgres content | Astro 7, Tailwind 4, MapLibre |
| [`uploader/`](uploader/) | Wanderlust Studio desk, image pipeline, imports, builds, and serving | Node 26, Fastify 5, sharp |
| `db` | Stories, pages, journeys, accounts, media metadata, and comments | PostgreSQL 18 |

For local `site/` development against a reachable Postgres instance (`DATABASE_URL` set):

```bash
cd site && npm ci && npm run dev
```

Site unit tests run via `npm test` without a database (`npx astro check` and `npm run build` read from Postgres); `uploader/` integration tests use `TEST_DATABASE_URL`.

**Backups:** In-app database dumps, image archives, and private GPX archives are written under `/data/backup/db` on the host disk—pair them with offsite backups. See [backup and restore](ARCHITECTURE.md#backups--disaster-recovery) and the [upgrade recovery runbook](ARCHITECTURE.md#app-upgrades-and-supported-recovery) before upgrading (upgrades are roll-forward only; settings live outside database dumps).

## Documentation

- [Installation guide](docs/install.md) — supported server setup, requirements, reverse proxy, and domains
- [Authoring workflow](docs/authoring-workflow.md) — photos, stories, galleries, maps, and publishing
- [Architecture](ARCHITECTURE.md) — storage, deployment, builds, backups, and recovery
- [Security](SECURITY.md) — permissions, photo EXIF privacy, credentials, and request safeguards
- [Map assets](docs/map-assets.md) — self-hosted basemaps and fonts
- [Site development](site/README.md) · [CMS operations](uploader/README.md)
- [Release history and maintainer checklist](docs/releases.md)
- [Contributor conventions](CLAUDE.md) · [Design specs and plans](docs/superpowers/)

## Software, contributions and content rights

Wanderlust Studio software is free software licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`, Copyright 2026 Simon and contributors), covering original application code, tests, build scripts, and technical documentation without warranty. Third-party dependencies retain their own licenses.

**Content and brand are excluded.** Stories, translations, uploaded photographs, illustrations, MDX story content (including `site/src/content/trips/` stubs), reader submissions, and the **Simon's Wanderlust** and **Wanderlust Studio** names and logos are not open-licensed here ([NOTICE](NOTICE) · [owner decision](docs/superpowers/specs/2026-10-27-software-content-brand-rights-design.md)). Using this software does not license your own content under AGPL.

**Contributions** are accepted under `AGPL-3.0-only` (inbound = outbound) with no DCO or CLA.

<details>
<summary>Distributing or operating modified software (AGPL §6 / §13 &amp; notice packaging)</summary>

- Distributors must provide exact Corresponding Source under AGPL §6 alongside each image or release; operators of modified network versions must prominently offer Corresponding Source to all remote users at no charge under §13.
- Release builds record the repository and full commit in `/app/source-release.json` and expose `/legal/de.html`, `/legal/en.html`, and `/admin/legal/en.html`. Operators running modified builds must update those static source directions to match their actual source.
- `node uploader/scripts/generate-third-party-inventory.mjs` regenerates [docs/third-party-inventory.json](docs/third-party-inventory.json) ([evidence](docs/third-party-evidence.json), [image evidence](docs/third-party-image-evidence.json)); after `npm ci`, `node uploader/scripts/copy-legal.mjs site` and `node uploader/scripts/copy-legal.mjs uploader` package license and third-party notices (check `notice-gaps.json` and emitted/native assets).

</details>

## Releases and upgrades

See the [release history and maintainer checklist](docs/releases.md) for version-specific migrations, recovery evidence, and release procedures. For a new install, choose a current published image from [GitHub Releases](https://github.com/laboef1900/wanderlust-studio/releases); do not treat historical tags as supported downgrade targets.

<p align="center">
  <strong>Self-hosted at heart. Built for the road.</strong>
</p>
