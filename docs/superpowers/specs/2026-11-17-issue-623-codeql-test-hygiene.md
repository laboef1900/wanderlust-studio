# Issue 623: CodeQL test-suite and DOM-harness hygiene

Status: design revision 2, approved 2026-11-17 by independent AI review (see *Approval
record*). Risk: **normal**. Test files only; the one non-mechanical change is the markup
parser of the DOM harness that 20 uploader suites build their assertions on.

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

1. At `<!--` with a `-->` after those four characters: skip through that `-->`. No node.
   The pending text run is kept.
2. Otherwise take the next token with the same two alternatives as today (`<[^>]+>` or
   `[^<]+`, applied at the cursor). A `<` that starts neither is dropped, as the global
   match drops it today.
3. A text token extends the pending text run. The run is flushed into one `#TEXT` node
   (decoded once over the joined raw text, as today) before every other token and at the
   end of input, with two exceptions that keep it open: a terminated comment (rule 1) and a
   terminated script (rule 4). So end tags, `<!…>` tokens and a dropped `<` all end a run.
4. A start-tag token whose tag name (the existing `^<([\w-]+)` capture) is `script`,
   compared ASCII-case-insensitively, and that is followed later in the string by
   `</script>` in any ASCII case: skip through the first such end tag. No node; the pending
   text run is kept. The end tag is exactly those nine characters, as today; `</script >`
   and other spellings do not end the element.
5. Everything else is unchanged: `<!…>` tokens are dropped, end tags pop to the matching
   open element, attributes, void elements and self-closing handling are as today. A
   `script` start tag with no `</script>` after it stays an ordinary element whose content
   is parsed as markup, as today; an unterminated `<!--` is dropped up to the next `>`, as
   today.

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
| 2 | pieces around a removed comment or script that join into a tag (`<scr<script></script>ipt>`, `<!<!-- -->-- -->`, `a<<!-- -->b>c`) | the joined text is tokenized: a joined tag or comment appears (a `SCRIPT` node, a new comment, a `B` element) | never joined |
| 3 | `<script-x>` | treated as a script start (`\b`) | ordinary element `SCRIPT-X` |
| 4 | comment delimiters inside a tag token (`<a title="<!-- x -->">`) | removed before tokenizing | part of that token |
| 5 | a terminated script inside a tag token (`<a title="<script>x</script>">t</a>`) | removed before tokenizing | part of that token and the text after it |

Row 2 is the defect alerts 11 and 12 describe. Rows 3, 4 and 5 keep markup today's parser
removes. Rows 1 and 2 can also go the other way: where today a comment opener inside a
script swallowed the end tag, the element and what it wrapped stayed in the tree
(`<script><img src=x><!--</script>-->` is `SCRIPT` with an `IMG` today and nothing now).
That is what a browser does with script content, and no suite input has the shape.
Outside these five rows, which script elements are skipped is exactly today's set: same
start tag, same end tag.

Considered and rejected: keeping parsed `<script>` elements in the tree, as a browser's
`innerHTML` does. It would make the `script` half of three existing injection assertions
(`about-gallery-warnings.test.ts` and two in `editor-dom.test.ts`, each a
`querySelector('script')` after hostile input) effective, which today it is not for markup
assigned through `innerHTML`, but it changes `textContent`, `children` and serialization
for every suite that parses a full page. That is a behavior change beyond this epic; it is
recorded as an observation for the owner, not implemented. For the same reason the end tag
is not widened to the forms a browser accepts (`</script >`, `</script/>`): today such an
element stays in the tree where those assertions can see it, and it still does.

### D2. #610 alerts 7 and 9: Desk page scripts from the harness

`uploader/test/build-reporting-dom.test.ts` and `uploader/test/onboarding-dom.test.ts` both
parse `public/index.html` with `editorDocument` and then re-scan the same string with a
script-matching pattern. They iterate `dom.scripts` instead, keeping the loop body:
skip `/admin/editor-image-copy.js`, run the file behind `src` or the inline `text`.
`public/index.html` has only `<script src="…">` and one inline `<script>`, no comments, so
the list equals today's matches (checked in the differential run). `dom.scripts` lists
every script element, where today's pattern lists only bare and `src`-only tags: a future
`type="module"` or `defer` script in that page would be run by these loops and fail
loudly instead of being skipped silently.

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
oracle gets stricter, not looser. One table row pins it: the body
`<img src="${OLD}/a&amp;#x22;.jpg">` with expected ``[`${OLD}/a&#x22;.jpg`]``, on which the
gate and the corrected oracle agree and the old order answers `a".jpg`.

