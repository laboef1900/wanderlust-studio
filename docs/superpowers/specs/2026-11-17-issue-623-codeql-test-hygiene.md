# Issue 623: CodeQL test-suite and DOM-harness hygiene

Status: design revision 1, awaiting independent review (see *Approval record*). Risk:
**normal**. Test files only; the one non-mechanical change is the markup parser of the DOM
harness that 20 uploader suites build their assertions on.

Parent: [#623](https://github.com/laboef1900/wanderlust-studio/issues/623). Children:
[#610](https://github.com/laboef1900/wanderlust-studio/issues/610) (alerts 6, 7, 8, 9),
[#612](https://github.com/laboef1900/wanderlust-studio/issues/612) (alerts 11, 12),
[#608](https://github.com/laboef1900/wanderlust-studio/issues/608) (alert 4),
[#617](https://github.com/laboef1900/wanderlust-studio/issues/617) (alerts 20, 21, 22, 23),
[#616](https://github.com/laboef1900/wanderlust-studio/issues/616) (alert 19),
[#611](https://github.com/laboef1900/wanderlust-studio/issues/611) (alert 10).
No child has sub-issues; none is closed. Base: `dev` at `929cd3f`.

## Outcome and scope

Remove the 13 code-scanning alerts in test code without weakening any assertion: every
suite keeps asserting what it asserts today, on the same inputs, with the same results.

Out of scope: production code (`uploader/src`, `uploader/public`, `site/src` outside
`*.test.ts`), the production warning epic #622 (#609, #613, #619, #620), CodeQL
configuration, query exclusions and suppression comments, and unflagged siblings of the
flagged lines (the other `lastIndexOf('<script>')` slices, the other interpolated
`vm.runInContext` strings). No schema, data, dependency, slug or route change.

## Trust boundaries

None is crossed: every flagged line reads a repository file or a fixture built in the
test. The findings are not exploitable. The consequence that matters is indirect: the
harness parser decides what `querySelector('img')` and similar injection assertions can
see, so a parser regression could silently blunt security assertions in the suites that
use it. That is why D1 carries explicit invariants and differential evidence.

## Design

### D1. #610 alert 8, #612 alerts 11 and 12: one-pass harness parser

`uploader/test/editor-dom-harness.ts`, `parseMarkup`. Today it removes terminated comments,
then terminated script elements, each with a regular-expression `replace`, and tokenizes
what is left with `/<[^>]+>|[^<]+/g`. The new parser makes one left-to-right pass over the
original string with a cursor and never rewrites it:

1. At `<!--` with a later `-->`: skip through `-->`. No node. The pending text run is kept.
2. Otherwise take the next token with the same two alternatives as today (`<[^>]+>` or
   `[^<]+`, applied at the cursor). A `<` that starts neither is dropped, as the global
   match drops it today, and ends the pending text run.
3. A text token extends the pending text run. The run becomes one `#TEXT` node (decoded
   once, as today) when the next node-producing or dropped token arrives and at the end.
4. A start-tag token whose tag name (the existing `^<([\w-]+)` capture) is `script`,
   compared ASCII-case-insensitively, and that has an end tag later in the string: skip
   through that end tag. No node; the pending text run is kept. The end tag is the first
   `</script` (any ASCII case) followed by whitespace, `/` or `>`, through the next `>`.
5. Everything else is unchanged: `<!…>` tokens are dropped, end tags pop to the matching
   open element, attributes, void elements and self-closing handling are as today. A
   `script` start tag with no end tag stays an ordinary element whose content is parsed as
   markup, as today; an unterminated `<!--` is dropped up to the next `>`, as today.

The comment delimiters and the script end tag are found with `startsWith`/`indexOf` and a
case-folded slice comparison. After the change no regular expression in the harness names
`script` or a comment delimiter, and no `replace` removes markup.

Rule 4 optionally records the element: `parseMarkup` takes an optional collector, and
`editorDocument()` returns it as

```ts
/** Script elements of the parsed document, in document order. They are not in the tree. */
scripts: readonly { src: string | null; text: string }[]
```

`src` is the decoded `src` attribute read by the existing attribute pattern (null when
absent); `text` is the raw content between the start tag and the end tag. The `innerHTML`
setter passes no collector.

Intended differences from today, all on inputs no suite feeds the parser (the differential
run below proves that for the current suites):

| # | Input shape | Today | New |
|---|---|---|---|
| 1 | `<!--` inside script content, `-->` after the script | comment removal eats the markup between them | script content is opaque; markup after the script is kept |
| 2 | end tag `</script >`, `</SCRIPT x>` | not an end tag for the removal; the element and its content stay in the tree | ends the script element |
| 3 | pieces around a removed comment or script that join into a tag (`<scr<script></script>ipt>`, `<!<!-- -->-- -->`) | the joined text is tokenized: a `SCRIPT` node or a new comment appears | never joined |
| 4 | `<script-x>` | treated as a script start (`\b`) | ordinary element `SCRIPT-X` |
| 5 | comment delimiters inside a tag token (`<a title="<!-- x -->">`) | removed before tokenizing | part of that token |

Considered and rejected: keeping parsed `<script>` elements in the tree, as a browser's
`innerHTML` does. It would make the `script` half of three existing injection assertions
(`about-gallery-warnings.test.ts` and two in `editor-dom.test.ts`, each a
`querySelector('script')` after hostile input) effective, which today it is not for markup
assigned through `innerHTML`, but it changes `textContent`, `children` and serialization
for every suite that parses a full page. That is a behavior change beyond this epic; it is
recorded as an observation for the owner, not implemented.

### D2. #610 alerts 7 and 9: Desk page scripts from the harness

`uploader/test/build-reporting-dom.test.ts` and `uploader/test/onboarding-dom.test.ts` both
parse `public/index.html` with `editorDocument` and then re-scan the same string with a
script-matching pattern. They iterate `dom.scripts` instead, keeping the loop body:
skip `/admin/editor-image-copy.js`, run the file behind `src` or the inline `text`.
`public/index.html` has only `<script src="…">` and one inline `<script>`, no comments, so
the list equals today's matches (checked in the differential run).

### D3. #610 alert 6: Astro client script slice

`site/src/scripts/travel-map.test.ts`, `mount`: take the text between the first
`<script>` and the first `</script>` after it with `indexOf` and `slice`, and throw a named
error when either is missing (today a missing script is a `TypeError` on `null`). The two
`replace` calls that drop imports are unchanged.

### D4. #608 alert 4: no code string for the language fixture

`uploader/test/journeys-admin-dom.test.ts`, `catalogue`: read the `SiteLanguage` object
out of the context and assign `get` as a function that calls its `accept` with the fixture
object. No source text is built. `accept` (`public/language.js`) only reads its argument
and copies it (`Array.isArray`, `Set`, spread), so an object from the test realm behaves
like the literal evaluated in the context today.

### D5. #611 alert 10: decode the ampersand last

`uploader/test/publish-gate.test.ts`, the oracle: decode `&#x22;` before `&#x26;`. Today's
order turns the serializer's `&#x26;#x22;` (a literal `&#x22;` in a URL) into `"`. The
oracle gets stricter, not looser. One table row with such a URL is added if the gate and
the corrected oracle agree on it and it fails under the old order; otherwise the worker
reports why and adds none.

### D6. #616 alert 19: count literal occurrences

`uploader/test/preview.test.ts` line 60: count occurrences of the literal
`href="${src}-1600.webp"` (`split(...).length - 1`) instead of building a pattern from a
URL. The expected count stays 6. The unescaped `.` no longer matches any character, so the
assertion is stricter. Line 58 (a pattern built from a label, not flagged) is unchanged.

### D7. #617 alerts 20 to 23: compare parsed hosts, not URL prefixes

- `site/src/lib/body-images.test.ts`: the linked-image branch keys on the row's
  `parent === 'a'`. Exactly the two rows containing the link have that parent.
- `uploader/test/admin-actions-dom.test.ts` line 3252: the mixed-content fixture answers
  for host `lan.example` by parsing the URL (no throw on an unparsable value) and comparing
  `hostname`.
- Lines 4368 and 4423: "the page did not contact the provider" compares the parsed
  `hostname` of each request with `api.anthropic.com` / `api.openai.com`. Same-origin
  requests are relative URLs and must not throw. Any scheme or port on the provider host
  still fails the assertion; a different host that merely starts with the same characters
  no longer counts as the provider.

## Preservation invariants

1. No file outside the nine test files, one new harness suite and the docs changes.
2. Every existing assertion stays, with the same expected value. No test is skipped,
   deleted or loosened; D5, D6 and D7 only narrow what passes.
3. For every string the current suites pass to `parseMarkup` (page loads and `innerHTML`
   assignments), the resulting tree is identical to today's: same nodes, order, attributes
   and text runs.
4. The scripts the two Desk suites execute, and their order, are identical to today's.
5. No new dependency, no suppression comment, no CodeQL configuration or query exclusion.
6. The flagged patterns are not reintroduced in tests or fixtures (tests are scanned too).

## Failure handling

D1 has no new failure path: malformed markup degrades as today (rules 2 and 5). D3 throws
a named error instead of a `TypeError`. D7's URL parsing must not throw on relative or
partial values. The rest are pure expression replacements.

## Tests

- New `uploader/test/editor-dom-harness.test.ts`, asserting trees through the public
  harness surface (`querySelector`, `textContent`, `childNodes`, `scripts`), not parser
  internals: comments and scripts leave no node and do not split a text run; script tags in
  any ASCII case, with attributes, and with `</script >`; `scripts` order, `src` and raw
  `text`; unterminated comment and unterminated script keep today's result (the markup
  after an unclosed `<script>` stays visible); the five differences above, including the
  two nested inputs from the alerts producing no `SCRIPT` node; the `innerHTML` setter path.
- D2 to D7 are covered by the suites they change; the full uploader and site runs are the
  regression check for invariant 2.

Evidence produced during development and reported, not committed:

- Differential run: the old `parseMarkup` kept beside the new one, both run on every call
  of the complete uploader unit run, serialized trees compared. Report calls compared and
  mismatches (expected 0); any mismatch is investigated before completion.
- `dom.scripts` for `public/index.html` equals the old pattern's matches (count, order,
  `src`, text).
- D5: the added row fails with the old order and passes with the new.

## Verification

- Uploader: `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` against a disposable
  Postgres 18 on an isolated port.
- Site: `npm test`, `npx astro check` against the same disposable database.
- Not applicable: browser and end-to-end checks, `npm run build` (no production, page or
  bundle change). CI still runs them on the pull request.
- CodeQL on the pull request: alerts 4, 6 to 12 and 19 to 23 not reported on the merge
  ref and no alert introduced. The alerts close when `dev` is rescanned after merge.
- Required checks on the final head: `site · tests + astro check`,
  `uploader · typecheck + tests`.

## Work breakdown and dependencies

| Task | Issues | Files | Depends on |
|---|---|---|---|
| T0 | all | design review of this document | none |
| T1 | #610 (7, 8, 9), #612 | `uploader/test/editor-dom-harness.ts`, new `editor-dom-harness.test.ts`, `build-reporting-dom.test.ts`, `onboarding-dom.test.ts` | approval |
| T2 | #610 (6), #608, #611, #616, #617 | `site/src/scripts/travel-map.test.ts`, `site/src/lib/body-images.test.ts`, `uploader/test/journeys-admin-dom.test.ts`, `publish-gate.test.ts`, `preview.test.ts`, `admin-actions-dom.test.ts` | approval |
| T3 | all | integration, this spec, `docs/claude/project-status.md`, full verification, pull request | T1, T2 |
| T4 | all | independent review of the integrated diff | T3 |

T1 and T2 share no file and no interface. D2 depends on D1's `scripts`, so both are in T1.
Each runs in its own worktree from the commit that holds the approved design; the
integration owner applies T1, then T2.

## Recovery

No data, schema, configuration or production code is touched. Recovery is a revert of the
pull request.

## Requirement exception

None needed. `CLAUDE.md` requires explicit human approval only for high-risk changes, and
this change touches none of the listed high-risk paths. The owner's brief for #623
(2026-11-17) nevertheless requires independent AI approval of the design before
implementation; that approval is recorded below. Human review before merge is unaffected.

## Approval record

Pending.
