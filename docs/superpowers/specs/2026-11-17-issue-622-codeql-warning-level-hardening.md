# Issue 622: CodeQL production warning-level hardening

Status: design revision 1, awaiting independent AI review under the scoped exception below
(see *Approval record*). Risk: **high** (authentication routes and their limiters are
adjacent, the backup download route, the WXR importer, a new runtime dependency).

Parent: [#622](https://github.com/laboef1900/wanderlust-studio/issues/622). Children:
[#609](https://github.com/laboef1900/wanderlust-studio/issues/609) (alert 5),
[#620](https://github.com/laboef1900/wanderlust-studio/issues/620) (alerts 31, 32),
[#613](https://github.com/laboef1900/wanderlust-studio/issues/613) (alerts 13, 14, 15, 16),
[#619](https://github.com/laboef1900/wanderlust-studio/issues/619) (alerts 27, 28, 29, 30).
None has sub-issues or comments. #621 and #623 are sibling epics, both merged into `dev`
before this branch was cut; they are prerequisites already in the base, not scope.

## Outcome and scope

Remove the eleven `warning`-level CodeQL findings in production code. Three of the four
changes are behavior-preserving for every input the application produces today. The fourth
(#619) deliberately adds two request ceilings where there were none, and one runtime
dependency to enforce them.

Out of scope: any change to the login, setup and password-change limiters or their order
of checks; the comment limiters; dismissing alerts; CodeQL configuration, query filters or
suppression comments; schema, data, slug, route path or `/data` layout changes; `site/`.

## Trust boundaries and misuse cases

| Surface | Caller | Untrusted input | Misuse the change must stop or bound |
|---|---|---|---|
| WXR import → `inlineImage` | admin session, hostile export file | lightbox `href` and title | a backslash, `<` or `>` in the URL ending the Markdown image destination early and turning the rest into markup |
| `console.error` in route and error handlers | author session; any client for the error handler | translation key, bulk action, request method and URL, storage key | request text being interpreted as a `util.format` directive and swallowing or reshaping the logged error |
| Editor hero preview (`sync`) | author's own browser | the stored hero URL held in a hidden input | a stored URL with a scheme other than http(s) being loaded by the preview images |
| Settings image preview | admin's own browser | a file the admin picked | none in a conforming browser; the object URL is asserted to be a `blob:` URL |
| `GET /backups/:name` | admin session | request rate | unbounded repeated opening and streaming of dump and archive files |
| GPX plugin (`/gpx/imports*`, `/posts/:tk/route*`) | anyone who can reach the app | request rate | unbounded session lookups and upload admissions from one address |

All findings are defense in depth. None is a known exploitable hole: every surface but the
GPX session check sits behind an authenticated session, an `<img>` does not execute a
`javascript:` URL, and `/login` and `/users/me/password` are already rate-limited by the
in-house limiters that CodeQL does not model.

## What the analysis credits

Read from the CodeQL JavaScript libraries and query tests, and checked against a scan of a
throwaway branch (*Recognition evidence* below):

- `js/missing-rate-limiting` credits a route when a recognized limiter precedes it in the
  routing tree: `server.register(<import of '@fastify/rate-limit'>)` ahead of the route
  (including routes installed by a function called later with the same server), or a
  shorthand route whose options object carries `config.rateLimit`. `addHook` handlers can
  only be credited by a preceding registration. In-house limiters are never credited.
- `js/xss-through-dom` treats any write to a DOM `src` property as a sink and stops at a
  test of the written string against a fully anchored regular expression without wildcard
  terms. A check on a parsed `URL` object's `protocol` is not credited.
- `js/tainted-format-string` flags a non-constant first argument of `console.*` when further
  arguments follow.
- `js/incomplete-sanitization` flags a global backslash-prefixing `replace` whose character
  class omits the backslash.

## Design

### Recognition evidence

A throwaway branch (`spike/issue-622-codeql-recognition`, commit
`2e9da15c87ea50fcee003e70330282a60a9b5ff4`, `origin/dev` plus the constructs of D1 to D4
without tests or the lockfile) was scanned by this repository's own workflow, dispatched
manually ([run 44149389667](https://github.com/laboef1900/wanderlust-studio/actions/runs/44149389667),
CodeQL 2.27.4, analysis 2189059714): **0 results**, against 11 on `dev` at `4034939`. All
eleven alerts clear and nothing new is reported. The branch is deleted before handoff.

### D1. #609, alert 5: complete escaping of the inline image destination

`inlineImage` (`uploader/src/wp-content.ts`) builds `![alt](dest)`. The destination becomes:

```ts
const dest = /\s/.test(href)
  ? `<${href.replace(/[\\<>]/g, '\\$&')}>`
  : href.replace(/[\\()]/g, '\\$&');
```

- Bare form: backslash joins the parentheses in the escaped set. CommonMark reads `\\` in a
  destination as one literal backslash, so the parsed URL equals `href`.
- Angle form: `\`, `<` and `>` are escaped; an unescaped `>` would close the destination.
  Not flagged, but it is the same incompleteness one branch away.
- `alt` already escapes the backslash and is unchanged. `lineSafe` has already removed line
  breaks from both fields.

For every `href` without a backslash (and, in the angle form, without `<` or `>`) the output
is byte-identical. `markdownImages`, the re-host pass, already unescapes ASCII punctuation
including the backslash, so it yields the original `href` in all cases.

### D2. #620, alerts 31 and 32: constant format strings

Every `console.*` call in `uploader/src` whose first argument is a template literal with an
interpolation **and** that passes further arguments gets a constant format string with the
values as `%s` arguments:

| File | Call | Becomes |
|---|---|---|
| `posts-routes.ts` (2 sites) | `` `MDX backup for ${tk} failed:`, e `` | `'MDX backup for %s failed:', tk, e` |
| `posts-routes.ts` | `` `bulk ${action} failed for ${tk}:`, e `` | `'bulk %s failed for %s:', action, tk, e` |
| `server.ts` (error handler) | `` `unhandled error on ${req.method} ${req.url}:`, err `` | `'unhandled error on %s %s:', req.method, req.url, err` |
| `media-routes.ts` | `` `could not roll back status for ${key}:`, err `` | `'could not roll back status for %s:', key, err` |
| `backup.ts` | `` `could not remove stale backup temp file ${name}:`, e `` | `'could not remove stale backup temp file %s:', name, e` |

Only the three `posts-routes.ts` sites are flagged. The other three are the same defect; the
error handler's is the only one reachable without a session, so fixing the flagged sites
alone would leave the worst instance. For string values without `%` the printed line is
identical (`%s` prints a string as is; the error is still appended after one space).

### D3. #613, alerts 13 to 16: only expected URL schemes reach `src`

**Editor hero preview** (`uploader/public/editor.html`, `sync(locale)`): the thumbnail URL
computed by `PostsFilter.thumbUrl` from the hidden `…HeroSrc` input is tested before use:

```js
var HERO_PREVIEW_URL = /^https?:\/\/[\w.~:\/?#\[\]@!$&'()*+,;=%\-\u00a1-\uffff]+$/i;
…
if (!url || !HERO_PREVIEW_URL.test(url)) { /* existing "no hero" branch, unchanged */ }
```

- Accepts absolute `http:`/`https:` URLs made of RFC 3986 characters plus non-ASCII. Rejects
  every other scheme, relative references, whitespace, quotes, `<`, `>`, backslash and
  control characters.
- A rejected URL takes the existing branch for "no thumbnail": previews hidden, `src`
  removed. No new state, copy, element or style.
- The server only ever mints `PUBLIC_BASE_URL + '/' + key` with keys limited to
  `a-z 0-9 / _ -`, and a URL from elsewhere (an un-rehosted import) has no `-640.webp`
  variant and is hidden by `onerror` today. So no hero that previews today stops previewing.
- The guard sits in `sync`, not in `thumbUrl`: `thumbUrl` has five other callers and its
  contract and tests stay untouched.

**Settings image preview** (`uploader/public/settings.html`): the two object URLs are held
in named constants, and the one made from the picked file is asserted before it is assigned:

```js
const originalUrl = URL.createObjectURL(file);
const encodedUrl = URL.createObjectURL(encoded);
previewUrls = [originalUrl, encodedUrl];
if (!/^blob:[\w.~:\/?#\[\]@!$&'()*+,;=%\-]+$/.test(originalUrl)) { /* clearPreview(), existing failure text */ return; }
```

`createObjectURL` returns a `blob:` URL in every conforming browser, so the branch is not
expected to run; it makes the invariant explicit and is the form the analysis credits. On
failure the URLs are revoked through the existing `clearPreview()` and the existing generic
preview-failure message is shown.

This is interface code with no visual, copy, layout or interaction change, so no design
pass applies; the implementer still follows the existing hidden-state and message patterns.

### D4. #619, alerts 27 to 30: `@fastify/rate-limit` for two new ceilings

**Dependency.** `@fastify/rate-limit` `^11.2.2` (MIT, the Fastify organization's plugin,
peer `fastify 5.x`; brings `@lukeed/ms`, `ip-address`, `toad-cache` and `fastify-plugin`).
The uploader lockfile and `docs/third-party-inventory.json` are regenerated; the evidence
file is extended only if the generator or `legal-assets.test.ts` requires it.

Why a dependency at all: the GPX finding is on an `addHook('onRequest')` handler, which
only a preceding plugin registration can clear. The alternatives were rejected: moving the
session check into per-route options hides it from the analysis and gives up the
plugin-scope guarantee that every GPX route is authenticated; a custom CodeQL model or
query filter changes the guardrail; dismissal is the owner's call, not this change's.

**Registration.** `buildServer` registers the plugin once on the root instance, before any
route or route plugin:

```ts
app.register(rateLimit, {
  global: false,
  addHeaders: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
  addHeadersOnExceeding: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
  errorResponseBuilder: (_req, context) => Object.assign(new Error('too many requests, please wait and try again'), { statusCode: context.statusCode }),
});
```

- `global: false`: no route is limited unless it opts in. Nothing changes for the blog, the
  image host, the basemap, static admin pages or any other route.
- Allowed responses gain no header. A refusal carries `Retry-After` only.
- Store: the plugin's in-memory LRU (5000 keys), key `req.ip` (IPv6 grouped by /64), so the
  trusted-proxy rules for `req.ip` apply unchanged. One process, like the in-house limiters.
- Child plugin scopes loaded after it inherit its `onRoute` hook and its `rateLimit`
  decorator. Root routes declared synchronously do not; none of them uses it.

**GPX plugin** (`gpx-routes.ts`): a limiter hook is added to the plugin scope in front of
the existing session-and-origin hook:

```ts
routes.addHook('onRequest', routes.rateLimit({ ...GPX_RATE_LIMIT, errorResponseBuilder: () => new GpxError('gpx_busy', 429) }));
```

- `GPX_RATE_LIMIT = { max: 300, timeWindow: 60_000 }` per address, shared by all GPX routes.
  An editor session issues a handful of GPX requests per action; 300 a minute is an abuse
  ceiling, not a throttle.
- It runs before the session lookup, so it bounds exactly the work the finding names, for
  anonymous and signed-in callers alike, and before any body is read.
- A refusal is the existing `gpx_busy` 429 through the plugin's error handler
  (`cache-control: no-store`), which the editor already shows as "busy, try again".
- `registerGpxRoutes` now requires the plugin on the instance it is given; this is stated
  in its doc comment, and the one test that mounts it on a bare instance registers it.

**Backup download** (`backup-import-routes.ts`): `GET /backups/:name` moves, body unchanged,
into a child scope so the per-route option takes effect:

```ts
app.register(async (scope) => {
  scope.get<{ Params: { name: string } }>('/backups/:name', {
    config: { rateLimit: { ...BACKUP_DOWNLOAD_RATE_LIMIT, hook: 'preHandler' } },
    preHandler: requireAdmin,
  }, handler);
});
```

- `BACKUP_DOWNLOAD_RATE_LIMIT = { max: 30, timeWindow: 60_000 }` per address.
- `hook: 'preHandler'` appends the limiter after `requireAdmin`: anonymous and non-admin
  requests get the same 401/403 as today and never consume the budget, so nobody without an
  admin session can exhaust it for the admin.
- A refusal is `429 {"error":"too many requests, please wait and try again"}` through the
  root error handler, with `Retry-After`. (While storage is read-only that handler answers
  every error, this one included, with its read-only reply. Unchanged behavior.)
- The child scope inherits the root hooks, decorators and error handler; the route path,
  guards, headers and handler are otherwise identical. Fastify's implicit `HEAD` twin gets
  its own bucket of the same size.

Both constants live in `uploader/src/rate-limit.ts` next to the in-house limiters.

**`POST /login` and `POST /users/me/password`** are not edited. They stay limited by
`limitAuth`, `accountLimiter` and `passwordLimiter`, whose order of checks is pinned by
tests. The analysis credits them because the root registration precedes
`registerAuthRoutes`; the registration comment says that it must stay ahead of route
registration for both reasons (child scopes, and the analysis).

## Preservation invariants

1. D1 to D3: for every value the application produces today, output is byte-identical
   (Markdown, log lines, DOM state). The exceptions are exactly the hostile inputs named in
   each section.
2. `/login`, `/setup`, `/users/me/password`, `/comments`: code, limiter instances, budgets,
   order of checks, statuses and bodies unchanged. Their existing tests are not edited.
3. Within the new budgets, every GPX and backup-download response is byte-identical to
   today's, headers included.
4. `GET /backups/:name` keeps `requireAdmin` first, the three filename patterns,
   `backupFilePath`, `O_NOFOLLOW`, the regular-file and `nlink` checks and its error mapping.
5. Every GPX route stays behind the plugin-scope session-and-origin hook.
6. No route path, slug, schema, stored data or `/data` layout changes. No suppression
   comment, no CodeQL configuration change, no alert dismissal.
7. Patterns the scanners flag are not copied into tests.

## Failure handling

- D1, D2: pure string changes; no new failure path.
- D3: a rejected hero URL is the existing "no thumbnail" state; a rejected object URL is the
  existing preview-failure state with both URLs revoked.
- D4: the store is in-process memory and cannot fail independently. A plugin that fails to
  load fails the boot loudly. A refused request has done no work: the GPX refusal precedes
  the session lookup and body parsing; the download refusal precedes opening the file.

## Tests

Added to the existing suites, asserting results rather than wiring:

- D1 (`test/wp-content.test.ts`): a degraded lightbox anchor whose `href` contains a
  backslash, `\)`, a trailing backslash, and (with whitespace) `<`, `>` and a backslash;
  each asserts the produced Markdown and that `markdownImages` returns the original URL.
  Existing cases stay green unedited.
- D2: for each call path that a test can reach (MDX backup failure on save, bulk action
  failure, the error handler), a value containing a format directive (`%s`, `%o`, `%%`) is
  logged verbatim and the error object is still passed; asserted on what `console.error`
  would print, not on the argument list.
- D3 (DOM suites): hero preview shows for an `https:` and an `http:` hero and is hidden with
  `src` removed for `javascript:`, `data:`, a relative path and a URL with a space or quote;
  the settings preview still shows both panes for a picked file.
- D4 (`test/server.test.ts`, GPX suite): GPX — 300 requests from one address pass the
  limiter (anonymous ones answer 401), the next is `429 gpx_busy` with `Retry-After` and
  `no-store`, a signed-in request from that address is refused too, another address is
  unaffected, allowed responses carry no `x-ratelimit-*` header. Backup download — 30 admin
  requests answer as today, the 31st is 429 with the body above; anonymous and non-admin
  requests never consume the budget; `GET /backups` and `POST /backups` are unaffected.
  The budgets are imported from `rate-limit.ts`, not repeated.

## Verification

- Uploader: `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` against a disposable
  Postgres 18 on an isolated port, `npm run test:e2e` (real Chromium).
- Live check of the integration build on an isolated port with a disposable database and
  data directory: sign-in and its limiter, a backup download and its ceiling, the GPX
  ceiling, the editor hero preview and the settings preview in a real browser, console and
  network clean.
- Site: unchanged; `npm test` and `npx astro check` run in CI as required checks.
- CodeQL: the workflow is dispatched on the integration branch; the scan of the final head
  must report none of alerts 5, 13 to 16 and 27 to 32 and no new result. The alerts
  themselves close only when `dev` is rescanned after merge.
- Dependency review on the pull request passes for the new packages.
- Required checks on the final head: `site · tests + astro check`,
  `uploader · typecheck + tests`.

## Work breakdown and dependencies

| Task | Issue | Files | Depends on |
|---|---|---|---|
| T1 | #609 | `uploader/src/wp-content.ts`, `test/wp-content.test.ts` | approval |
| T2 | #620 | `uploader/src/posts-routes.ts`, `media-routes.ts`, `backup.ts`, `server.ts` (error handler line), their tests | approval |
| T3 | #613 | `uploader/public/editor.html`, `settings.html`, DOM tests | approval |
| T4 | #619 | `uploader/package.json`, lockfile, `src/rate-limit.ts`, `server.ts` (registration), `gpx-routes.ts`, `backup-import-routes.ts`, tests, `docs/third-party-inventory.json` | approval, T2 integrated |
| T5 | all | integration, `SECURITY.md`, `ARCHITECTURE.md`, `docs/claude/project-status.md`, this spec | T1 to T4 |

T1, T2 and T3 are independent and run in parallel in separate worktrees. T4 shares
`server.ts` and `test/server.test.ts` with T2, so it starts from a revision that contains
T2. Integration order: T1, T2, T3, T4.

## Recovery and containment

No data, schema or configuration is touched, so recovery is a reviewed revert of the pull
request, or redeploying the previous image tag; nothing on `/data` or in Postgres needs
repair. If a ceiling proves too low in production, the counters live in process memory:
they reset after one minute, and `docker compose restart app` clears them immediately.

## Requirement exception: AI design approval for this epic

| | |
|---|---|
| **Waived rule** | `CLAUDE.md` *Change Risk and Required Rigor*: high-risk changes need "explicit human approval". Waived for the **design gate only**. |
| **Scope** | `laboef1900/wanderlust-studio` issues #622, #609, #613, #619, #620. |
| **Reason** | The owner asked for autonomous delivery through unmerged pull requests and authorized replacing the human design pause with independent AI approval. |
| **Risk** | A design flaw a human reviewer would have caught proceeds to implementation. |
| **Compensating controls** | Independent strong-reasoning reviewer that did not author the design; a CodeQL scan of a throwaway branch before approval and of the final head after; preservation invariants; full suites plus integration and browser tests; independent review of the integrated diff; the pull request stays unmerged, so the owner's merge decision remains the human security decision. |
| **Approver** | Simon (owner), in the 2026-11-17 task brief for #622. |
| **Expiry** | At final pull-request handoff or abandonment. Human approval before merge is not waived. |

## Approval record