### D6. #616 alert 19: count literal occurrences

`uploader/test/preview.test.ts` line 60: count occurrences of the literal
`href="${src}-1600.webp"` (`split(...).length - 1`) instead of building a pattern from a
URL. The expected count stays 6. The unescaped `.` no longer matches any character, so the
assertion is stricter. Line 58 (a pattern built from a label, not flagged) is unchanged.

### D7. #617 alerts 20 to 23: no URL-prefix checks

- `site/src/lib/body-images.test.ts`: the linked-image branch keys on the row's
  `parent === 'a'`. Exactly the two rows containing the link have that parent.
- `uploader/test/admin-actions-dom.test.ts` line 3252: the mixed-content fixture answers
  for host `lan.example` by parsing the URL (no throw on an unparsable value) and comparing
  `hostname`. It is a fixture, not an assertion; the six URLs that reach it in the suite
  get the same answer as today.
- Lines 4368 and 4423: "the page did not contact the provider" becomes "the page made no
  off-origin request", using the rule the suite's own `fetcher` already applies
  (`!url.startsWith('/')`): the list of requested URLs that do not start with `/` must be
  empty. Every URL the old prefix check counted is in that list, so the assertion only gets
  stricter; it has no host literal and parses nothing.

## Preservation invariants

1. No file outside the nine test files, one new harness suite and the docs changes.
2. Every existing assertion stays. No test is skipped, deleted or loosened: D3, D4 and the
   `body-images` and fixture parts of D7 are equivalent on every current input; D5, D6 and
   the two provider assertions of D7 only narrow what passes.
3. For every string the current suites pass to `parseMarkup` (page loads and `innerHTML`
   assignments), the resulting tree is identical to today's: same nodes, order, attributes
   and text runs.
4. The scripts the two Desk suites execute, and their order, are identical to today's.
5. No new dependency, no suppression comment, no CodeQL configuration or query exclusion.
6. The flagged patterns are not reintroduced in tests or fixtures (tests are scanned too).

## Failure handling

D1 keeps today's handling of malformed markup (rules 2 and 5). One new throw exists: the
`src` of a skipped script is now decoded, so a page whose script `src` holds an invalid
numeric character reference fails to load in the harness; no page has one. D3 throws a
named error instead of a `TypeError`. D7's fixture must not throw on an unparsable value.
The rest are pure expression replacements.

## Tests

- New `uploader/test/editor-dom-harness.test.ts`, asserting trees through the public
  harness surface (`querySelector`, `textContent`, `childNodes`, `scripts`), not parser
  internals:
  - comments and terminated scripts leave no node and do not split a text run, and the
    joined run is decoded once (`&am<!-- -->p;` is `&`);
  - end tags, `<!x>` tokens and a dropped `<` do split it (`a<!x>b` is two text nodes);
  - script tags in any ASCII case and with attributes are skipped; `</script >` does not
    end the element, which stays in the tree with its content;
  - `scripts` order, `src` and raw `text`;
  - `<!-->a-->b` resolves as today; an unterminated comment and an unterminated script keep
    today's result (markup after an unclosed `<script>` stays visible);
  - the five differences above, including the two nested inputs from the alerts producing
    no `SCRIPT` node;
  - the `innerHTML` setter path.
- D2 to D7 are covered by the suites they change; the full uploader and site runs are the
  regression check for invariant 2.

Evidence produced during development and reported, not committed:

- Differential run: the old `parseMarkup` kept beside the new one, both run on every call
  of the complete uploader unit run, trees compared structurally: tag name, attributes in
  order, and every `#TEXT` node separately (not `outerHTML`, which joins adjacent text
  nodes and would hide a split). Report calls compared, distinct inputs and mismatches.
  A non-zero mismatch count stops the task and returns the design to review.
