# Issue #633 — internal link picker and DE↔EN internal link mapping

Status: **revision 17** (under independent re-review). Issue:
[#633](https://github.com/laboef1900/wanderlust-studio/issues/633). Branch
`feature/issue-633-internal-links`, base `origin/dev`
(`a4af2c3177d71186625355617a7a5352b6ee62d5`).

Revision 1 was reviewed by an independent Orca worker (dispatch
`ctx_7a01013b03fd`, model `deepseek/deepseek-flash`) and rejected with nine blocking
findings. Revision 2 (dispatch `ctx_9122ce226391`, same model) resolved eight and
rejected three new defects. Revision 3 (dispatch `ctx_ef4293d0051b`, same model)
resolved two of those three and rejected four. Revision 4 (dispatch
`ctx_a8f11e5f39d0`, same model) resolved all four but left two holes in the B2.1 value
domain. Revision 5 (dispatch `ctx_b76c79de92b7`, same model) closed those and exposed
two gaps in the Markdown action (title-bearing links vs insertion, unescaped URL label).
Revision 6 (dispatch `ctx_3e31b312918a`, same model) resolved the URL label but left the
refusal set and the destination/title boundary under-specified. Revision 7 (dispatch
`ctx_6db558937a4c`, same model) resolved the boundary/boundary tests but exposed nested
links, indented code and raw HTML blocks. Revision 8 (dispatch `ctx_e1f1e1fb6a33`, same
model) exposed five more CommonMark cases in the browser parser. **Revision 9 pivots:**
the browser no longer parses Markdown; `POST /internal-links/analyze` returns the exact
mdast node at the selection using the parser the compiler already trusts. Revision 9
(dispatch `ctx_02a0d7d1cdc1`, same model) verified the pivot but rejected four contract
holes (selection-to-kind precedence, `inlineCode`, table pipes, analyzer module/parser
placement). Revision 10 (dispatch `ctx_a88bf51497eb`, same model) resolved all but the
empty-range precedence and syntax-only ranges; revision 11's attempt to specify those
kept producing boundary edge cases. **Revision 12 simplifies the contract:** Markdown
link editing requires a non-empty text selection (no cursor-only insertion); the
analyzer resolves only the selection's enclosing node. This removes empty ranges,
syntax-only ranges and boundary precedence entirely. Revision 12 (dispatch
`ctx_5c39dc692e03`, same model) verified the simplification but found two apply-path
defects (label encoding, removal creating an outer link). Revision 13 (dispatch
`ctx_afc273d46968`, same model) approved R2 but found label unit boundaries, an autolink
wire contradiction and a duplicated map builder. Revision 14 (dispatch
`ctx_386d28fc4ade`, same model) approved B2/B3 but found a container-prefix gap in the
label tiling. Revision 15 (dispatch `ctx_24e5c3c0766e`, same model) found the tiling
rule still accepted a straddling entity unit and left the container chain unspecified.
Revision 16 adds the no-overhang rule and the ancestor containers. Revision 16 (dispatch
`ctx_91fecac2db85`, same model) approved those but found a CRLF normalization gap and an
undefined shared-locator error contract. Revision 17 closes both; every mapping is
below.

## Risk classification

**High risk.** The change touches the protected article-translation compiler
(`site/src/lib/article-translation.ts`), whose structural fingerprint separates an
acceptable provider translation from a mutated article, and adds an authenticated
server route that enumerates internal URLs.

### Authorization exception (design gate only)

- Waived rule: `CLAUDE.md` → *Change Risk and Required Rigor* → High risk → Review and
  recovery: "Explicit human approval and a documented rollback or containment plan."
- Scope: repository `laboef1900/wanderlust-studio`, issue #633, this branch only.
- Replacement: an independent AI design reviewer who did not author the design must
  approve this revision (or a later revision) before implementation. The reviewer's
  agent and model are recorded in the Orca Run and the PR.
- Reason: the owner delegated the design-approval pause to the independent AI gate for
  this issue.
- Risks: the reviewer may miss product intent; the design may still be wrong.
- Approver: repository owner (`laboef1900`), through the issue-633 implementation
  brief, 2026-11-18.
- Compensating controls: the reviewer inspects the affected source; a second
  independent AI review covers the PR diff; the full affected suites and both
  type-checkers run before handoff; a branch revert is the rollback (no schema, data or
  migration changes).
- Expiry: final PR handoff, or abandonment of this branch.
- Not waived: branch protection, required CI, repository-wide safety rules, data safety,
  or human approval outside the design gate.

## Goal

1. The editor's link dialog offers the site's live internal pages for the active editor
   locale, in addition to a free URL, from both Visual and Markdown modes.
2. Article translation deterministically rewrites internal link **destinations** from the
   source locale's live path to the target locale's live path when one exists, and leaves
   everything else byte-identical with an explicit warning.

Non-goals: no slug changes, no new public routes, no provider-contract change, no raw
HTML-anchor rewriting (warning only — see *Limits*).

## Preservation invariants

1. **Slug/route contract** (Golden Rule 2): every path comes from an existing helper —
   `uploader/src/public-paths.ts` or `site/src/lib/paths.ts` called with the DB
   `LanguageConfig` explicitly. Nothing hand-builds a route.
2. **Translation compiler integrity**: link **destinations** never enter provider slots.
   The provider's text edits must not be able to create or change a destination
   (established by `escapeProse`) and the structural fingerprint must reject every other
   URL, node, property, gallery or interpretation change. The server compiler owns the
   one permitted destination change.
3. **No invented routes**: the catalog contains only paths that exist now (`published`
   row **and** committed snapshot). A target's alternate path is the counterpart's live
   URL or `null`. Translation remaps only to catalog `to` paths; every unmapped internal
   destination stays byte-identical and raises a warning.
4. **External links unchanged**: absolute `http(s)`, protocol-relative, `mailto:`, `tel:`,
   fragment-only, and same-document links are untouched; query/fragment suffixes are
   preserved when a path is exchanged.
5. **Data safety**: read-only feature; no schema, migration, publish or `/data` mutation.
   `/translation/*` keeps its documented no-store-read, no-write, no-network contract.
6. **No UI copy outside `ui.ts`**; every new key exists in DE and EN.

## Design

### 1. Internal-link catalog — `uploader/src/internal-links.ts` (new)

```
InternalLinkKind = 'home'|'about'|'map'|'regions'|'journeys'|'region'|'page'|'story'|'journey'
InternalLinkTarget = {
  id: string;                  // 'builtin:map', 'page:contact', 'story:<uuid>', 'journey:<uuid>', 'region:europe'
  kind: InternalLinkKind;
  title: string;               // live title where author-authored; '' for built-ins
  path: string;                // live path in the requested locale
  alternatePath: string|null;  // live path in the other enabled locale, or null
}
InternalLinkCatalog = { locale: LanguageLocale; alternateLocale: LanguageLocale | null; targets }
```

`alternateLocale` is `null` when the site has only one locale; `publicPath` is never
called for a disabled locale.

Inputs (structural types, so tests can use memory stores):
`{ language: LanguageConfig; posts: Pick<PostStore,'list'>; pages: Pick<PageStore,'getAll'|'keys'|'get'>; journeys?: Pick<JourneyStore,'list'> }`.

**Sources and liveness.** A target is listed only when its route exists now. This
mirrors the site loader and `publicRoutes`:

- built-ins: home, map, regions index (always); journeys index only when at least one
  journey is live in that locale.
- about: exactly one target, emitted only here. Fixed
  `publicPath(mode, locale, 'about')`; title from the stored About pair when present,
  else `''`. About is **route-based**: `publicRoutes` always emits it, so it is listed
  even when the stored pair is absent or (`memoryPageStore`) reports `published` with
  `publishedAt: null`; the generic page liveness rule does not apply. The CMS-pages loop
  below **skips `pair.key === 'about'`**, so there is no second emission to hide behind
  the path-keyed `Map`; the catalog still asserts path uniqueness.
- CMS pages: `pages.getAll?.()` else `keys()` + `get()`, **filtered by
  `isPageKind(pair.key)`** — the same rule `assignedPagePaths` and the site loader use;
  unsupported/legacy keys can exist after a restore (SECURITY.md:608) and have no route.
  `about` is skipped (see above). Live = pair `status === 'published'` **and**
  `pair[locale].publishedAt !== null`; other kinds use
  `publicPath(mode, locale, 'story', slug)` only with a non-empty slug.
- stories: `posts.list()`. Live per locale when
  `post.publication.availability === 'available'` and
  `post.publication.committedLocales.includes(locale)` — the exact `status='published'
  AND published_snapshot IS NOT NULL` test the site loader uses. Path and title come from
  the **committed snapshot**, not the working row, so a draft slug rename cannot produce
  a 404: `PostSummary` gains
  `publishedLocales: Record<Locale, { slug; title; region } | null>` (memory: from
  `snapshotContent`; pg: `published_snapshot->>'slug'|'title'|'region'` plus
  `has_snapshot`). The value is gated on **`rowStatus === 'published' && snapshot
  present`** (pg: `status === 'published' && has_snapshot`) — neither store deletes a
  snapshot on unpublish, so a presence-only projection would leak a stale slug/title.
  Empty `slug` is skipped before `publicPath` is called. The pg integration test asserts
  the committed slug/title/region and that a draft slug rename keeps the snapshot slug.
- journeys: `journeys?.list()`. Live per locale when pair `status === 'published'`,
  `publishedSnapshot !== null`, `publishedSnapshot.locales[locale]` exists, **and** at
  least one of **`publishedSnapshot.members`** (not the working `members` array) has
  that locale in `post.publication.committedLocales`. Path/title come from the snapshot;
  a member added only to the draft cannot make the journey live. The same test set
  includes a draft-member addition.
- regions: one per closed-set region with at least one live story whose committed
  snapshot `region` equals it; title `ui[locale]['region.'+region]`; path
  `publicPath(mode, locale, 'region', regionSlugs[region][locale])`. A non-string or
  unknown snapshot region (pre-region legacy rows) is treated as "no region page".
  Alternate liveness is computed symmetrically (a live story of that region in the other
  locale), so `alternatePath` is `null` until then.

Paths: built-ins/pages/regions through `publicPath`; journeys through
`journeysIndexPath(locale, language)` / `journeyPath(slug, locale, language)` with the
explicit `LanguageConfig` — never the `siteLanguage()` env default. Slug validation
(`/^[a-z0-9][a-z0-9-]*$/`) happens before either call. No change to
`public-paths.ts`, its browser mirror, or the parity tables is needed.

`alternatePath` is computed symmetrically for **every** kind: home/map/regions index
always have the other enabled locale's route; About and other pages have it when the
pair is published and the other locale has a path; a story/journey/region has it only
when that counterpart is live in the other locale; the journeys **index** has it only
when at least one journey is live there. A disabled or absent counterpart is `null`,
never a guessed path.

The catalog performs three independent reads (`posts.list`, pages, `journeys.list`); a
publish between them can briefly yield a target the current release does not serve. The
catalog is a picker/mapper hint, not the route authority — `assertPublicRoutes` and the
build remain authoritative — and translation only exchanges to paths the catalog lists.

`translationLinkMap(catalog)` returns `{from,to}[]` for targets with a non-null
`alternatePath`, deduped by canonical `from` (root is exactly `'/'`; every other entry
ends with exactly one `/` and has no `//`). Home therefore maps `'/' ↔ '/<secondary>/'`
in both directions, including EN-primary (`'/de/' ↔ '/'`). The map is not truncated:
the route returns the whole live catalog, the library's cap is 5 000 entries, and an
over-cap map fails the request (`translation_invalid_input`) rather than dropping
targets. **The GET response includes this array as `links`** (built by this one server
function); the browser never rebuilds or filters it — `linkDialog.map(locale)` returns
the fetched catalog's `links` unchanged. The route test therefore exercises the same
builder the translation flow uses. Built-in labels are localized in the browser from
`EditorCopy`; region labels come from `ui.ts`.

### 2. Read-only routes — `uploader/src/internal-link-routes.ts` (new)

`GET /internal-links?locale=de|en`, `preHandler: requireAuth`, `cache-control:
no-store`, `{ locale, alternateLocale, targets, links }` where `links` is
`translationLinkMap(catalog)` (§1). Query: exactly one `locale`, must be enabled by the
language store; otherwise 400. No store writes, no network, no settings.

`POST /internal-links/analyze`, `preHandler: requireAuth`, `cache-control: no-store`,
`bodyLimit: 1 MiB` (the sibling `/gallery/analyze` ceiling), request
`{ bodyMarkdown: string, from: integer, to: integer }` (validated: string ≤ 100 000
chars, `0 ≤ from < to ≤ length` — **an empty range is a 400**, because the Markdown
action requires a selection; 413/400 refusals map to `linkEditInSource`).

The analyzer is `site/src/lib/markdown-link-selection.ts` (new), the **only** place in
this feature that imports `satteri`; it exports `analyzeLinkSelection(body, from, to)`
plus the shared `labelEnd`/`markdownTitle`/`destinationRange` helpers. `labelEnd` and
`markdownTitle` move there from `article-translation.ts` and are imported back, so the
compiler and the editor share one byte-exact implementation. The uploader route imports
the analyzer from the site tree (it already imports `article-translation.ts`); no
satteri dependency is added to `uploader/package.json`. The analyzer parses with
`markdownToMdast(bodyMarkdown, { features: MARKDOWN_FEATURES })`, offsets are **UTF-16
code units** (satteri's, CodeMirror's and the compiler's unit).

**Failure contract:** the shared locators throw a module-local `LinkLocatorError` (the
module imports neither `TranslationError` nor any compiler type). `analyzeLinkSelection`
catches every `LinkLocatorError`/parser exception and returns `{ kind: 'other' }`;
`article-translation.ts` catches `LinkLocatorError` from the same helpers and maps it to
`translation_unsupported_source`, exactly as before. Nothing throws past the route, and
there is no import cycle. No store reads, writes or network. This endpoint is the
single source of Markdown link truth for the editor; the browser never parses Markdown.

The wire union is
`link | image | imageReference | linkReference | definition | code | inlineCode | html |
text | other`:
- `link` carries `{ start, end, labelStart, labelEnd, destinationStart, destinationEnd,
  url, removalSafe }` **only when the `[label](destination)` locator succeeds**. An
  autolink (`<https://…>`) or GFM bare URL has a link node but no bracket destination →
  `other`; a payload with undefined ranges is never sent, so the client never slices a
  missing range. `removalSafe` is computed by applying the removal locally and
  reparsing: it is `true` only when the resulting document's link-URL multiset is the
  original multiset minus this link (no new link, no changed URL). Removing an inner link
  inside an otherwise literal outer bracket construct is therefore `removalSafe: false`.
- `text` carries `{ label }`: the analyzer builds the text node's ancestor
  `SourceContainer[]` chain — `blockquote` → `{ kind: 'quote' }`, `listItem` →
  `{ kind: 'list', indent }` with the compiler's own column computation — and calls
  `positionedText(normalizedValue, body, start, end, containers)` where
  `normalizedValue = (node.value ?? '').replace(/\r\n?/gu, '\n')`, exactly the compiler's
  `prose` normalization (a CRLF text node with an entity must tile like its LF twin).
  The mapped units must **tile
  `[from, to)` with no overhang**:
  - every unit that intersects `[from, to)` (`unit.start < to && unit.end > from`) must
    lie wholly inside it (`unit.start >= from && unit.end <= to`); a unit that straddles
    a boundary is `other` (e.g. selecting `Tom &` with a `to` offset inside the
    `&amp;` span);
  - the selected units are contiguous (`unit.end === next.start`), the first starts at
    `from`, and the last ends at `to`;
  - a gap from a blockquote/list continuation prefix, a softbreak or a cross-line
    selection is `other`.
  If the tiled value is empty/whitespace, the result is also `other` (`[](…)` is never
  emitted). Otherwise `label` is that value with **every ASCII punctuation character
  entity-encoded** (`escapeLabelText`, the same rules as the compiler's `escapeProse`),
  so emphasis, code spans, HTML and table pipes cannot form inside the label. The
  analyzer verifies `[label](https://h.invalid/)` parses to exactly one link whose text
  content equals the value; otherwise `other`. The client never escapes a label.
- Every other kind carries no payload. The analyzer owns its own failure as `other`;
  the module does not import `TranslationError` (no cycle), and the compiler imports
  only its pure helpers.

Both routes register with the content routes (before the rate-limited block at the end
of `buildServer`). `internal-links` joins `APP_SEGMENTS` in
`site/src/lib/reserved-routes.ts` so the root namespace stays reserved and the
registered-routes parity test stays true. **Golden Rule 2 check before merge:** query
the live database for any published post or page whose slug is exactly `internal-links`
in any locale; if one exists, choose a different reserved segment rather than shadow a
live URL. The PR records the query and its result.

### 3. Editor link dialog — `uploader/public/link-dialog.js` (new)

One runtime-created native `<dialog class="admin-modal">` per page, created lazily on
the first `open` (so loading the script never touches `AdminConfirm` or the DOM). Same
fallback contract as `admin-confirm.js`: without `showModal`, call
`AdminConfirm.prompt` at open time; `AdminConfirm` is not required at load. The dialog
sets `aria-labelledby="internalLinkTitle"` and
`aria-describedby="internalLinkBody"`. Markup:

- `h2#internalLinkTitle` + helper `p#internalLinkBody`;
- `<label for="internalLinkTarget">` + `select#internalLinkTarget` with a leading
  "Custom or external address" option and `<optgroup>`s per kind. Options label
  `title || copy.linkKind<Kind>` plus `path`; an entry whose `alternatePath` is null
  carries the "No translation" hint in its option text;
- `<label for="internalLinkText">` + `input#internalLinkText` prefilled with the decoded
  current destination. The **input** carries `aria-describedby="internalLinkError"` and
  `aria-invalid` while refused; `p#internalLinkError.field-error` is the referenced error
  text;
- Cancel (first submit) then Apply, matching the existing dialog footer.

Behaviour:

- **Value domain:** the dialog's input and every `current`/prefill value are the
  **decoded destination** returned by `/internal-links/analyze` (mdast's `url`:
  backslash escapes and HTML character references decoded, percent-encoding left as
  written). The Visual editor's href is already in this domain. The dialog never
  receives or shows a raw escaped destination and never unescapes one itself.
- Selecting a target fills the input with its relative path (canonical catalog
  spelling). Pre-selection uses one documented normalizer, identical to the compiler's
  lookup (pinned by a shared table in both suites): resolve an absolute `current` against
  `location.origin` and keep only its pathname when same-origin, strip query/fragment,
  and accept the path with or without exactly one trailing slash. The full current value
  stays in the input; the select only mirrors the matched target.
- Empty input = remove the link; non-empty must pass `RichTextEditor.safeLink` **and**
  an optional per-caller `extraValidate` (the Markdown action supplies the destination
  rule below). Focus opens on the address input (which holds the current value and
  `select()`s it, as `AdminConfirm.prompt` does); the target select is the previous Tab
  stop. The failure/`linkTargetsFailed` paragraph is `role="status" aria-live="polite"`.
- Enter in the select **or** the input runs validation and applies via the same
  `accept()` path; implicit submit (which would hit Cancel first) is always prevented.
  Escape/native `cancel` resolves `null`; focus returns to the editor. `close` resolves
  to the trimmed value or `null`; a refusal stays open with the error announced through
  `aria-describedby`.
- Catalog fetch is **one shared lazy promise per locale**, created on the first picker
  open **or** the first `map(locale)` call (`/internal-links`, `cache:'no-store'`). No
  fetch during page load, so existing request-count assertions stay valid; later callers
  await the same in-flight promise. **A rejection evicts the cache entry**, so the next
  open/`map()` issues a fresh request (a retry can succeed; the rejected promise is never
  retained). The picker leaves the free-URL field usable and shows
  `copy.linkTargetsFailed`; `map()` rejects, so translation fails closed. A 401 calls the
  host `onUnauthed`.
- `map(locale)` awaits that same promise and returns the fetched catalog's `links`
  server array **unchanged** for translation (see §5); the browser never builds,
  filters or re-dedupes the map.

Wiring (story `editor.html` and page `about.html`):

- `const linkDialog = InternalLinkDialog.create({ copy: editorCopy, onUnauthed: () => guard.redirectToLogin() })`.
- Visual: `askLink: (current) => linkDialog.open({ current, locale })` on
  `EditorRichBridge` (contract unchanged: `''` removes, `null` cancels).
- Markdown: `ManuscriptBar.wire` gains an optional `linkAction`; the toolbar `link`
  button calls it when not visual. Both MDE option sets set
  `shortcuts: { …, drawLink: null }` (EasyMDE 2.21.0 skips a null action), and
  `linkDialog.wireMarkdown(cm, locale)` installs **exactly one** binding: `cm.addKeyMap(map)`
  at normal (not bottom) priority when the engine exposes it; otherwise (the VM
  harness's stub) a single `keydown` handler on `cm.getInputField()` that ignores
  `event.defaultPrevented` events, calls `preventDefault()`, and opens the dialog. Never
  both. The editor-dom test asserts the fallback path opens the dialog from `Cmd-K`.
- **Markdown link action — selection-only, server-parsed.** The action requires a
  **non-empty, single-range selection**. An empty selection or
  `cm.listSelections().length > 1` shows `copy.linkSelectText` through the host's
  status/notice surface ("Select one text range to link. Edit an existing link in the
  Visual view.") and sends no request; there is no cursor-only insertion.
  The action POSTs `{ bodyMarkdown, from, to }` with the selection offsets. The server
  calls `analyzeLinkSelection` (§2), parses with
  `markdownToMdast(bodyMarkdown, { features: MARKDOWN_FEATURES })`, and resolves the
  selection by the **deepest node that contains the whole range** (D):
  1. If D is a `text` node: walk its ancestors; the nearest interest ancestor
     (`link`, `linkReference`, `image`, `imageReference`, `definition`, `code`,
     `inlineCode`, `html`) wins; with none, the result is `text`. So a selection inside
     a link label is `link`, inside a reference label is `linkReference`, inside a code
     span is `inlineCode`.
  2. If D is an interest node, that is the kind. For `link` the response is
     `{ kind: 'link', link: { start, end, labelStart, labelEnd, destinationStart,
     destinationEnd, url, removalSafe } }`; `url` is mdast's decoded destination
     (backslash escapes and entities decoded, percent-encoding retained), so the dialog
     prefill needs **no client unescape**; `labelStart` is after `[`, `labelEnd` is at
     `]`; `removalSafe` is the server's reparse proof from §2.
  3. Otherwise D is formatting or a block container (emphasis markers, heading marker,
     task checkbox, table delimiter, cross-node/cross-paragraph selection) → `other`.
  All positions are UTF-16 code units. One deepest containing node decides; there is no
  precedence search and no leaf-coverage test.
- Apply semantics:
  - `kind: 'link'` → open with `current = link.url`. Unchanged → **no-op** (source
    byte-identical); empty → **only if `removalSafe`**, replace `[start, end)` with
    `body.slice(labelStart, labelEnd)` (removal keeps the raw label); an unsafe removal
    shows `linkEditInSource` and changes nothing; otherwise → replace **only**
    `[destinationStart, destinationEnd)` with `escapeDestination(value)`, preserving
    label/title/angle brackets.
  - `kind: 'text'` → open with `current = ''`. Empty → **no-op** (never `[]()`);
    otherwise insert `[label](escapeDestination(value))` replacing the selected text,
    using the server's `label` **verbatim** (the client never escapes a label). There is
    always a selection, so the URL-label branch does not exist in Markdown mode.
  - any other kind → `copy.linkEditInSource`, source byte-identical. The client treats
    `inlineCode` exactly like `code`.
- Destination handling keeps three client contracts (validate / escape / check):
  - `destinationError(value)` → `''` or a copy sentence rejecting
    `[\u0000-\u001f\u007f\u0080-\u009f]`; shown via `extraValidate`. `safeLink` remains
    the separate link-safety gate. (This range is intentionally stricter than the
    compiler's `forbiddenControls`, which allows tab/LF/CR.)
  - `escapeDestination(value)` → the emitted destination, using the same rules as the
    Visual serializer's private helper (`editor-rich-text.ts`, not exported/rebuilt):
    `&` → `&amp;`, `\( \) \\ < > |` backslash-escaped, and `[\u0000-\u0020\u007f]`
    percent-encoded (controls already rejected, so only space is reached). `|` is
    escaped so a destination inside a GFM table cell cannot break the row. `/my page` →
    `/my%20page`; `/a)b` → `/a\)b`; `</x>` → `\</x\>`.
  - `isEscapedDestination(text)` is a terminating checker (no unescaped whitespace,
    controls, `|`; balanced unescaped parens; does not start with `<`). Insertion
    computes `const dest = escapeDestination(value)` once and requires
    `destinationError(value) === '' && isEscapedDestination(dest)`; it never feeds
    `dest` back through `escapeDestination`.
- Tests:
  - Analyzer (`link-analyze.test.ts`) with `satteri` ground truth: the kind precedence
    rows (selection inside a link label → `link`; inside `[alpha beta][ref]`'s label →
    `linkReference`; inside a code span → `inlineCode`; inside `[a [b](/c) d](/e)`'s
    literal `d` → `text` (no interest ancestor) and inside `[b](/c)` → `link`;
    emphasis text → `text`, emphasis markers → `other`; heading marker, task checkbox
    and table delimiter → `other`; cross-paragraph and link+text selections → `other`);
    full/collapsed/shortcut references and definitions; image; fenced, indented,
    blockquoted and list-indented code; HTML blocks (mid-paragraph and blank-spanning);
    title/angle/leading-space links (destination range correct, `url` decoded); a
    non-ASCII body (`ä`/emoji before the selection) to pin UTF-16 offsets; invalid or
    empty ranges → 400; 100 001 chars or >1 MiB → 413; 401.
  - Analyzer additions: a selection ending in a lone `\` returns a `label` whose
    emitted link parses to the same text (or `other`); `a\*b` and `a*b*c` label text is
    preserved (punctuation entity-encoded, no emphasis); a table-cell `|` is
    entity-encoded; `Tom &amp; Jerry` selected `[0,5)` (ends **inside** the `&amp;`
    span) → `other`, while `[0,9)` (the full `Tom &`) → `text` with label `Tom &#38;`;
    an escape-unit boundary, a cross-line selection across a blockquote
    (`> one\n> two`) or list-continuation prefix, or an empty/whitespace selection
    returns `other` (units must tile exactly with no overhang); a single-line selection
    inside a blockquote is `text` (the ancestor `quote` container is passed); an
    autolink (`<https://…>`) and a GFM bare URL return
    `other` (no bracket locator); an `imageReference` returns `imageReference`; a nested
    inner-link removal returns `removalSafe:false` and a normal removal `true`; a CRLF
    body with an entity tiles like its LF twin (and a CR/LF boundary does not tile); a
    locator throw (malformed link) returns `other`, while the compiler maps the same
    `LinkLocatorError` to `translation_unsupported_source`.
  - Map: `GET /internal-links` returns the `links` array built by
    `translationLinkMap`; the client uses it verbatim (no browser-side builder test
    because there is no browser-side builder).
  - Dialog (`link-dialog.test.ts`): `link` retarget changes only the destination and
    keeps title/label; unchanged byte-identical; safe empty removal keeps the label;
    unsafe removal (`removalSafe:false`) refuses with byte identity; `text` insertion
    uses the server `label` verbatim (a lone trailing `\`, `a\*b`, and a `|` cell all
    parse to the expected text); an insert and a retarget inside a `tableCell` preserve
    the row/cell count; `inlineCode`/`other` kinds refuse; an empty or multi-range
    selection shows `linkSelectText` and sends no request.
  - The analyzer's destination locator is byte-exact against `satteri` for all these
    forms; a locator failure returns `other` (refuse), never an edit.
- Round-trip tests are **per-case**, because `satteri` does not percent-decode:
  | input | `escapeDestination` | parsed `mdast` `url` | assertion |
  |---|---|---|---|
  | `/my page` | `/my%20page` | `/my%20page` | one link; `decodeURIComponent(url) === '/my page'` |
  | `/a)b` | `/a\)b` | `/a)b` | one link; `url === '/a)b'` |
  | `</x>` | `\</x\>` | `</x>` | one link; `url === '</x>'` |
  | `/a?b&c` | `/a?b&amp;c` | `/a?b&c` | one link; `url === '/a?b&c'` |
  Plus: newline/tab rejected with the dialog open; `![alt](/img)` untouched; a normal
  path unchanged.
- The script is included after `admin-confirm.js` in both pages and added to every VM
  harness script list that runs the editor inline: `editor-dom.test.ts`,
  `about-equipment-dom.test.ts`, `about-gallery-warnings.test.ts`,
  `pages-admin-dom.test.ts`, `language-admin-dom`, `editor-gpx.test.ts`
  (`:338-340`) and `editor-translation-engines.test.ts`. The editor-dom harness also
  answers `/internal-links` before its generic feature ledger (default empty catalog,
  per-test override), so existing translation fixtures and request-count assertions stay
  scoped.

Copy (both locales, `editor.chrome.*`): `linkDialogTitle`, `linkDialogBody`,
`linkTargetLabel`, `linkTargetCustom`, `linkTargetLoading`, `linkTargetsFailed`,
`linkKindHome/About/Map/Regions/Journeys/Region/Page/Story/Journey`,
`linkNoTranslation`, `linkEditInSource`, `linkSelectText`, `translationLinksRetained`,
`translationLinksFailed`, `translationLinksInvalid`. Every DE value differs from its EN
value (e.g. `linkKindRegion` = `Regionsseite` / `Region page`), so no
`IDENTICAL_ON_PURPOSE` allow-list entry is added.

### 4. Translation compiler — `site/src/lib/article-translation.ts`

Input gains **optional** `links: { from: string; to: string }[]`. It is supplied by the
authenticated editor from §1's server catalog; the compiler validates it strictly and
owns the rewrite. Absent `links` reproduces today's behavior exactly (no remap, no new
warning) — so existing callers/tests are unchanged.

Validation: array ≤ 5 000, each entry an exact `{from,to}`, each string ≤ 2 048 chars,
`from`/`to` matching `^/(?:[a-z0-9][a-z0-9/-]*)?$` (the empty group is the root `/`),
each non-root value ending with exactly one `/`, no `//`, no `..` segment, unique
canonical `from`. Anything else is `translation_invalid_input`. A map over the cap fails
(no truncation). A client-supplied `links` cannot inject markup: the character class
excludes spaces, brackets, quotes, `?`, `#`, `\`, `.` and schemes; the fingerprint
comparison additionally rejects any structural effect. The catalog's own map is tested
against this validator in DE-primary and EN-primary, including `/ ↔ /en/` and
`/de/ ↔ /`.

**Extraction** (source bytes only, deterministic):

- mdast `link` nodes starting with `[` and `definition` nodes whose `url` starts with
  `/` but not `//`. Inline links: reuse `labelEnd`, require `](`, then the URL up to the
  title range (`markdownTitle`) or the closing `)`; support `<…>`, escapes and
  whitespace before `)`. Definitions: `labelEnd`, require `:`, skip spaces/tabs and at
  most one line break plus ≤3-space indent, then `<…>` or up to whitespace. The decoded
  raw text must equal `node.url`.
- The locator helpers `labelEnd`/`markdownTitle` throw on shapes they cannot prove. Each
  URL is located inside a local `try/catch`: a throw, unlocatable destination, decoded
  mismatch, or overlap with `protectedRanges`, a gallery block, another link edit, or a
  text-slot edit is **skipped** (destination unchanged) and adds
  `internal-links-retained`. It never propagates and never rejects the article.
- A `definition` is remapped only when at least one `linkReference` resolves to its
  identifier **and no `imageReference` does**. A definition used (also) by an image is an
  image source, not a link destination: it is left unchanged and adds
  `internal-links-retained`. Among link-only definitions, every locatable one is
  remapped independently (the parser resolves a reference to the first definition;
  remapping each keeps each valid), so duplicate identifiers are not "ambiguous".
- `linkReference`/`imageReference` identifiers are collected in one mdast pass before
  URL collection; a definition with no link reference, or any image reference, is
  skipped with the warning.
- Split the destination at the first `?` or `#`, preserve the suffix. Lookup accepts the
  path with or without exactly one trailing slash; root is matched as `/` only (an
  empty path is not a URL). The replacement is the catalog's canonical `to`.
- External/`mailto:`/`tel:`/fragment-only/other-scheme destinations are untouched with
  no warning. An internal destination with no map entry is untouched and adds
  `internal-links-retained` once.
- Raw inline HTML `<a href="…">` is not rewritten: any internal `href` found in an
  `html` node adds the same warning. (Warning-only, so a bounded scan suffices.)

**Two explicit fingerprint checks:**

1. *Neutralization proof* (unchanged): if text provenance edits exist, applying them
   alone must keep `fingerprint(canonical(neutral))` equal to the source fingerprint.
   This proves the text-slot spans cannot change interpretation.
2. *Expected output*: `plan.fingerprint =
   fingerprint(canonical(applyGalleryEdits(body, [...textProvenance,
   ...linkEdits])))` (the existing sorted, overlap-rejecting applier).
   `validateTranslation` applies the translated text edits plus the **same** recomputed
   link edits and compares against that fingerprint. Provider text containing
   `](/evil/)` is entity-escaped by the existing `escapeProse`, so it stays text; a
   destination can only change through the validated map. Overlap/ambiguity is handled
   in extraction, never by weakening the check.

The destination map never enters `treeShape` as provider input; only the deterministic
edits do.

### 5. Editor translation — `uploader/public/editor-translation.js` + host

`EditorTranslation.create` gains `linkMap: (sourceLocale) => Promise<{from,to}[]>`.
Before `prepare`, stage `links` awaits it; the host implementation is
`linkDialog.map(sourceLocale)`, which awaits §3's **single shared** lazy catalog promise
(whether or not the picker was ever opened). A failure rejects, shows
`copy.translationLinksFailed` and offers Prepare again (fail closed — never translate
with silently stale destinations). The same map is added to both the prepare and
validate request bodies:

```
{ sourceLocale, targetLocale, source, links }
```

`POST /translation/*` passes a validated-looking `links` through to the library; it does
**not** read content stores. The existing test that the routes touch no content stores,
settings, credentials, logs or network stays true and stays green. The library is the
only validator of the map shape.

**Trust boundary:** `links` is author-controlled — the editor builds it from the
authenticated catalog, and the request is the author's own content. The server validates
shape, canonical relative paths and uniqueness; the map can only exchange one destination
for another relative path and cannot introduce markup (the fingerprint rejects any
structural effect). The provider never receives the map or any URL. The author can
already set those destinations directly in the article, so this grants no new capability;
it is recorded in `SECURITY.md` with the route. `editor.translation` shows
`copy.translationLinksRetained` when the prepare response includes that warning (same
line as the existing `headings` warning).

`errorMessage` gains two branches: stage `'links'` (the catalog fetch) →
`copy.translationLinksFailed`, and `translation_invalid_input` → `copy.translationLinksInvalid`
**only when this request carried a `links` array** (a rejected map); without `links`,
that code is the normal source rejection and keeps the generic failure copy. A retry
after a transient catalog rejection issues a new `/internal-links` request (§3 cache
eviction).

### 6. Docs

- `SECURITY.md:1253-1255` currently says the compiler "preserves … reference
  destinations". Replace that clause with the precise rule: destinations are source-owned **except**
  for the one deterministic exchange to a live counterpart path from the strictly
  validated map. Add `GET /internal-links` (authenticated, no-store, returns only
  titles/slugs already available through `/pages` and `/posts`, no writes/network),
  `POST /internal-links/analyze` (authenticated, no-store, accepts the author's article
  source, never logs it, no writes/network — the same sentence as `/gallery/analyze`),
  and state that `/translation/prepare|validate` remain source-analysis-only and accept
  the optional relative-path map without reading stores.
- `ARCHITECTURE.md:813-815` says URLs "remain source-owned". Replace with: destinations
  are source-owned except for the server compiler's validated counterpart exchange; the
  provider never receives them. Add the catalog route, the shared
  `markdown-link-selection.ts` analyzer and the map hand-off.
- `docs/claude/project-status.md`: one entry when the work lands, recording that
  Markdown link insertion now requires a text selection (cursor-only insertion/editing
  is Visual-only) and why (safe byte-exact edits).

## Rev 1 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| 1 | About emitted twice → every translation rejected | §1: one About target, path-keyed dedupe, uniqueness assertion |
| 2 | Drafts/journeys/regions offered or mapped as live; empty slug 500 | §1: live = committed snapshot per locale; snapshot slug/title/region; journey member liveness; symmetric region liveness; skip empty slugs |
| 3 | Journey paths use `siteLanguage()` default | §1: `journeysIndexPath`/`journeyPath` with explicit `LanguageConfig`; 4-mode tests |
| 4 | Story labels primary-locale only | §1: `PostSummary.publishedLocales[locale]` supplies per-locale title (and snapshot slug/region) |
| 5 | Markdown Cmd/Ctrl+K unwired; unsafe insertion | §3: `drawLink: null`, `addKeyMap`, raw-label reuse, one-line/escaped label, URL fallback |
| 6 | Definition extraction unsound; throws; opaque overlap; HTML warning missing | §4: definition locator, skip+warn for every unlocatable/overlapping case, HTML `href` warning |
| 7 | Fingerprint guard contradictory | §4: explicit two checks; neutralization on text only, expected fingerprint on text+link edits |
| 8 | Route/contract collisions | §2 reserved segment; §5 no store reads; map validation tests; docs; registration placement |
| 9 | Dialog a11y/coverage | §3: labels, error association, Enter/escape, lazy fetch, labeled harness scripts, both editors tested |

## Rev 2 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1 | Map grammar rejects `/`, so every translation 400s | §4: `^/(?:[a-z0-9][a-z0-9/-]*)?$`, canonical non-root trailing slash, root lookup; catalog-map validation test in both primary modes |
| B2 | Markdown insertion can emit a non-destination (`/my page`, `/a)b`) | Rev 3 split this into validator/renderer/checker (§3); the final contract is in the Rev 3 table |
| B3 | Unknown/legacy page keys become 404 catalog targets | §1: `isPageKind(pair.key)` filter, matching `assignedPagePaths`/the site loader; fake-store test with a published legacy key |
| N1 | `map()` can read an unopened cache as `[]` | §3/§5: one shared lazy promise used by both picker and translation; failure rejects |
| N2 | Harness coverage | §3: `editor-gpx.test.ts` added; editor-dom answers `/internal-links` before its feature ledger |
| N3 | Identical DE/EN key fails i18n test | §3: distinct German labels (`linkKindRegion` = `Regionseite`); no allow-list addition |
| N4 | No pg assertion for the new projection | pg integration test asserts committed slug/title/region and snapshot-slug retention after a draft rename |
| N5 | About liveness unstated | §1: route-based About, independent of pair `publishedAt` |
| N6 | `alternateLocale` nullability | §1: `LanguageLocale \| null`; no `publicPath` for a disabled locale |
| N7 | Docs contradict the exchange; exception record incomplete | §6 exact sentence replacements; §Risk approver/date added |
| N8 | Definition ambiguity contradiction | §4: all locatable definitions remapped; locator throws caught per link |
| N9 | Focus/aria-live/recognition unspecified | §3: address input focus + `select()`, `role=status` failure line, bounded recognition rule |
| N10 | Cap rejects whole translation | §1/§4: 5 000-entry cap, no truncation, explicit failure |
| N11 | `/a` and `/a/` both match | §4: canonical unique `from`; lookup normalizes one slash |
| N12 | Non-string snapshot region | §1: treated as no region page |

## Rev 3 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B2.1 | `markdownDestination` transform re-checked by itself | §3: split `destinationError` (reject controls), `escapeDestination` (percent-escape/escape, same rules as the Visual serializer's private helper), `isEscapedDestination` (terminating checker); no self-transform; parse-round-trip test |
| B2.2 | `markdownLinkAt` matches inside `![alt](src)` | §3: `!`-prefixed matches are images and never candidates; image-in-label links are not recognized; tests |
| B2.3 | Rejected catalog promise retained → retry impossible | §3: rejection evicts the cache entry; next call refetches; retry-success test |
| B2.4 | Journey liveness uses working `members` | §1: `publishedSnapshot.members` only; draft-member test |
| N1 | pg assertion missing from §1/acceptance | §1 + acceptance row below |
| N2 | Alternate symmetry understated | §1: explicit for every kind, incl. journeys index/pages |
| N3 | Snapshot presence leaks after unpublish | §1: gate on `status='published' AND has_snapshot` |
| N4 | About described twice | §1: emitted only in the About bullet; page loop skips it |
| N5 | Helper name collision | §3: `escapeDestination`/`destinationError` (the Visual serializer's private name is untouched) |
| N6 | Visual `%20` vs Markdown | §3: same escaping rules; one test pins both |
| N7 | Pre-selection normalizer | §3: one documented rule table (absolute→pathname, query/hash, one slash), pinned in both suites |
| N8 | Dialog labelling | §3: `aria-labelledby`/`aria-describedby` added |
| N9 | Harnesses lack admin-confirm | §3: dialog created lazily; `AdminConfirm.prompt` touched only at open fallback |
| N10 | Wrong line citations | §3 `:338-340`; §6 `1253-1255` |
| N11 | `addKeyMap(..., true)` bottom priority | §3: normal priority, plus a keydown fallback if the VM cannot assert it |
| N12 | Three independent reads | §1: acknowledged; not the route authority |
| N13 | No `translation_invalid_input` branch | §5: `translationLinksInvalid` copy and retry path |

## Rev 4 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B2.1a | Dialog value domain undefined; a no-edit Apply re-escapes an already-escaped destination | §3: value domain is the **decoded destination**; `unescapeDestination` added; `markdownLinkAt` returns the decoded value; Apply with an unchanged value is a **no-op** (byte-identical); tests `[x](/a\)b)` and `[x](/a?b&amp;c)` |
| B2.1b | Round-trip assertion false for `/my page` (`satteri` does not percent-decode) | §3: per-case table; `/my page` asserts `decodeURIComponent(parsed url)`, the other cases assert the parsed URL; Visual pin moved to `editor-rich-text.test.ts` |
| N1 | Visual pin location inconsistent | §3 and acceptance now both name `editor-rich-text.test.ts` |
| N2 | `aria-invalid`/`aria-describedby` on the error paragraph | §3: on `input#internalLinkText`; the paragraph is the referenced text |
| N3 | Both keymap and keydown fallback read as installed | §3: exactly one is installed; fallback checks `defaultPrevented`, calls `preventDefault()` |

## Rev 5 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B-1 | Title-bearing/unproven links are "untouched" yet the new-link path inserts into them | §3: single-line parser supports angle destinations, balanced parens, escapes and `"…"`/`'…'`/`(…)` titles; retarget replaces only the destination range and keeps the title; fence/code-span or unproven link-like constructs refuse with `linkEditInSource` and leave the source byte-identical |
| B-2 | URL-as-label is not escaped | §3: both label branches use `escapeLabel` (`/[\\[\]]/`); test empty selection + URL `https://e.test/?q=x]` yields one link with that URL |

## Rev 6 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| F1 | Refusal set scoped to `[…](…)`; references, footnotes and definition lines still receive insertions | §3: refusal set includes images, full/collapsed/shortcut references, footnote refs, definition lines, fences and inline code; the four named destructive forms have byte-identity tests |
| F2 | Destination/title boundary unstated; a literal balanced-paren scan swallows the title | §3: bare destination ends at the first unescaped space/tab or `)` at depth 0; angle at the first unescaped `>`; then optional title; tests for `[x](/a(b) "T")`, `[x](/a (b))`, `[x](</a b> "T")` |
| F3 | Empty value on a new link would insert `[]()` | §3: empty on a new link is a no-op; test |

## Rev 7 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| H1 | Nested link in a label was accepted as the outer link; CommonMark keeps the inner link and literal outer text | §3: an inline link at label depth ≥ 1 makes the outer unproven; the inner is scanned and editable; a cursor elsewhere in the outer label refuses; nested images remain valid labels |
| H2 | Indented code and raw HTML blocks missing from the refusal set | §3: refusal set adds both; byte-identity tests |
| N1 | Two-link fixtures did not pin the cursor | §3: cursor pinned inside each link |
| N2 | Paren-title termination unstated | §3: ends at the first `)` |
| N3 | `destinationError` missed U+0080–U+009F | §3: rejected range matches `forbiddenControls` |
| N4 | Escape wording vs the helper's control range | §3: helper range named; validator rejects controls first |
| N5 | Image-only rooted definitions warned spuriously | §4: only definitions used by a link reference and no image reference are remapped/warned |
| N6 | New reserved segment vs live slugs (Golden Rule 2) | §2: pre-merge DB query; choose another segment on conflict |
| N7 | "Empty path after normalization" ambiguity | §4: root is matched as `/` only |
| N8 | Harness list omitted `editor-translation-engines.test.ts` | §3: added |
| N9 | Client map trust boundary undocumented | §5: explicit boundary; recorded in SECURITY.md |

## Rev 8 findings → resolution (architecture pivot)

Revision 8's five blockers all came from the browser re-implementing CommonMark. Revision
9 removes that parser: `POST /internal-links/analyze` returns the exact mdast node at the
selection, using the parser the translation compiler already trusts. Rev 3–7 rows that
describe the removed client parser are historical.

| # | Finding | Resolution |
|---|---|---|
| 1 | Nested reference links edited as the outer link | §2/§3: mdast has no outer link; the analyzer returns the inner `link` or `text`; no client nesting logic |
| 2 | HTML blocks mid-paragraph/blank-spanning | §2/§3: the analyzer returns the `html` node; refused with byte identity |
| 3 | Container-blind fences/indented code | §2/§3: the analyzer returns the `code` node (all container forms); refused |
| 4 | `escapeLabel` mutates code-span/escape labels | §3: only `text` ranges are inserted; a code span makes the kind `code` and refuses; plain-text label escaping is escape-aware |
| 5 | Definition-line refusal unexercised/escape-blind | §2/§3: the analyzer returns `definition` (parser-exact), refused; real fixtures |

## Rev 9 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1 | Selection-to-kind was the leaf reading; reference labels/cross-paragraph selections became text; zero-length ranges unspecified | **Superseded by revision 12:** a non-empty selection and the deepest-containing-node rule; empty ranges are a 400. The intermediate precedence rules were removed. |
| B2 | `inlineCode` absent from the wire enum | §2/§3: enum includes `inlineCode`; the client refuses it like `code` |
| B3 | `\|` in a table cell breaks the row on insert/retarget | §3: `escapeDestination` and label escaping escape `\|`; `isEscapedDestination` rejects unescaped `\|`; tableCell insert/retarget tests |
| B4 | Analyzer module/shared helpers/parser dependency unspecified | §2: `site/src/lib/markdown-link-selection.ts` owns the only satteri import and the shared `labelEnd`/`markdownTitle`/`destinationRange`; compiler imports them back; exceptions → `other` |
| N1 | `translation_invalid_input` also means source rejection | §5: map to `translationLinksInvalid` only when the request carried `links` |
| N2 | Body limits disagree | §2: 1 MiB like `/gallery/analyze`, 100k chars; 413 → `linkEditInSource` |
| N3 | Snippet errors (`markdownToMdast` arg, `applyEdits`) | §3/§4: correct signatures and `applyGalleryEdits` |
| N4 | Label range convention undefined | §3: `labelStart` after `[`, `labelEnd` at `]`; removal slices it |
| N5 | Offset unit unpinned | §2/§3: UTF-16; non-ASCII/emoji test |
| N6 | SECURITY.md omits the analyzer | §6: same sentence as `/gallery/analyze` |

## Rev 10 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1a/B1b | Empty-range precedence and syntax-only ranges | **Superseded by revision 12:** Markdown requires a non-empty selection; empty ranges are a 400 and there is no cursor-only insertion. The deepest-containing-node rule has no boundary case. |

## Rev 12 simplification

| Change | Why |
|---|---|
| Markdown action requires a non-empty selection; empty shows `linkSelectText` and sends no request | Removes zero-length ranges, boundary precedence and cursor-inside-label insertion entirely |
| Analyzer: deepest containing node; if text, nearest interest ancestor wins; otherwise `other` | One deterministic rule, no leaf coverage, no formatting/container ambiguity |
| No URL-as-label branch in Markdown; the selection is always the label | Removes the unescaped-URL edge case from the Markdown path |
| Analyze route rejects `from === to` with 400 | The contract has no zero-length request |

## Rev 12 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| R1 | Client label escaping breaks a selection ending in `\` (and could mutate escapes) | §2/§3: the server computes and parse-verifies `label` for `text`; the client uses it verbatim; tests for trailing `\`, `a\*b`, table `\|` |
| R2 | Removing an inner link can make an outer literal bracket construct a link | §2/§3: `removalSafe` is a server reparse proof; unsafe removal refuses with byte identity; tests |
| N1 | `imageReference` omitted from the interest list | §2/§3: added; refused |
| N2 | Autolinks/GFM bare URLs have no fixture | §2/§3: fixture; locator failure → `other` |
| N3 | Wire union not enumerated | §2: explicit union |
| N4 | Module cycle risk | §2: analyzer owns `other`; does not import `TranslationError`; compiler imports pure helpers only |
| N5 | `linkSelectText` surface / multi-range | §3: host status/notice; `listSelections().length > 1` refuses |
| N6 | Markdown cursor-only regression | §6: `project-status.md` line |

## Rev 13 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1 | Label mapping splits an escape/entity unit; empty label not refused | §2: unit-aligned selection only (boundary inside a unit → `other`), empty/whitespace → `other`; label entity-encodes all ASCII punctuation (`escapeLabelText`/`escapeProse` rules) so emphasis/code/HTML/pipes cannot form; parse-verified; tests |
| B2 | Autolink/bare-URL link node vs mandatory link payload | §2/§3: `link` only when the bracket locator succeeds; autolinks and bare URLs → `other`; no undefined ranges reach the client; tests |
| B3 | Map built twice (server tested, browser builder untested) | §1/§2/§3/§5: `GET /internal-links` returns `links` from `translationLinkMap`; the client uses it verbatim; no browser builder |

## Rev 14 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1 | `positionedText` units skip blockquote/list continuation prefixes, so a cross-line text selection could delete `> ` | §2: the units must **exactly tile** `[from,to)` (`from === first.start`, `to === last.end`, contiguous); any gap/overhang → `other`; tests for blockquote/list cross-line vs single-line selections |

## Rev 15 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1a | A unit straddling the selection boundary (`Tom &amp;` selected `[0,5)`) passed tiling | §2: every intersecting unit must lie wholly inside `[from,to)` (no overhang); `[0,5)` → `other`, `[0,9)` → `text`; tests |
| B1b | The analyzer's ancestor container chain was unspecified; a synthetic unit could tile the `> ` prefix | §2: build `{quote}`/`{list, indent}` ancestors and pass them to `positionedText`; cross-line blockquote/list selections refuse; tests |

## Rev 16 findings → resolution

| # | Finding | Resolution |
|---|---|---|
| B1a | `positionedText` call omitted the compiler's CRLF normalization | §2: `normalizedValue = node.value.replace(/\r\n?/gu, '\n')`, exactly the compiler's `prose` path; CRLF entity test |
| B1b | Shared locator failure contract undefined after moving `labelEnd`/`markdownTitle` | §2: module-local `LinkLocatorError`; analyzer → `other`; compiler → `translation_unsupported_source`; no compiler import in the shared module |

## Failure handling

- Catalog read failure: `/internal-links` 500 (no partial JSON); picker falls back to
  free URL entry; translation prepare fails with `translationLinksFailed` and can be
  retried. Never a partial map.
- Unknown/malformed Markdown destination: unchanged + warning; translation still
  validates.
- Dialog 401: host `onUnauthed` guard redirects, like every admin fetch.
- Analyzer failure/`other`/invalid offsets: `linkEditInSource`, source byte-identical;
  no partial edit.
- Rollback: revert the branch; no data, schema or release state to restore.

## Limits / explicitly not done

- Raw inline HTML `<a href>` is warning-only (raw HTML is opaque to this compiler).
- No link-text prompt: Markdown uses the selected text as the label.
- Markdown link editing requires a non-empty text selection and one authenticated
  `/internal-links/analyze` round trip. Cursor-only insertion/editing is Visual-only; an
  empty selection shows `linkSelectText` and changes nothing.
  A failed request, an `other` kind, or a selection spanning non-text nodes refuses with
  `linkEditInSource` and leaves the source byte-identical; the user can select a single
  link or a plain-text range and retry.
- References, definitions, images, code blocks and HTML blocks are not editable through
  the Markdown link action (the analyzer identifies them); they remain editable in the
  Markdown source.
- Destinations without exactly one trailing-slash difference won't match; warn-only.
- The catalog keeps at most one **successful** fetch per locale per editor session
  (picker open or translation, whichever comes first); a rejected attempt is evicted
  and may be retried. A counterpart unpublished during the LLM call leaves the prepared
  destination and is not re-warned on validate.
- A map over 5 000 entries fails the request; nothing is truncated.
- Region links stay in the source language until a story of that region is live in the
  target locale — expected, not full coverage.
- No slug/URL moves; no new public route.

## Acceptance checklist

| Issue requirement | Implementation | Named verification |
|---|---|---|
| Internal picker + custom URL | §1, §2, §3 | `internal-links.test.ts`, `link-dialog.test.ts` |
| Visual and Markdown (button + Cmd/Ctrl+K) | §3 wiring | `editor-dom.test.ts`, `about-equipment-dom.test.ts`, `link-dialog.test.ts` |
| Locale-correct paths / 4 modes | §1 explicit language; `publicPath` | `internal-links.test.ts` (DE-primary, EN-primary, DE-only, EN-only) |
| Existing link pre-selected; empty clears | §3 | `link-dialog.test.ts`, `editor-dom.test.ts` |
| DE→EN / EN→DE remap (pages, built-ins, stories, journeys, regions) | §1, §4 | `article-translation.test.ts`, `internal-links.test.ts` |
| Home `<->` secondary both directions, both primary modes | §1, §4 | `article-translation.test.ts`, `internal-links.test.ts` (map passes the real validator) |
| External/fragment/mailto/tel/unmapped safe + warning | §4 | `article-translation.test.ts` negatives |
| Fingerprint accepts remap, rejects provider mutation | §4 two checks | `article-translation.test.ts` escape/tamper tests |
| Markdown destination is always valid CommonMark; Visual and Markdown agree | §3 | `link-dialog.test.ts` (per-case table, newline), `editor-rich-text.test.ts` (`/my%20page`) |
| No-edit Apply leaves an escaped destination byte-identical | §3 | `link-dialog.test.ts` (`link` kind with `[x](/a\)b)`, `[x](/a?b&amp;c)`) |
| Markdown link edits are parser-exact; the browser never parses Markdown | §3 | `link-analyze.test.ts` (satteri ground truth for every kind) |
| Images, references, definitions, code and HTML blocks are never rewritten | §3 | `link-analyze.test.ts` + `link-dialog.test.ts` (`other` kinds refuse, source byte-identical) |
| Title-bearing links keep their title; retarget changes only the destination | §3 | `link-analyze.test.ts` (destination range) + `link-dialog.test.ts` (`[x](/about/ "About")`, `[x](/a(b) "T")`, `[x](/a (b))`, `[x](</a b> "T")`) |
| Nested links resolve to the inner link or plain text, never the literal outer text | §3 | `link-analyze.test.ts` (`[a [b](/c) d](/e)` at `d` → text; inside → inner link) |
| Reference labels, cross-paragraph selections and syntax-only ranges are never treated as plain text | §3 | `link-analyze.test.ts` (`[alpha beta][ref]`, link+text, cross-paragraph, heading/task/table delimiter → refuse) |
| A selection inside a link label is a link, not text | §3 | `link-analyze.test.ts` (label selection → `link`; emphasis markers → `other`) |
| `inlineCode` is refused like `code` | §2/§3 | `link-analyze.test.ts`, `link-dialog.test.ts` |
| Insert/retarget inside a table cell preserves the row/cell structure | §3 | `link-dialog.test.ts` (`tableCell` with `\|` escaped, one parsed link) |
| Offsets are UTF-16 code units | §2/§3 | `link-analyze.test.ts` (`ä`/emoji before the selection) |
| Oversized bodies refuse, not 500 | §2 | `link-analyze.test.ts` / `server.test.ts` (413 → `linkEditInSource`) |
| Definitions used by images are not remapped | §4 | `article-translation.test.ts` (`[ref]: /img` + `![alt][ref]`) |
| Empty/multi-range selection sends no request and shows `linkSelectText` | §3 | `link-dialog.test.ts` |
| Text labels are server-computed and parse to the selected rendered text (trailing `\`, `a\*b`, table `\|`) | §2/§3 | `link-analyze.test.ts`, `link-dialog.test.ts` |
| Removing a link that would create an outer link is refused (`removalSafe:false`) | §2/§3 | `link-analyze.test.ts`, `link-dialog.test.ts` |
| Autolinks, bare URLs and image references refuse safely | §2/§3 | `link-analyze.test.ts` |
| A label boundary inside an escape/entity or an empty selection refuses | §2/§3 | `link-analyze.test.ts` (`Tom &amp; Jerry` selected `Tom &`, empty/whitespace → `other`) |
| Text labels require exact unit tiling with no overhang; cross-line container selections refuse | §2/§3 | `link-analyze.test.ts` (`Tom &amp;` `[0,5)` → `other`, `[0,9)` → `text`; `> one\n> two` → `other`; one line → `text`; list continuation) |
| CRLF text tiles like LF; shared locator errors map per caller | §2/§3 | `link-analyze.test.ts` (CRLF+entity), `article-translation.test.ts` (locator throw → `translation_unsupported_source`) |
| One server map builder feeds the client | §1/§2 | `internal-links.test.ts` (GET `links`), `link-dialog.test.ts` (uses verbatim) |
| Catalog retry after a failed fetch | §3 | `link-dialog.test.ts` (reject then succeed), `editor-dom.test.ts` prepare retry |
| Legacy/unknown page keys excluded | §1 | `internal-links.test.ts` fake page store |
| Journey draft members cannot create a live route | §1 | `internal-links.test.ts` snapshot-member case |
| `publishedLocales` uses committed snapshots only | §1 | `posts.test.ts`, `pg.integration.test.ts` (unpublish/rename cases) |
| Map remaps before the picker is opened | §3, §5 | `link-dialog.test.ts` (`map()` awaits fetch), `editor-dom.test.ts` translation |
| i18n DE+EN, keyboard/ARIA | §3 copy + semantics | i18n completeness tests (distinct DE/EN), `link-dialog.test.ts` |
| Route integration | §2 | `server.test.ts` (401, locale 400, shape), `reserved-routes.test.ts` parity |
| Analyzer integration | §2 | `server.test.ts` / `link-analyze.test.ts` (401, invalid body/offsets 400, every kind) |
| No translation store reads | §5 | existing `server.test.ts:453-494` unchanged |

## Verification plan

- `site/`: targeted `article-translation` then full `npm test`; `npx astro check`.
- `uploader/`: `npx tsc --noEmit`; targeted `internal-links`, `link-analyze`,
  `link-dialog`, `editor-dom`, `editor-translation-engines`, `editor-rich-text`,
  `editor-gpx`, `about-equipment-dom`, `pages-admin-dom`, `posts`, `server`,
  `reserved-routes`; then full `npm test`.
- Postgres suites (`pg.integration.test.ts`) skip without `TEST_DATABASE_URL`; CI on the
  PR head (incl. test-merge commit) is authoritative and adds the `publishedLocales`
  projection assertions.
- Browser: run the admin stack if available; otherwise the DOM harnesses and a reported
  visual-verification limitation.
