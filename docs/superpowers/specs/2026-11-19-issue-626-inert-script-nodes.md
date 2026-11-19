# Issue 626: `innerHTML` script injection assertions in the DOM harness

Status: design revision 3, pending final review. Revisions 1 and 2 were reviewed and
returned changes; see *Approval record*. Risk: **normal**. Test files only: the DOM harness
and the one uploader suite that tests it.

Parent: [#626](https://github.com/laboef1900/wanderlust-studio/issues/626).
Predecessor: the one-pass harness parser of
[#623](https://github.com/laboef1900/wanderlust-studio/issues/623), which recorded the
defect as "considered and rejected" in section D1.

## Outcome and scope

A `</script>`-terminated `<script>` assigned through an element's `innerHTML` becomes an
inert script node in that element's harness subtree, as it does in a browser. Every
injection assertion written as `querySelectorAll('script')` or `querySelector('script')`
over that subtree therefore sees it, where today the node is dropped and the assertion
cannot fail for markup that reached the page that way.

The three assertions named by the issue keep their text. Their hostile strings do not
reliably reach the DOM through `innerHTML` today: the gallery renderer displays only
location and reason copy, never the caption value; the translation patch values land in
`<textarea>` `.value`s. A faithful app mutation therefore cannot make those two assertions
fail, and the accepted criterion is the one the issue is titled after: **the assertion form
is sensitive to an inert node created by assigning that path's hostile string through
`innerHTML`**. Revision 1 claimed instead that each suite's own code path could be mutated
faithfully; that claim was wrong and is corrected below.

For the review suite the union assertion also matches `img` and `[onerror]`, which already
worked before this issue, so evidence for it isolates the script member:
`root.querySelectorAll('script')`, or the union assertion after a mutation that inserts only
the hostile string's `<script>alert(2)</script>` through `innerHTML`. The suite's own
assertion text is unchanged and its `img`/`[onerror]` behaviour is not what this issue
repairs.

Files: `uploader/test/editor-dom-harness.ts`, `uploader/test/editor-dom-harness.test.ts`,
this note, one sentence in the #623 note. No production code, no assertion in the two
affected suites, no schema, data, route, dependency or security-model change.

## Acceptance checklist

| Requirement | Implementation | Evidence |
|---|---|---|
| `root.querySelectorAll('script')` (about-gallery-warnings) can see a script node made by `innerHTML` from that suite's hostile caption `capton="<script>bad</script>"` | D1, inert node | D3 probe 1. No faithful app mutation exists (the renderer never receives the caption); a synthetic one is recorded in *Approval record* only as a mechanical check |
| `root.querySelectorAll('script')` (the script member of the editor-dom review test's union selector) can see `<script>alert(2)</script>` from that suite's hostile string inserted through `innerHTML` | D1 | D3 probe 2, with the script member isolated (the `img` member already matched before this issue). A dev-only mutation appends a container with `innerHTML = '<script>alert(2)</script>'` to `reviewSemantic`; it fails the union assertion at `editor-dom.test.ts:3640` only after this change. The natural `critique.innerHTML` swap already fails the earlier `textContent` assertion at `:3638`, so it cannot demonstrate the selector |
| `dialog.querySelector('script')` (editor-dom translation test) can see `<script>example</script>` inserted through `innerHTML` | D1 | D3 probe 3. No faithful app mutation exists (patch values go to textarea `.value`s); a synthetic one is recorded only as a mechanical check |
| All uploader suites pass without loosening an assertion | D1 keeps the page-load path identical; nothing is skipped or deleted | full `npm test`; only the harness test that pins today's defect changes |

The D3 probes use each suite's exact hostile string and the exact assertion expression, with
the script member isolated for the union form, on the element that holds the assigned
markup.

## Design

### D1. Two modes in `parseMarkup`

`parseMarkup` keeps one left-to-right pass. The collector parameter is renamed
`pageScripts` (today `scripts`) and decides what a terminated script start tag does. The
branch tests the collector's **presence** (`if (pageScripts) …`), never its length, so an
empty collector still means page load.

- **Page load** (`editorDocument(html)` passes the collector): exactly today's behaviour.
  The element is skipped and pushed to `pageScripts` with its decoded `src` (null when
  absent) and its raw text. It leaves no node and keeps the pending text run open.
- **`innerHTML` assignment** (no collector): the element is created as an inert node. Its
  attributes are parsed exactly as for any other element, its content becomes one `#TEXT`
  child holding the raw source between the start tag and the end tag (no entity decoding,
  no markup parsing), it is appended at the current position, the pending text run is
  flushed first, and it is not pushed on the open-element stack.

What counts as a script start tag and as its end tag is unchanged from #623: the existing
`^<([\w-]+)` capture compared ASCII-case-insensitively with `script`, and the first
`</script>` (those nine characters, any ASCII case) after the start tag. `</script >`,
`</script/>` and other spellings do not end it; such an element stays an ordinary element
with parsed content, as today.

Known harness limitation, unchanged by this issue: a browser does end the element at
`</script >` and `</script/>`. The harness deliberately keeps the exact nine-character end
tag because widening it would change which page-load scripts are skipped (#623, D1). On
the `innerHTML` path the visible consequence is that `<script>a</script >b</script>c`
yields a `SCRIPT` node with raw text `a</script >b` and then text `c`, where a browser has
`SCRIPT["a"]` and text `bc`; the script node is still visible to every assertion, which is
the property this issue needs. No suite feeds such an input.

An unterminated `<script>` (no end tag after it) keeps today's handling in both modes: an
ordinary element whose content is parsed as markup, left in the tree. A browser treats the
rest of an unterminated script as raw text, but the harness cannot model that without
changing page loads, and no suite input has that shape.

An empty script gets no text child, as a browser's empty element has none. The harness
never executes scripts, so "inert" means present in the tree, not run.

### D2. Serialization of the inert node, by provenance

`EditorElement` gains a constructor flag, `rawText`, that only the `innerHTML` path sets on
the script element it creates. It is provenance, not shape: a page-load-created `SCRIPT`
element, including the unterminated-script element that has element children, keeps
today's escaped serialization.

For a `rawText` element, both getters emit `textContent` unescaped: a browser serializes
script text without escaping it, so `host.innerHTML = '<script>if (a < b)</script>'`
round-trips as written and `script.innerHTML` is the raw text. Every other element is
unchanged. Nothing infers provenance from children, from the tag alone, or from the
markup string.

### D3. Tests

`editor-dom-harness.test.ts`:

- The existing `innerHTML` block asserted the defect (no script node); it now asserts a
  split text run around the node, the node with its raw content, and `querySelector`.
- Three probes shaped exactly like the affected assertions, on each suite's own hostile
  string, assigned through `innerHTML`, with the script member isolated where the suite's
  selector is a union:
  - `root.querySelectorAll('script')` for `capton="<script>bad</script>"`;
  - `root.querySelectorAll('script')` for
    `<img src=x onerror="alert(1)"><script>alert(2)</script>`, because the suite's
    `img, script, [onerror]` union already matched `img` before this issue;
  - `dialog.querySelector('script')` for `<script>example</script>`.
- Host-level tests for the mode split and the node shape:
  - an `innerHTML` assignment on an element of a page-loaded document leaves
    `dom.scripts` unchanged;
  - a script start tag inside an element left open before it lands in that innermost open
    element;
  - an empty assigned script has `childNodes.length === 0`;
  - the inert node's `outerHTML`/`innerHTML` round-trip raw text (`<b>`, `&amp;`, `<`);
  - attribute order and a boolean attribute on the inert node;
  - `outerHTML` of an unterminated page-load script is byte-identical to today
    (D2's provenance boundary);
  - a nested script on a page load (`x<script>a<script>b</script>c</script>z`): one
    collected script with text `a<script>b`, no node, `xc`/`z` text runs.

The two affected suites (`about-gallery-warnings.test.ts`, `editor-dom.test.ts`) keep their
assertions unchanged; they are the regression check for D1's page-load path and for the app
code that renders hostile text with `textContent`. `editor-rich-text.test.ts` has a
`querySelector('script')` assertion that this issue does not affect (that suite mounts
`happy-dom`, not the harness) and that stays green.

### D4. Documentation

This note, and one sentence in the #623 note's D1 "Considered and rejected" paragraph
recording that #626 implemented the option it left open, with the behaviour boundary.

## Preservation invariants

1. For every page load, the tree, `dom.scripts` and serialization are unchanged: the
   page-load branch evaluates the same tokens and appends the same nodes as today, and D2
   keys on provenance, not on a node's shape.
2. No production file changes. No assertion in `about-gallery-warnings.test.ts` or
   `editor-dom.test.ts` changes, and no test is skipped, deleted or loosened.
3. The only changed expectation is the harness test that pinned the defect; it becomes
   browser-faithful, which is stricter.
4. No new dependency, suppression, or CodeQL configuration.

## Failure handling

The harness has one new observable consequence: a script element inside an `innerHTML`
subtree now contributes its raw text to that subtree's `textContent` and appears in
`children`. A suite that fails because of that is reporting a script literal reaching the
DOM through `innerHTML`. Find the caller before touching the assertion. The caller is
either application code that should render text with `textContent` (fix it, do not loosen
the test) or a test's own `innerHTML` fixture (no production `innerHTML` string contains
`<script` today; a fixture would be the suite's own markup and must be reconsidered
explicitly). A spike of D1 against the full uploader unit suite left exactly one failing
test, the harness test that pins the defect; `editor-dom`, `editor-rich-text` and
`about-gallery-warnings` passed.

Malformed markup handling is untouched: comments, `<!…>` tokens, a dropped `<`, end tags
without a match and unterminated constructs behave as today.

## Tests and verification

- Uploader: `npm run typecheck`, `npm test`.
- Site: no file changes; its suites are CI's regression signal. `astro check` needs a
  database and no site type was touched.
- Mutation evidence, produced during development and reverted (reported, not committed),
  labelled faithful or synthetic for each suite as in the acceptance checklist and
  *Approval record*.
- Not applicable: browser and end-to-end checks, `npm run build` (no page, bundle or
  production code change).
- Required checks on the final head: `uploader · typecheck + tests`
  (and `site · tests + astro check`, unchanged).

## Work breakdown and dependencies

| Task | Owner | Files | Depends on |
|---|---|---|---|
| T0 | independent reviewer | this note, harness source | none |
| T1 | one implementation worker | `uploader/test/editor-dom-harness.ts`, `uploader/test/editor-dom-harness.test.ts`, this note | T0 approval |
| T2 | coordinator (integration owner) | verification, #623 note sentence, commits, pull request | T1 |
| T3 | independent reviewer, not the implementer | complete pull request diff | T2 |
| T4 | coordinator | fixes and final verification | T3 |

All tasks run in the issue worktree on `feature/626-inert-script-nodes`; only T1 writes
harness code, so no two writers share a file. T0 and T3 must not be the implementation
author.

## Recovery

No data, schema, configuration or production code is touched. Recovery is a revert of the
pull request.

## Requirement exception

None needed. `CLAUDE.md` requires explicit human approval only for high-risk changes, and
this change touches none of the listed high-risk paths (test harness only); the owner's
brief for #626 explicitly authorizes independent AI approval of the design in place of any
design-approval pause a repository rule might impose. Branch protection and CI remain in
force.

## Approval record

### Revision 1 (commit `1d9a60a`): changes required

Reviewer: independent Orca worker (dispatch `ctx_22636b1fe468`), agent `omp`, model
`deepseek-flash` (OMP pinned model; the reviewer's terminal banner reports that model).
The reviewer did not author the design; it edited nothing in the checkout and probed in
`/tmp/probe626*` against a scratch copy of D1+D2 and the unmodified baseline.

Verified by the reviewer: current code matches the note's baseline; D1's page-load branch
is behaviour-preserving across 16 probe inputs (tree, `dom.scripts`, `textContent`);
D1's `innerHTML` path matches parse5 for raw undecoded text, attributes, text runs, no
stack push, empty script, nested script, script inside an open `<p>`, document order; the
affected suites pass with the scratch D1; the full uploader unit run fails only the harness
test that pins the defect; parse5 shows `</script >` and `</script/>` terminate in
browsers, script text serializes raw, and an empty script has no children.

| Finding | Severity | Disposition |
|---|---|---|
| B1: D2 inferred provenance from "has element children", which changes `outerHTML` of an unterminated page-load script and breaks invariant 1 | blocking | Accepted. D2 now uses an explicit `rawText` flag set only by the `innerHTML` path; a page-load unterminated script serializes as today; tests pin both. |
| B2: acceptance evidence was wrong for the gallery and translation suites, and the natural review mutation fails an earlier `textContent` assertion | blocking | Accepted. Outcome and acceptance table now state the criterion as assertion-form sensitivity proven by D3 probes; the review mutation that reaches the selector assertion is specified; gallery and translation mutations are labelled synthetic and no longer claimed as faithful. |
| N1: browsers terminate `</script >` and `</script/>`, so "stays visible … exactly as today" needs the limitation stated | non-blocking | Accepted. D1 records the divergence, its consequence on the `innerHTML` path, and that the set of skipped page-load scripts is unchanged. |
| N2: D2's fallback claim ignored the unterminated `innerHTML` case; the inert node's own `innerHTML` escaped its text | non-blocking | Accepted. The flag removes the fallback; both getters emit raw for the inert node. |
| N3: missing tests (page-loaded `dom.scripts` unaffected, open-element placement, empty node shape, round-trip, attributes) | non-blocking | Accepted. Added to D3. |
| N4: no nested-script page-load test exists | non-blocking | Accepted. Added, and the false coverage claim removed. |
| N5: parameter rename undecided; branch must test presence | non-blocking | Accepted. Renamed to `pageScripts`; presence test required. |
| N6: a failing suite can also come from a test's own fixture | non-blocking | Accepted. Failure handling now separates application callers from suite fixtures. |

### Revision 2 (commit `82d1f2b3ef`): changes required — one residue

Same reviewer and worker (dispatch `ctx_beb4ea70130b`, agent `omp`, model
`deepseek-flash`), 2026-11-19. The reviewer implemented revision 2's D1+D2 in a scratch copy
(`rawText` flag default `false`, set only in the `innerHTML` branch; collector renamed
`pageScripts` and tested by presence) and diffed 16 page-load probes against the revision 1
baseline: tree, `dom.scripts`, `textContent`, `outerHTML`, `innerHTML` and `childNodes`
byte-identical, including B1's failure case. It confirmed the five missing tests, the
nested-script expectation, the script-member isolation question, and re-ran the full
uploader unit suite (5445 passed; only the pinned harness test fails).

| Finding | Severity | Disposition |
|---|---|---|
| B1′: the review-suite evidence was not discriminating — the union selector already matched `img` before this issue, so neither the probe nor the specified container mutation isolated the script member | blocking | Accepted. Outcome, acceptance row 2 and D3 probe 2 now isolate `querySelectorAll('script')`; the mutation inserts only `<script>alert(2)</script>`; the suite's union assertion stays unchanged. |
| N1′: "the exact assertion expression" no longer holds for the union form | non-blocking | Accepted. Wording now says "with the script member isolated for the union form". |
| N2′: two test files hold the three assertions, not three suites | non-blocking | Accepted. D3 names the two affected suites and records `editor-rich-text` as a side-effect green. |

### Revision 3 (commit `0413faae17`): approved

Same independent reviewer and worker (dispatch `ctx_7730c383dab2`, agent `omp`, model
`deepseek-flash`), 2026-11-19. Verdict: **approved**, no blocking finding. The reviewer
diffed `82d1f2b3ef..0413faae17` (note only), re-ran the acceptance probes against the
unmodified harness and a scratch implementation of this design, and re-ran the revised
script-only mutation.

- Gallery `querySelectorAll('script')`: 0 before, 1 after, for `capton="<script>bad</script>"`.
- Review `querySelectorAll('script')`: 0 before, 1 after; the suite's union selector: 1
  before (the `img` match), 2 after (the `SCRIPT` node).
- Translation `querySelector('script')`: `null` before, a node after, for
  `<script>example</script>`.
- The dev-only container mutation with `innerHTML = '<script>alert(2)</script>'` passes the
  whole review test on the unmodified harness and fails `editor-dom.test.ts:3640` only with
  this design's harness.
- D1, D2, invariants 1–4, failure handling, tests, the requirement exception and the
  revision 1 record are byte-identical to revision 2, whose 16-input page-load differential
  and 5445-passed uploader run therefore stand.

One non-blocking correction, applied in T2's docs pass above: the rich-text suite mounts
`happy-dom` and never imports the harness, so its `querySelector('script')` assertion is
unaffected rather than newly effective.

Implementation may start; D1 and D2 must land exactly as revised (`rawText` flag default
`false`, set only by the `innerHTML` branch; `pageScripts` tested by presence).
