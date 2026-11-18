# simonswanderlust.com — site

The Astro 7 rebuild of [simonswanderlust.com](https://simonswanderlust.com), a DE/EN travel blog.
The same code builds all four language modes (DE+EN DE-primary — the live site —, DE+EN EN-primary,
DE-only, EN-only); the mode is read from Postgres at build time (see [Language modes](#language-modes)).
Architecture overview in [`../ARCHITECTURE.md`](../ARCHITECTURE.md); design spec and phase plans
live in `../docs/superpowers/`.

Content is **loaded from Postgres at build time** (`src/lib/postgres-loader.ts`), not from git —
the MDX files under `src/content/trips/` are an authoring reference / export-only backup. The
`app` container (`uploader/src/build.ts`) spawns `astro build` **in-process** from the database and
atomically publishes the result to `/data/site/current`, which it also serves directly — no
separate build server or web server. See `../ARCHITECTURE.md` for the full pipeline.

## Commands

Run from `site/`. `npm run dev`, `npm run build` and `npx astro check` run the Postgres content
loader, so they need a reachable database (`DATABASE_URL`). `dev` and `build` first run
`../uploader/scripts/copy-legal.mjs` to refresh `public/legal/` (git-ignored).

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview the build locally |
| `npm test` | Vitest unit/container suites; excludes `test/built/` and needs no database (the empty-build integration suite skips without `TEST_DATABASE_URL`) |
| `npm run test:coverage` | The same suites with coverage |
| `npm run test:built-routes` | `test/built/` route/page/journey contracts; needs `BUILT_ROUTE_CONTRACT_ROOT` pointing at four built releases (`de-bilingual`, `en-bilingual`, `de-only`, `en-only`) |
| `npm run test:built-contracts` | `scripts/verify-built-contracts.ts`: builds the four mode fixtures from a disposable database (`TEST_DATABASE_URL`, uses the uploader's `tsx`) |
| `npx astro check` | Type-check `.astro`/`.ts` files |

### Language modes

`astro.config.mjs` calls `resolveBuildLanguage` (`src/lib/build-language.ts`), which re-reads the
Postgres `site_language` singleton and, when the app hands over `SITE_LANGUAGE_JSON`, fails the
build if the two differ. The primary locale is served at the root and the optional secondary under
`/<locale>/`: DE-primary keeps every live WordPress URL (`/…` and `/en/…`); EN-primary serves
`/…` in English and `/de/…`. Each locale keeps its own route words (`uber-mich`/`about-me`,
`reiseziele`/`destinations`, `rundreisen`/`journeys`); the English map page at the root is
`/travel-map/` because the app owns `/map/*`. Single-language builds emit no route, link, feed,
`hreflang` or switcher entry for the absent locale. Path helpers live in `src/lib/paths.ts`;
reserved first segments and slug collisions in `src/lib/reserved-routes.ts` and
`src/lib/public-routes.ts`.

### Empty-install coverage

With no published stories, Home and Destinations keep their localized explanation
instead of a story grid or map teaser. Map explains where future published trips
will appear without mounting a map or an empty destination list. Empty regions
are neither generated nor linked; RSS remains a valid empty channel and the
sitemap lists only the generated public pages. These rules follow all four
supported primary/enabled-language configurations.

`TEST_DATABASE_URL=<test database> npm test` also runs
`test/empty-build.integration.test.ts`: it creates a private schema, runs the real
migrations and Astro builds in each language mode, and checks the emitted HTML,
RSS and sitemap. It removes only its own schema and temporary build/cache output.
The database role needs schema-creation permission; without `TEST_DATABASE_URL`
this integration suite is skipped. CI supplies it. Existing populated-page
rendering tests continue to cover map pins, fallback links and locale navigation.

## Structure

- `src/content/trips/{de,en}/<slug>.mdx` — authoring reference / backup (two sample stubs); the `id`s (`de/<slug>`, `en/<slug>`) and filenames are the live WordPress slugs (SEO contract — never rename). `heroImage` is a remote URL object `{src,width,height,alt}` served by the image server (no binaries in git).
- `src/content.config.ts` — Zod schemas and Postgres-backed loaders for `trips`, `pages`, `journeys` and `navigation`.
- `src/i18n/ui.ts` — ALL UI strings, both locales (completeness-tested; no hardcoded strings in components). It also holds the admin copy used by `../uploader/public/`.
- `src/lib/` — tested helpers: `postgres-loader`, `pages-loader`, `journeys-loader`, `navigation-loader` (Content Layer loaders), `build-language`/`site-language`/`build-identity`, `paths`/`trips`/`route-words`/`reserved-routes`/`public-routes` (live WP slugs, locale pairing, the one route inventory), `resolve-navigation` (header/footer/legal links resolved against emitted pages), `format`, `images`, `map-data`, and `body-images` (renders body images as responsive `<picture>` **and sanitizes the DB-sourced HTML** — see [`../SECURITY.md`](../SECURITY.md))
- `src/pages/[...path].astro` — the single dynamic route that renders every public page from `publicRoutes(...)`: home, About, Contact/Privacy/Legal pages, map, destinations/regions, stories, journeys; `src/pages/[...locale]/rss.xml.ts` emits each enabled locale's feed. There are no per-locale page files.
- `src/components/pages/` — shared per-page components rendered by that route
