# Issue 622: CodeQL production warning-level hardening

Status: design revision 3, approved 2026-11-17 by independent AI review under the scoped
exception below (see *Approval record*). Risk: **high** (the login, setup and
password-change routes move into a child plugin scope, the backup download route, the WXR
importer and its image scan, a new runtime dependency).

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
(#619) deliberately adds two request ceilings where there were none, one runtime
dependency to enforce them, and moves three already-limited routes into a plugin scope
without changing their code.

Out of scope: any change to the login, setup and password-change limiters, their handlers
or their order of checks; the comment limiters; dismissing alerts; CodeQL configuration,
query filters or suppression comments; schema, data, slug, route path or `/data` layout
changes; `site/`.

## Trust boundaries and misuse cases

| Surface | Caller | Untrusted input | Misuse the change must stop or bound |
|---|---|---|---|
| WXR import → `inlineImage` | admin session, hostile export file | lightbox `href` and title | a backslash, `<` or `>` in the URL ending the Markdown image destination early, or keeping the image scan from seeing the photo |
| `console.error` in route and error handlers | author session; any client for the error handler | translation key, bulk action, request method and URL, storage key | request text being interpreted as a `util.format` directive and swallowing or reshaping the logged error |
| Editor hero preview (`sync`) | author's own browser | the stored hero URL held in a hidden input | a stored URL with a scheme other than http(s) being loaded by the preview images |
| Settings image preview | admin's own browser | a file the admin picked | none in a conforming browser; the object URL is asserted to be a `blob:` URL |
| `GET /backups/:name` | admin session | request rate | unbounded repeated opening and streaming of dump and archive files |
| GPX plugin (`/gpx/imports*`, `/posts/:tk/route*`) | anyone who can reach the app | request rate | unbounded session lookups and upload admissions from one address. Residual: callers that share an address (or an IPv6 /64) share the budget, so an anonymous flood from the author's own network can hold GPX editing at "busy"; the same exposure `/login` already has |

All findings are defense in depth. None is a known exploitable hole: every surface but the
GPX session check sits behind an authenticated session, an `<img>` does not execute a
`javascript:` URL, and `/login` and `/users/me/password` are already rate-limited by the
in-house limiters that CodeQL does not model.

## What the analysis credits

Read from the CodeQL JavaScript libraries and query tests, and checked against a scan of a
throwaway branch (*Recognition evidence* below):

- `js/missing-rate-limiting` credits a route when a recognized limiter precedes it in the
  routing tree: `server.register(<import of '@fastify/rate-limit'>)` ahead of the route, or
  a shorthand route whose options object carries `config.rateLimit`. `addHook` handlers can
  only be credited by a preceding registration. In-house limiters are never credited.
- The registration is credited whatever its options are, and for everything installed
  after it in source order: on the same instance, in functions called later, and, because
  the model does not know that Fastify plugins are encapsulated, on the parent instance
  after a child scope that contains it. A registration on the root instance, or in a scope
  registered early, would therefore credit unlimited routes and switch the query off for
  them. This design registers the plugin only inside scopes in which every route really is
  limited, and registers those scopes after every other route (D4).
- `js/xss-through-dom` treats any write to a DOM `src` property as a sink and stops at a
  test of the written string against a fully anchored regular expression without wildcard
  terms. A check on a parsed `URL` object's `protocol` is not credited.
- `js/tainted-format-string` flags a non-constant first argument of `console.*` when further
  arguments follow.
- `js/incomplete-sanitization` flags a global backslash-prefixing `replace` whose character
  class omits the backslash.

## Design

### Recognition evidence

Three scans of a throwaway branch (`spike/issue-622-codeql-recognition`, `origin/dev` plus
the constructs below without tests or the lockfile) by this repository's own workflow,
dispatched manually, CodeQL 2.27.4. `dev` at `4034939` has 11 results.

| Scan | Constructs | Result |
|---|---|---|
| 1, commit `2e9da15c87ea50fcee003e70330282a60a9b5ff4`, [run 44149389667](https://github.com/laboef1900/wanderlust-studio/actions/runs/44149389667), analysis 2189059714 | revision 1: one registration on the root instance | 0 results. `/login` and `/users/me/password` are credited although the plugin limits neither. |
| 2, commit `d8dc6d3cd0dd5d94402c417549f17af7321f8756`, [run 44153055019](https://github.com/laboef1900/wanderlust-studio/actions/runs/44153055019), analysis 2189226893 | three scoped registrations in their original places, plus a canary (a deliberately unlimited file-opening route on the root instance) declared after them | 0 results. The canary is not reported: a scope's registration also credits what follows the scope. |
| 3, commit `7d4e0ed2d44383c831633d44efaf044d6d03a6c7`, [run 44153989678](https://github.com/laboef1900/wanderlust-studio/actions/runs/44153989678), analysis 2189271263 | D4 as designed here: the three scopes registered after every other route, the canary before them | 1 result: `js/missing-rate-limiting` on the canary. All eleven alerts clear and the query still reports an unlimited route. |

The canary is not part of the implementation. The branch is deleted before handoff.

### D1. #609, alert 5: complete escaping of the inline image destination

`inlineImage` (`uploader/src/wp-content.ts`) builds `![alt](dest)`. The destination becomes:

```ts
const dest = /[\s<>]/.test(href)
  ? `<${href.replace(/[\\<>]/g, '\\$&')}>`
  : href.replace(/[\\()]/g, '\\$&');
```

- Bare form: backslash joins the parentheses in the escaped set. CommonMark reads `\\` in a
  destination as one literal backslash, so the parsed URL equals `href`.
- Angle form: now also chosen when `href` contains `<` or `>` (a bare destination may not
  start with `<`), and `\`, `<` and `>` are escaped inside it; an unescaped `>` would close
  the destination. Not flagged, but the same incompleteness one branch away.
- `alt` already escapes the backslash and is unchanged. `lineSafe` has already removed line
  breaks from both fields.

The image scan must read the new form back. `IMAGE_RE` (same file, used by
`markdownImages`) only accepts `<[^<>\n]*>` as an angle destination, so an escaped `\<` or
`\>` is not an image to it today, while CommonMark renderers show one. Two changes to the
destination part of the pattern, nothing else:

- the angle branch becomes `<((?:\\.|[^<>\\\n])*)>` (backslash escapes accepted; the two
  alternatives are disjoint, so matching stays linear);
- the bare branch is prefixed with `(?!<)`: CommonMark does not allow a bare destination to
  start with `<`, and without this an angle destination the first branch rejects would be
  read by the second as a URL with literal brackets.

The existing unescape step already handles the result.

- For every `href` without a backslash, `<` or `>` the produced Markdown is byte-identical.
- `markdownImages` returns the original `href` for every output of `inlineImage`, and for
  Turndown's own escaped angle destinations, which it misses today.
- Every reading of existing text that changes moves to CommonMark's reading, or to "not an
  image" where the text falls outside the pattern's Turndown-restricted title grammar (one
  case in 71,027 changed readings of the reviewer's run). The classes:
  an escaped `<` or `>` inside an angle destination is now part of the URL; an angle
  destination whose closing bracket is escaped is no longer an image; a bare destination
  starting with `<` is no longer an image. Neither the importer nor Turndown produces the
  last two; they can only occur in hand-written bodies.
- Callers whose input set changes accordingly: the WXR re-host scan and its pre-flight
  count, the export's body-image pass, the alt audit and media-sync's alt backfill.

### D2. #620, alerts 31 and 32: constant format strings

Every `console.*` call in `uploader/src` whose first argument is a template literal with an
interpolation **and** that passes further arguments gets a constant format string with the
values as `%s` arguments:

| File | Call | Becomes |
|---|---|---|
| `posts-routes.ts` (2 sites: publish, bulk publish) | `` `MDX backup for ${tk} failed:`, e `` | `'MDX backup for %s failed:', tk, e` |
| `posts-routes.ts` | `` `bulk ${action} failed for ${tk}:`, e `` | `'bulk %s failed for %s:', action, tk, e` |
| `server.ts` (error handler) | `` `unhandled error on ${req.method} ${req.url}:`, err `` | `'unhandled error on %s %s:', req.method, req.url, err` |
| `media-routes.ts` | `` `could not roll back status for ${key}:`, err `` | `'could not roll back status for %s:', key, err` |
| `backup.ts` | `` `could not remove stale backup temp file ${name}:`, e `` | `'could not remove stale backup temp file %s:', name, e` |
| `build.ts` | `` `site build ${attemptId} ${…}`, cause `` | `'site build %s %s', attemptId, <the same status text>, cause` |

Only the three `posts-routes.ts` sites are flagged. The others are the same construct. The
error handler's is a live defect and the only one reachable without a session: a request
for `/posts/m%c3%a4rz` that fails is logged today as `unhandled error on GET /posts/m3%a4rz:`
with the error and its stack consumed by `%c`. The `build.ts` values are internal; it is
changed so the rule has no exception. For string values without `%` the printed line is
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
  every other scheme, relative references, whitespace, double quotes, `<`, `>`, backslash and
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

`createObjectURL` returns a `blob:` URL in every conforming browser (`blob:<origin>/<uuid>`,
`blob:null/<uuid>`), so the branch is not expected to run; it makes the invariant explicit
and is the form the analysis credits. On failure: `clearPreview()` (revokes both URLs, hides
both panes and the result, removes both `src`), then
`$('previewOut').textContent = refusal('generate the preview')`, which reads
"Could not generate the preview." and is the handler's existing refusal wording.

This is interface code with no visual, copy, layout or interaction change, so no design
pass applies; the implementer still follows the existing hidden-state and message patterns.

### D4. #619, alerts 27 to 30: `@fastify/rate-limit`, registered only where routes are limited

**Dependency.** `@fastify/rate-limit` `^11.2.2` (MIT, the Fastify organization's plugin; it
declares no peer dependency and checks `fastify 5.x` at load). Of its four dependencies
only `ip-address` (MIT, no dependencies) is new to the uploader lockfile; `@lukeed/ms`,
`fastify-plugin` and `toad-cache` are already there through Fastify. The lockfile and
`docs/third-party-inventory.json` are regenerated.

Why a dependency at all: the GPX finding is on an `addHook('onRequest')` handler, which only
a preceding plugin registration can clear. The alternatives were rejected: moving the
session check into per-route options gives up the scope-wide guarantee that every GPX route
is authenticated; a custom CodeQL model or query filter changes the guardrail; dismissal is
the owner's call, not this change's.

**Shared options** (`RATE_LIMIT_PLUGIN_OPTIONS`, exported from `uploader/src/rate-limit.ts`
with the two budgets below):

```ts
{
  global: false,
  addHeaders: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
  addHeadersOnExceeding: { 'x-ratelimit-limit': false, 'x-ratelimit-remaining': false, 'x-ratelimit-reset': false },
  errorResponseBuilder: (_req, context) => Object.assign(new Error('too many requests, please wait and try again'), { statusCode: context.statusCode }),
}
```

- `global: false`: a registration limits nothing by itself.
- Allowed responses gain no header. A refusal carries `Retry-After` only.
- Stores are the plugin's in-memory LRUs, 5000 keys each (one per limiter: the GPX hook, the
  download route and its `HEAD` twin), keyed on `req.ip` with IPv6 grouped by /64. The
  trusted-proxy rules for `req.ip` apply unchanged. One process, like the in-house limiters.

The plugin is **not** registered on the root instance. It is registered in exactly three
child scopes, and in each of them every route is rate-limited by construction, so what the
analysis credits inside them is true. Because the credit also reaches whatever is declared
after a scope, `buildServer` registers the three scopes in one block after every other
route and route plugin, directly before `setNotFoundHandler`:

```ts
// Rate-limited scopes, last on purpose (see SECURITY.md, Rate limiting).
registerLimitedAuthRoutes(ctx);
registerBackupDownloadRoute(ctx);
if (cfg.gpx) registerGpxRoutes(app, { gpx: cfg.gpx, requireAuth });
```

Fastify matches routes independently of declaration order and each scope is created during
boot, after all synchronous statements of `buildServer`, so moving these three
registrations changes neither matching nor what the scopes inherit. The remaining limit of
the approach is stated plainly in the block's comment and in `SECURITY.md`: a route declared
after this block would be credited by the analysis without being limited, so the block
stays last.

**1. GPX plugin** (`gpx-routes.ts`). Inside the existing plugin body, after the error
handler and in front of the existing session-and-origin hook:

```ts
await routes.register(rateLimit, RATE_LIMIT_PLUGIN_OPTIONS);
routes.addHook('onRequest', routes.rateLimit({ ...GPX_RATE_LIMIT, errorResponseBuilder: () => new GpxError('gpx_busy', 429) }));
```

- `GPX_RATE_LIMIT = { max: 300, timeWindow: 60_000 }` per address, shared by all GPX routes.
  An editor session issues a handful of GPX requests per action; 300 a minute is an abuse
  ceiling, not a throttle.
- It runs before the session lookup and before any body is read, so it bounds exactly the
  work the finding names, for anonymous and signed-in callers alike. That is deliberate and
  has the residual named in the trust table.
- A refusal is the existing `gpx_busy` 429 through the plugin's error handler
  (`cache-control: no-store`), which the editor already shows as "busy, try again".
- Every route of the scope passes the scope hook, so every credited route is limited.
  `registerGpxRoutes` stays self-contained; its doc comment notes that the scope hook marks
  the request as limited, so a per-route `config.rateLimit` added later in this scope would
  be skipped by the plugin.

**2. Backup download** (`backup-import-routes.ts`). `GET /backups/:name` moves, handler
unchanged, out of `registerBackupAndImportRoutes` into a new exported
`registerBackupDownloadRoute(ctx)`, which declares it in a child scope of its own:

```ts
app.register(async (scope) => {
  await scope.register(rateLimit, RATE_LIMIT_PLUGIN_OPTIONS);
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
- Fastify's implicit `HEAD` twin is limited too, with its own bucket: at most 30 `GET` plus
  30 `HEAD` file opens per address per minute. The separate buckets depend on
  `preHandler: requireAdmin` staying a function: written as an array, Fastify's shallow copy
  of the options for the twin would make both limiters share it.
- The scope carries the same kind of guard as the login scope:
  `scope.addHook('onRoute', requireRouteLimiter((route) => route.config?.rateLimit != null && typeof route.config.rateLimit === 'object', 'config.rateLimit'))`,
  so a route without its own limit cannot be declared in it.

**3. Login, setup and password change** (`auth-routes.ts`). `POST /setup`, `POST /login` and
`POST /users/me/password` move, options and handlers unchanged and together with the setup
lock, out of `registerAuthRoutes` into a new exported `registerLimitedAuthRoutes(ctx)`,
which declares them in one child scope:

```ts
app.register(async (limited) => {
  await limited.register(rateLimit, RATE_LIMIT_PLUGIN_OPTIONS);
  limited.addHook('onRoute', requireRouteLimiter((route) => [route.preHandler].flat().includes(limitAuth), 'limitAuth'));
  limited.post('/setup', { preHandler: limitAuth }, …);
  limited.post('/login', { preHandler: limitAuth }, …);
  limited.post('/users/me/password', { preHandler: [limitAuth, requireAuth] }, …);
});
```

- These routes stay limited by `limitAuth`, `accountLimiter` and `passwordLimiter` exactly
  as today; the plugin instance in this scope limits nothing. It is there because the
  analysis cannot model the in-house limiters: the registration is what makes it credit
  three routes that are limited. A code comment says exactly that.
- The `onRoute` guard makes the credit true by construction: a route can only be declared in
  this scope if it carries `limitAuth`; anything else fails the boot. `requireRouteLimiter`
  is a small hook factory exported from `rate-limit.ts`: it takes a predicate over the route
  options and a label, and returns an `onRoute` hook that throws
  `<method> <url> must be rate-limited (<label>)` when the predicate fails.
- The other routes of the file (`/login` page, `/auth/*`, `/logout`, `/users*`) stay in
  `registerAuthRoutes` on the root instance, before the block, and are not credited.

A child scope is created when the boot sequence reaches it, after every synchronous
statement of `buildServer` has run and after the plugins registered before it have loaded.
It therefore inherits the root hooks (including both `onSend` hooks), the error handler,
the not-found handler, the request decorator, the cookie and multipart plugins and the
content-type parsers. Route paths, guards and handlers are otherwise identical.

**No silent no-op.** On the root instance a per-route `config.rateLimit` would be ignored by
the plugin and still credited by the analysis. `buildServer` adds, before any route, an
`onRoute` hook that throws when a route declares `config.rateLimit` on an instance without
the plugin's `rateLimit` decorator. A declared limit that is not enforced fails the boot.
The hook is a `function`, not an arrow function (it reads `this.hasDecorator`), and treats
`config.rateLimit: false`, the plugin's own "no limit" value, as not declaring one.

## Preservation invariants

1. D1 to D3: for every value the application produces today, output is byte-identical
   (Markdown, log lines, DOM state). The exceptions are exactly the hostile inputs named in
   each section.
2. `/login`, `/setup`, `/users/me/password`, `/comments`: handlers, route options, limiter
   instances, budgets, order of checks, statuses, bodies and headers unchanged. The first
   three are declared in a child scope instead of on the root instance; nothing else about
   them moves. Their existing tests are not edited and stay green.
3. Within the new budgets, every GPX and backup-download response is byte-identical to
   today's, headers included.
4. `GET /backups/:name` keeps `requireAdmin` first, the three filename patterns,
   `backupFilePath`, `O_NOFOLLOW`, the regular-file and `nlink` checks and its error mapping.
5. Every GPX route stays behind the plugin-scope session-and-origin hook.
6. No route path, slug, schema, stored data or `/data` layout changes. No suppression
   comment, no CodeQL configuration change, no alert dismissal. The analysis keeps reporting
   unlimited expensive routes declared before the block of rate-limited scopes, which is
   every other route (proved by scan 3).
7. Patterns the scanners flag are not copied into tests.

## Failure handling

- D1, D2: pure string changes; no new failure path.
- D3: a rejected hero URL is the existing "no thumbnail" state; a rejected object URL is the
  existing preview-failure state with both URLs revoked.
- D4: the stores are in-process memory and cannot fail independently. A plugin that fails
  to load, a route without `limitAuth` in the login scope, or a `config.rateLimit` declared
  outside a plugin scope fails the boot loudly. A refused request has done no work: the GPX
  refusal precedes the session lookup and body parsing; the download refusal precedes
  opening the file. The plugin's hook refuses by throwing, which Fastify routes to the error
  handler without running the handler, also with an asynchronous `onSend` hook present.

## Tests

Added to the existing suites, asserting results rather than wiring:

- D1 (`test/wp-content.test.ts`): a degraded lightbox anchor whose `href` contains a
  backslash, `\)`, a trailing backslash, a leading `<` without whitespace, and (with
  whitespace) `<`, `>` and a backslash; each asserts the produced Markdown and that
  `markdownImages` returns the original URL. `markdownImages` directly: a Turndown-style
  escaped angle destination is found (with and without whitespace); an angle destination
  with an escaped closing bracket and a bare destination starting with `<` are not images.
  Existing cases stay green unedited.
- D2: for each call path that a test can reach (MDX backup failure on publish, bulk action
  failure, the error handler), a value containing format directives is logged verbatim and
  the error is still printed; the error-handler case uses a failing request for a URL with
  lowercase percent-encoding such as `/posts/m%c3%a4rz`. Asserted on what `console.error`
  would print, not on the argument list.
- D3 (DOM suites): hero preview shows for an `https:` and an `http:` hero, for a base with a
  port, an IPv6 literal host, an IDN host and a trailing-slash base; it is hidden with `src`
  removed from all three images for `javascript:`, `data:`, a relative path and a URL with a
  space or double quote, including when a previewing hero is replaced by a rejected one. Settings:
  both panes still show for a picked file; with `createObjectURL` stubbed to return a
  non-`blob:` value, both URLs are revoked, both panes and the result are hidden with `src`
  removed, and the message above is shown.
- D4 (`test/server.test.ts`, GPX suite). GPX: 300 requests from one address pass the limiter
  (anonymous ones answer 401), the next is `429 gpx_busy` with `Retry-After`, `no-store` and
  no `x-ratelimit-*` header; a signed-in request from that address is refused too and the
  refused requests never reach the session store (counted); another address is unaffected;
  allowed responses carry no `x-ratelimit-*` header. Backup download: 30 admin requests
  answer as today, the 31st is 429 with the body above, `Retry-After` and no
  `x-ratelimit-*`; `HEAD` is limited with its own bucket; anonymous and non-admin requests
  never consume the budget; the root `onSend` headers are still present; `GET /backups` and
  `POST /backups` are unaffected; an unrelated authenticated route is not limited. Boot
  guards: `requireRouteLimiter` on a bare instance accepts a function and an array
  `preHandler` carrying the limiter and fails the boot for a route without it, for a nested
  child scope's route and for a route declared by a non-encapsulated plugin; a root route
  declaring `config.rateLimit` fails the boot. The budgets are imported from `rate-limit.ts`,
  not repeated. The existing login, setup and password-change tests are not edited; one new
  case pins what the three moved routes inherit from the root: with storage read-only each
  answers `503 storage_read_only` without the login limiter being consulted, and with
  storage writable each response carries `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`.

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
| T1 | #609 | `uploader/src/wp-content.ts` (`inlineImage`, `IMAGE_RE` and its comment), `test/wp-content.test.ts` | approval |
| T2 | #620 | `uploader/src/posts-routes.ts`, `media-routes.ts`, `backup.ts`, `build.ts`, `server.ts` (error handler line), their tests | approval |
| T3 | #613 | `uploader/public/editor.html`, `settings.html`, DOM tests | approval |
| T4 | #619 | `uploader/package.json`, lockfile, `src/rate-limit.ts`, `server.ts` (root `onRoute` guard, the block of rate-limited scopes), `gpx-routes.ts`, `backup-import-routes.ts`, `auth-routes.ts` (moving the three routes only), tests, `docs/third-party-inventory.json` | approval, T2 integrated |
| T5 | all | integration, `SECURITY.md` (rate limiting, the GPX residual, why the rate-limited scopes are registered last), `CLAUDE.md` (the block of rate-limited scopes joins the high-risk list), `ARCHITECTURE.md`, `docs/claude/project-status.md`, this spec; pull request body with `Closes #609`, `#613`, `#619`, `#620`, `#622` | T1 to T4 |

T1, T2 and T3 are independent and run in parallel in separate worktrees. T4 shares
`server.ts` and `test/server.test.ts` with T2, so it starts from a revision that contains
T2. Integrated in the order T2, T3, T1, T4 (the first three in the order they finished).

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

### Revision 1 (commit `36373201bc6efa8e5c614808d2d69979d0a9e49c`): changes required

Reviewer: independent Orca worker, OMP, `anthropic/claude-opus-5-5`, launched at effort
`high` (Orca dispatch `ctx_1f9ff124b84c`; the reviewer's harness does not display the level
to it). The reviewer did not author the design. The first-choice reviewer,
`openai-codex/gpt-6.1-sol` at `high` (dispatch `ctx_7ff9111d29a8`), could not run: the
provider's usage limit was exhausted.

The reviewer read the source, the CodeQL models and the plugin, re-queried the first scan,
and ran its own experiments against Fastify 5.12.8, the packed plugin and three Markdown
parsers.

| Finding | Severity | Disposition |
|---|---|---|
| B1: `markdownImages` does not read back the new escaped angle form, so the photo would render but never be re-hosted | blocking | Accepted. `IMAGE_RE`'s angle branch accepts backslash escapes; the one changed reading and the affected callers are stated in D1; tests in both directions. |
| B2: a root registration credits every uploader route, limited or not | blocking | Accepted, option (a), and taken further. No root registration; three scopes in which every route is limited by construction. Scan 2 showed that scoping alone is not enough (a scope also credits what follows it), so the scopes are registered after every other route; scan 3 proves the query still reports an unlimited route. |
| N1: a bare destination starting with `<` is not an image | non-blocking | Accepted. The angle form is chosen for any `href` containing whitespace, `<` or `>`. |
| N2: anonymous callers can exhaust a signed-in author's GPX budget | non-blocking | Accepted as a recorded residual (trust table, `SECURITY.md`); the test counts session lookups. |
| N3: `config.rateLimit` on a root route is a credited no-op | non-blocking | Accepted. Root `onRoute` guard fails the boot; tested. |
| N4: `build.ts` meets the D2 rule but was not listed; stronger rationale; "publish", not "save" | non-blocking | Accepted. Listed; the error-handler example and test use `%c3%a4`; wording fixed. |
| N5: the settings failure text was unspecified | non-blocking | Accepted. `refusal('generate the preview')`; stubbed-failure test. |
| N6: hero tests for transitions and edge hosts | non-blocking | Accepted. |
| N7: pin the refusal shape and `HEAD` | non-blocking | Accepted; the 30 + 30 bound is stated. |
| N8: corrections (no peer dependency, only `ip-address` is new, one store per limiter, the reason for rejecting per-route session checks) | non-blocking | Accepted; D4 corrected. |
| N9: the plugin marks a request as limited once per instance | non-blocking | Accepted; noted in the `registerGpxRoutes` doc comment. |
| N10: the pull request must close the children | non-blocking | Accepted; T5 lists the `Closes` lines. |

### Revision 2 (commit `8467a47f1870f5055ace60051befa9ed3b0fc995`): approved

Same reviewer, follow-up session (`anthropic/claude-opus-5-5`, launched at effort `high`,
Orca dispatch `ctx_7e6136c3349e`; its harness showed a reasoning-effort value of 15 and no
level name), 2026-11-17. Verdict: **approved**, no blocking finding. B1 and B2 resolved, N1
to N10 handled as recorded above.

The reviewer re-queried scans 2 and 3, diffed the scan-3 commit against the base, booted
the moved scopes and both guards on Fastify 5.12.8, and ran the new `inlineImage` and
`IMAGE_RE` over 111,105 generated hrefs with no round-trip or CommonMark mismatch and
linear matching time.

| Finding | Severity | Disposition |
|---|---|---|
| R1: the backup scope was not limited by construction | non-blocking | Accepted. Guard added to the scope. |
| R2: more scan readings change than the one stated; some to a reading that is neither the old one nor CommonMark's | non-blocking | Accepted. `(?!<)` on the bare branch (the reviewer's run over 274,512 inputs: every changed reading agrees with CommonMark); D1 lists the classes; one test per class. |
| R3: "the block stays last" rests on memory | non-blocking | Accepted in part. `CLAUDE.md`'s high-risk list names the block. The proposed source-order test is not added: it would assert on source text, not on behavior; the limit stays a documented one. |
| R4: the login-scope guard could not be tested as designed | non-blocking | Accepted. `requireRouteLimiter` factory, tested on a bare instance. |
| R5: nothing pins what the moved routes inherit from the root | non-blocking | Accepted. One new case (read-only refusal, frame and referrer headers). |
| R6: three implementation details | non-blocking | Accepted. Stated in D4. |

### Revision 3 (commit `9aab82fbeb04138d259ae413c2ea1ebe4880ad7c`): approved

Revision 2 plus R1 to R6 as dispositioned above; no other change. Same reviewer, follow-up
session (Orca dispatch `ctx_e624a9664e2b`), 2026-11-17. Verdict: **approved**; the partial
acceptance of R3 does not change it. Two editorial notes, both applied to this text without
a further round, as the reviewer stated: the backup-scope predicate also excludes `null`,
and the sentence on changed scan readings names the one case that ends at "not an image"
rather than at CommonMark's reading.

### Integrated diff (head `35c935013b5392ca5a7db8bc644a45819dadab9b`): approved

Independent review of `origin/dev...HEAD` by a fresh session (`anthropic/claude-opus-5-5`,
launched at effort `high`, Orca dispatch `ctx_b8070c514472`; its harness showed a
reasoning-effort value of 15 and no level name). `/review` could not be invoked from that
session, so it ran OMP's bundled `reviewer` agent, the agent `/review` uses, on the complete
diff and verified the findings itself: full suite (6048 tests) against its own disposable
database, 15 mutation checks, a round-trip run over 20,000 generated hrefs, regeneration of
the inventory (byte-identical), and a comparison of the moved handlers with `origin/dev`
(identical apart from indentation and the receiver). Verdict: **approved**, no must-fix.

| Finding | Severity | Disposition |
|---|---|---|
| S1: the two scope `onRoute` guards could be deleted without a test failing | should-fix | Accepted. Two cases pin them where they are installed. This also supersedes R4's premise that only the factory could be tested. |
| S2: one edited test pinned the log call's argument list | should-fix | Accepted. It asserts the printed line; a single-publish case with a directive-bearing key is added. |
| N1: nothing pinned `global: false` | nit | Accepted. One case. |
| N2: three rewritten log sites had no test | nit | Not added. At those three sites the logged value cannot contain `%` (a temp-file name the application wrote, an internal attempt id, a storage key limited to `a-z 0-9 / _ -`), so no test can tell the old form from the new one; it would only pin the wording. |
| N3: `SECURITY.md` overclaimed "log lines never…" | nit | Accepted. Reworded; the encode queue's line is named. |
| N4: the /64 grouping relied on a plugin default | nit | Accepted. `ipv6Subnet: 64` is set explicitly. |
| N5: "quotes" in D3 | nit | Accepted. "double quotes". |
| N6: pull request wording and verification placeholder | nit | Accepted. |
