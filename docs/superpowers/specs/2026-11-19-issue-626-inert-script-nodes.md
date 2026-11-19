# Issue 626: `innerHTML` script injection assertions in the DOM harness

Status: design revision 1, pending independent AI review. Risk: **normal**. Test files
only: the DOM harness one uploader suite and its two dozen consumers build on.

Parent: [#626](https://github.com/laboef1900/wanderlust-studio/issues/626).
Predecessor: the one-pass harness parser of
[#623](https://github.com/laboef1900/wanderlust-studio/issues/623), which recorded the
defect as "considered and rejected" in section D1.

## Outcome and scope

A `<script>…</script>` assigned through an element's `innerHTML` reaches that element's
inert script node in the harness, as it does in a browser. The three injection assertions
named by the issue then fail if the code under test renders its hostile string that way,
where today they cannot.

Files: `uploader/test/editor-dom-harness.ts`, `uploader/test/editor-dom-harness.test.ts`,
this note, one sentence in the #623 note. No production code, no assertion in the three
suites, no schema, data, route, dependency or security-model change.

## Acceptance checklist

| Requirement | Implementation | Evidence |
|---|---|---|
| The `about-gallery-warnings.test.ts` assertion fails when its hostile caption reaches the page through `innerHTML` | D1, inert script node | D3 harness probe; dev-only mutation of the warning renderer (reported, not committed) |
| The `editor-dom.test.ts` review assertion (`querySelectorAll('img, script, [onerror]')`) fails likewise | D1 | D3 harness probe; dev-only mutation of the review card renderer |
| The `editor-dom.test.ts` translation assertion (`querySelector('script')`) fails likewise | D1 | D3 harness probe; dev-only mutation of the translation renderer |
| All uploader suites pass without loosening an assertion | D1 keeps the page-load path identical; nothing is skipped or deleted | full `npm test`; only the harness test that pins today's defect changes |

## Design

### D1. Two modes in `parseMarkup`

`parseMarkup` keeps one left-to-right pass. The collector parameter (`pageScripts`, today
`scripts`) decides what a terminated script start tag does:

- **Page load** (`editorDocument(html)` passes the collector): exactly today's behaviour.
  The element is skipped and pushed to `scripts` with its decoded `src` (null when absent)
  and its raw text. It leaves no node and keeps the pending text run open, so text around
  it stays one run.
- **`innerHTML` assignment** (no collector): the element is created as an inert node. Its
  attributes are parsed exactly as for any other element, its content becomes one `#TEXT`
  child holding the raw source between the start tag and the end tag (no entity decoding,
  no markup parsing), it is appended at the current position, and the pending text run is
  flushed first, so text before it and after it are separate runs as in a browser. The
  element is not pushed on the open-element stack: its content can never open elements.

What counts as a script start tag and as its end tag is unchanged from #623: the existing
`^<([\w-]+)` capture compared ASCII-case-insensitively with `script`, and the first
`</script>` (those nine characters, any ASCII case) after the start tag. `</script >`,
`</script/>` and other spellings do not end it; such an element stays an ordinary element
with parsed content, and stays visible to the assertions, exactly as today.

An unterminated `<script>` (no end tag after it) keeps today's handling in both modes: an
ordinary element whose content is parsed as markup, left in the tree. A browser treats the
rest of an unterminated script as raw text, but the harness cannot model that without also
changing page loads, and no suite input has that shape.

An empty script gets no text child, as a browser's empty element has none. The harness
never executes scripts, so "inert" means present in the tree, not run.

### D2. Serialization of a script element

`outerHTML` emits a script element's text raw (a browser serializes script text without
escaping it), so `host.innerHTML = '<script>if (a < b)</script>'` round-trips as written.
The fallback is today's escaped `innerHTML` when the element has element children, which
only the unterminated page-load case produces, so page markup is serialized as today.

### D3. Tests

`editor-dom-harness.test.ts`:

- The existing `innerHTML` block asserted the defect (no script node); it now asserts a
  split text run around the node, the node and its raw content, and `querySelector`.
- Three probes shaped exactly like the affected assertions, on each suite's own hostile
  string, assigned through `innerHTML`:
  - `root.querySelectorAll('script')` is not empty for the gallery caption;
  - `root.querySelectorAll('img, script, [onerror]')` is not empty for the review text;
  - `dialog.querySelector('script')` is not `null` for the translation excerpt.
- Script attributes (`src`, case variants), document order inside the assigned fragment,
  raw text that would be markup (`<b>`, `&amp;`), content that holds a comment opener,
  an empty script, and a nested script stay covered by the page-load tests and gain the
  `innerHTML` counterpart where the modes can differ.

The three affected suites keep their assertions unchanged; they are the regression check
for D1's page-load path and for the app code that renders hostile text with `textContent`.

### D4. Documentation

This note, and one sentence in the #623 note's D1 "Considered and rejected" paragraph
recording that #626 implemented the option it left open, with the behaviour boundary.

## Preservation invariants

1. For every page load, the tree, `dom.scripts` and serialization are unchanged: the
   page-load branch evaluates the same tokens and appends the same nodes as today.
2. No production file changes. No assertion in `about-gallery-warnings.test.ts` or
   `editor-dom.test.ts` changes, and no test is skipped, deleted or loosened.
3. The only changed expectation is the harness test that pinned the defect; it becomes
   browser-faithful, which is stricter.
4. No new dependency, suppression, or CodeQL configuration.

## Failure handling

The harness has one new observable consequence: a script element inside an `innerHTML`
subtree now contributes its raw text to that subtree's `textContent` and appears in
`children`. A suite that fails because of that is reporting real markup reaching the DOM
through `innerHTML`; the response is to establish whether the code under test should have
used `textContent`, not to loosen the assertion. A spike of D1 against the full uploader
unit suite (reported in the pull request) left exactly one failing test, the harness test
that pins the defect; `editor-dom`, `editor-rich-text` and `about-gallery-warnings` passed.

Malformed markup handling is untouched: comments, `<!…>` tokens, a dropped `<`, end tags
without a match and unterminated constructs behave as today.

## Tests and verification

- Uploader: `npm run typecheck`, `npm test`.
- Site: no file changes; its suites are CI's regression signal. `astro check` needs a
  database and no site type was touched.
- Mutation evidence, produced during development and reverted (reported, not committed):
  each of the three assertions fails when its own hostile string is assigned via
  `innerHTML` in the code that test exercises.
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
| T3 | independent reviewer, same worker as T0 or another that did not implement | complete pull request diff | T2 |
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

To be completed by the independent design review before implementation.