- `dom.scripts` for `public/index.html` equals the old pattern's matches (count, order,
  `src`, text).
- D5: the added row fails with the old order and passes with the new.

The pull request body carries `Closes` for the six children, the repository convention,
so they close on merge, and `Refs #623`: the parent's remaining condition (no open alert)
is met only when `dev` is rescanned after merge, and the owner closes it then.

## Verification

- Uploader: `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` against a disposable
  Postgres 18 on an isolated port.
- Site: `npm test`, `npx astro check` against the same disposable database.
- Not applicable: browser and end-to-end checks, `npm run build` (no production, page or
  bundle change). CI still runs them on the pull request.
- CodeQL: the pull-request scan reports only findings on changed lines, so it shows that
  nothing new is introduced but cannot show alert 19, whose location is an unchanged line.
  A full scan of the branch (`security.yml` run by hand) must list none of alerts 4, 6 to
  12 and 19 to 23. The alerts themselves close when `dev` is rescanned after merge.
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

### Revision 1 (commit `dee27b48d57dc9f57aaf522cfb0512430830bb78`): changes required

Reviewer: independent Orca worker, OMP, `anthropic/claude-opus-5-5`, launched at effort
`high` (Orca dispatch `ctx_26eff06e4116`, effective launch settings confirmed with
`worker-show`; the reviewer's harness does not display the level to it). The reviewer did
not author the design.

The reviewer checked every claim against the source, implemented D1 next to the old parser
in a scratch copy and ran both on every `parseMarkup` call of the uploader unit project
(6461 calls, 951 page loads and 5510 `innerHTML` assignments, 38 distinct inputs, 0 tree
mismatches), confirmed that `dom.scripts` for `public/index.html` equals the old matches
(12 scripts), and read the CodeQL query sources for the six rules.

| Finding | Severity | Disposition |
|---|---|---|
| F1: comparing `hostname` at lines 4368 and 4423 lets a lookalike host (`api.anthropic.com.evil.example`) pass where it fails today | blocking | Accepted. D7 now asserts that no off-origin request was made, a superset of the old check. Invariant 2 reworded. |
| F2: a terminated script inside a tag token is a sixth difference | non-blocking | Accepted. Added to the table (row 5) and to the harness suite. |
| F3: the flush rule and the `-->` search start were underspecified | non-blocking | Accepted. Rules 1 and 3 reworded; tests added. |
| F4: the differential must compare structure, and a mismatch must return to review | non-blocking | Accepted. Evidence section reworded. |
| F5: accepting `</script >` and similar end tags would hide script elements the harness shows today | non-blocking | Accepted by removing the cause: rule 4 keeps today's exact end tag, so the set of skipped scripts does not grow. The former difference 2 is gone. |
| F6: the D5 row need not be conditional | non-blocking | Accepted. The row the reviewer verified is mandatory. |
| F7: the pull request should close the children and the parent | non-blocking | Accepted for the six children. The parent gets `Refs`: its last condition is met only after `dev` is rescanned. |
| F8: `dom.scripts` lists every script element | non-blocking | Accepted. One sentence in D2. |

### Revision 2 (commit `472e740289856aa03a6729a1844a6f25916129fc`): approved

Same reviewer and session (`anthropic/claude-opus-5-5`, launched at effort `high`, Orca
dispatch `ctx_425db02f94ec`), 2026-11-17. Verdict: **approved**, no blocking finding.

The reviewer implemented revision 2's D1 as written in a scratch copy and repeated the
differential with the structural comparison: 6461 `parseMarkup` calls, 0 mismatches; in all
16 Desk page loads `dom.scripts` equals the old matches. Twenty-eight edge probes: every
diverging input falls under one of the five rows, and `</script >`, `</SCRIPT x>`,
`<!-->a-->b`, `&am<!-- -->p;`, `a<!x>b`, `a<>b` and the unterminated forms are identical
to today. All eight revision 1 findings are resolved as dispositioned.

Two non-blocking notes, both taken: row 2's "today" column now says any joined tag can
appear (wording only, made after approval), and the implementation compares a case-folded
slice per candidate instead of searching a lower-cased copy of the string, whose indices
can drift.
