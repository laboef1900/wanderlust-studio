# Issue 621: CodeQL production error-level fixes

Status: design revision 2, approved 2026-11-17 by independent AI review under the scoped
exception below (see *Approval record*). Risk: **high** (path-traversal guards, backup
download route, the gallery source parser).

Parent: [#621](https://github.com/laboef1900/wanderlust-studio/issues/621). Children:
[#618](https://github.com/laboef1900/wanderlust-studio/issues/618) (alerts 24, 25, 26),
[#614](https://github.com/laboef1900/wanderlust-studio/issues/614) (alert 17),
[#607](https://github.com/laboef1900/wanderlust-studio/issues/607) (alerts 1, 2, 3),
[#615](https://github.com/laboef1900/wanderlust-studio/issues/615) (alert 18).

## Outcome and scope

Remove the eight `error`-level CodeQL findings in production code without changing any
observable behavior: same routes, same status codes and bodies, same parser results, same
files read or deleted. Every change either adds a redundant guard in front of an existing
one or replaces an expression with a provably equivalent one.

Out of scope: the warning-level epic #622 (#619 rate limiting on `GET /backups/:name`, #620
`console.error` format strings in `posts-routes.ts`) and the test-hygiene epic #623. They
touch the same two route files; this change must not pre-empt or conflict with them beyond
the lines named below. No schema, data, dependency, slug, route or `/data` layout change.

## Trust boundaries and misuse cases

| Surface | Caller | Untrusted input | Misuse the guard must stop |
|---|---|---|---|
| `GET /backups/:name` | admin session | `:name` | reading a file outside the backup directory |
| `DELETE /media/items/*` → `deleteMedia` | admin session | the key | listing or unlinking outside `STORAGE_DIR` |
| `GET /media/items/*?versions=1` → `listVariantFiles` | author session | a stored key (DB row, dump) | listing or probing outside `STORAGE_DIR` |
| `POST /translation/prepare`, `/validate` | author session | article text and model output | the JSON echo being interpreted as HTML |
| rich editor (`RichSource`, gallery views) | author's own browser | Markdown source | a crafted document freezing the editor tab |
| `POST /gallery/analyze` → `analyzeGallerySource` | author session | Markdown source | source text reaching a regular-expression constructor |

All six surfaces already sit behind session authentication. The findings are defense in
depth, not known exploitable holes: the existing `assertSafeKey` and filename patterns
already reject traversal. CodeQL cannot see guards that live in a helper returning `void`
or in a custom pattern, and the two ReDoS patterns are real worst-case exponential.

## Design

### D1. #618, alert 24: backup download path

`uploader/src/backup.ts` gains one pure exported helper:

```ts
/** Absolute path of `name` directly inside `dir`, or null when it would not be. */
export function backupFilePath(dir: string, name: string): string | null
```

- `root = resolve(dir)`, `target = resolve(root, basename(name))`,
  `prefix = root.endsWith(sep) ? root : root + sep` (`resolve` leaves a trailing separator
  only on the file-system root).
- Returns null when `basename(name) !== name` (any separator), when `target === root`, or
  when `target` does not start with `prefix`. So `''`, `.`, `..`, `a/b`, `/etc/passwd` and
  `../x` all yield null for every directory, the file-system root included.
- The check is lexical: symbolic links are not resolved. The doc comment says so and tells
  callers to keep opening the result with `O_NOFOLLOW`.
- It does not replace the filename patterns. The route keeps the three allow-list patterns
  first, then calls the helper and answers the same `400 invalid backup filename` on null,
  then opens the returned path with the unchanged `O_RDONLY | O_NOFOLLOW`, regular-file and
  `nlink === 1` checks, and the unchanged 404 mapping for `ENOENT`/`ELOOP`.
- `Content-Disposition` keeps using the pattern-validated `name`.

For every name the patterns accept, `basename(name) === name` and the resolved path equals
today's `join(dir, name)`, so no accepted request changes.

### D2. #618, alerts 25 and 26: media key location

`uploader/src/media-files.ts` gains one private helper used by `deleteMedia` and
`listVariantFiles`:

```ts
function keyLocation(storageDir: string, key: string): { dir: string; base: string }
```

- Calls `assertSafeKey(key)` first (the existing chokepoint, unchanged, before any path is
  built).
- `root = resolve(storageDir)`, `target = resolve(root, key)`, and the same
  `prefix = root.endsWith(sep) ? root : root + sep` as D1; throws
  `unsafe storage key (resolves outside the storage directory)` unless `target` starts with
  `prefix`. The message never contains a path. `target === root` cannot occur: `assertSafeKey`
  has already rejected empty, `.`, `..` and trailing-slash keys.
- Each `startsWith` comparison is written inline in the function that returns the path, not
  behind a boolean or assert-style helper.
- Returns `dir = dirname(target)` and `base = basename(target)`.

Checking the key's own path instead of its directory keeps one guard with no special case:
a root-level key (`photo`) resolves to `root/photo`, which is strictly inside `root`, while
its directory is `root` itself. For every key `assertSafeKey` accepts,
`dirname(resolve(root, key)) === join(root, dirname(key))`, so the directory read and the
files unlinked are unchanged. `deleteMedia` keeps `assertWorkWritable` first and before
every unlink.

`listVariantFiles` is not flagged (its key comes from a database row), but it builds the
same path the same way and `SECURITY.md` requires re-asserting at read boundaries. Using
the helper in both keeps one way of turning a key into a directory in this module.

### D3. #614, alert 17: translation routes

The `/translation/prepare` and `/translation/validate` handler sets
`reply.header('Content-Type', 'application/json; charset=utf-8')` as its first statement.
Fastify already sends exactly this value for an object payload, so responses are byte
identical. `reply.header` is used rather than `reply.type` because it is the form the
static analysis models. The route error handler is unchanged.

### D4. #607, alerts 1, 2 and 3: linear-time editor parsing

`trailingLines` (`editor-rich-source.ts`) becomes a backward scan with no regular
expression. The current pattern matches the leftmost line break from which the rest of the
string is only line breaks and blank (space/tab) lines, ending in a line break. Equivalent
rule: walk back over the maximal suffix of space, tab, CR and LF; if the source does not
end in CR or LF there is no split; otherwise split at the first CR or LF of that suffix.
One pass, constant work per character.

`galleriesIn` (`editor-rich-text.ts`) keeps a single pattern with an unambiguous prefix
loop:

```
old  ^([ \t]*(?:(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)[ \t]*)*)
new  ^([ \t]*(?:(?:>|(?:[-+*]|\d+[.)])[ \t])[ \t]*)*)
```

Both describe leading blanks followed by any number of `>` + blanks or list marker + one or
more blanks. In the new form every iteration starts with a non-blank and owns all following
blanks, so there is exactly one way to match. The fence and `gallery` tail are unchanged.
Capture 1 ends at the first fence character in both, so `start` offsets are identical.

The continuation-line strip two lines below has the same doubled quantifier
(`(?:>[ \t]?[ \t]*)*`). It cannot backtrack today because nothing follows it, but it is the
same defect one edit away from being exploitable; it becomes `(?:>[ \t]*)*`, the same
language.

### D5. #615, alert 18: closing fence without a constructed pattern

`fenceBlock` (`site/src/lib/gallery-source.ts`) matches the last row against the static
pattern ``/^[ >\t]*(`{3,}|~{3,})[ \t]*$/`` and compares the captured run in code: same
character as the opener's run and at least as long. The run is followed only by blanks to
end of line, so the capture is the whole run and the result equals the constructed
`{n,}` pattern for every `n >= 3`. The `rows.length - 2 >= values.length` condition and
everything after it are unchanged.

## Preservation invariants

1. No route, status code, response body, header value or error string changes for any
   request accepted or rejected today.
2. `assertSafeKey` and the three backup filename patterns stay, unchanged and first.
3. `deleteMedia` removes exactly the same files; `listVariantFiles` lists the same ones.
4. `RichSource` spans, gallery detection and gallery `start` offsets are identical for every
   input; `analyzeGallerySource` output is identical for every input.
5. No new dependency, no suppression comment, no CodeQL configuration or query exclusion.
6. The vulnerable patterns are not copied into tests (tests are scanned too).

## Failure handling

- D1: null from the helper is a 400, never a 500 and never a fallback to the raw name.
- D2: the containment throw surfaces like any other unsafe-key error; the delete route has
  already rejected such keys with 400, the versions route maps it to `unavailable`.
- D4/D5: pure functions; no new failure paths.

## Tests

Added to the existing suites, table-driven, asserting results rather than wiring:

- D1, in `uploader/test/backup.test.ts`: `backupFilePath` for accepted names (all three
  kinds) with an absolute, a relative and a trailing-slash directory, and the hostile names
  above against an ordinary directory and against `/`. Route: existing cases stay green and
  are not widened; add a `routes-…tar` download.
- D2: `deleteMedia` and `listVariantFiles` for a root-level key, the case a
  directory-level prefix check would wrongly reject, once with a trailing-slash storage
  directory; existing nested-key and hostile-key cases stay green.
- D3: one assertion per translation route that a successful response is
  `application/json; charset=utf-8`. This pins invariant 1; CodeQL on the pull request is
  the check that the finding is gone.
- D4, through the editor's observable output rather than an unedited round trip (which
  hides a wrong split): the source block text for a block followed by `\r\n \t\r\n` and by a
  lone `\r`; the Markdown after an edit next to such a block; the `onEditGallery` offset for
  galleries at top level, in nested quotes and in ordered and bullet lists, with tabs, plus
  near-misses that must not be galleries. The alerts' adversarial inputs, placed inside a
  single token (a fenced code block or HTML block) so they reach `trailingLines`, with enough
  repetitions that the old code could not finish, must give the correct result inside a
  generous wall-clock bound.
- D5: closing fence equal, longer, shorter, other character, trailing blanks, quoted, and a
  four-character opener with a three-character line in the content.

Equivalence with the old expressions is established during development by a throwaway
differential run over generated inputs, reported as evidence and not committed.

## Verification

- Uploader: `npm run typecheck`, `npm test` with `TEST_DATABASE_URL` against a disposable
  Postgres 18 on an isolated port, `npm run test:e2e` (real Chromium, real editor bundle).
- Site: `npm test`, `npx astro check`, `npm run build` against the same disposable database.
- CodeQL on the pull request merge ref: alerts 1, 2, 3, 17, 18, 24, 25 and 26 absent and no
  new alert. The alerts themselves close only when `dev` is rescanned after merge.
- Required checks on the final head: `site · tests + astro check`,
  `uploader · typecheck + tests`.

## Work breakdown and dependencies

| Task | Issue | Files | Depends on |
|---|---|---|---|
| T1 | #618 | `uploader/src/backup.ts`, `backup-import-routes.ts`, `media-files.ts`, `test/server.test.ts` (backup block), `test/media-files.test.ts`, backup unit suite | approval |
| T2 | #614 | `uploader/src/posts-routes.ts` (translation handler only), `test/server.test.ts` (translation block) | approval |
| T3 | #607 | `uploader/src/editor-rich-source.ts`, `editor-rich-text.ts`, `test/editor-rich-text.test.ts` | approval |
| T4 | #615 | `site/src/lib/gallery-source.ts`, `uploader/test/gallery-source.test.ts` | approval |
| T5 | all | integration, `SECURITY.md`, `docs/claude/project-status.md`, this spec | T1–T4 |

T1–T4 have no technical dependency on each other. T1 and T2 both add cases to
`test/server.test.ts` in separate `describe` blocks; each runs in its own worktree and the
integration owner applies them in the order T1, T2, T3, T4.

## Recovery and containment

No data, schema or configuration is touched, so recovery is a reviewed revert of the pull
request. If a guard wrongly rejects a legitimate backup download or media delete after
deployment, redeploy the previous image tag; nothing on `/data` or in Postgres needs repair.

## Requirement exception: AI design approval for this epic

| | |
|---|---|
| **Waived rule** | `CLAUDE.md` *Change Risk and Required Rigor*: high-risk changes need "explicit human approval". Waived for the **design gate only**. |
| **Scope** | `laboef1900/wanderlust-studio` issues #621, #607, #614, #615, #618. |
| **Reason** | The owner asked for autonomous delivery through unmerged pull requests and authorized replacing the human design pause with independent AI approval. |
| **Risk** | A design flaw a human reviewer would have caught proceeds to implementation. |
| **Compensating controls** | Independent strong-reasoning reviewer that did not author the design; behavior-preservation invariants with differential evidence; full suites plus integration and browser tests; CodeQL on the pull request; independent review of the integrated diff; the pull request stays unmerged, so the owner's merge decision remains the human security decision. |
| **Approver** | Simon (owner), in the 2026-11-17 task brief for #621. |
| **Expiry** | At final pull-request handoff or abandonment. Human approval before merge is not waived. |

## Approval record

### Revision 1 (commit `eb127dfbe8c91b19dc8565480c66427d979ac8e1`): changes required

Reviewer: independent Orca worker, OMP, `anthropic/claude-opus-5-5`, launched at effort
`high` (Orca dispatch `ctx_60158013f863`; the reviewer's harness does not display the level
to it). The reviewer did not author the design. The first-choice reviewer,
`openai-codex/gpt-6-astra` at `high`, could not run: the provider's weekly usage limit was
exhausted.

The reviewer read the source and the CodeQL Fastify, reflected-XSS and tainted-path models,
and compared every old expression with its replacement over about 80 million generated
inputs with no mismatch. It expects all eight alerts to clear.

| Finding | Severity | Disposition |
|---|---|---|
| F1: with directory `/`, `backupFilePath` would return `/` for `''`, `.` and `..` | blocking | Accepted. D1 now rejects `target === root`, tests include `/`, the doc comment states the check is lexical. |
| F2: D2's prefix was under-specified for a root directory | non-blocking | Accepted. D2 builds the prefix as D1 does, inline. |
| F3: D4 tests must assert observable output and route the adversarial input through a single token | non-blocking | Accepted. Tests section rewritten. |
| F4: the D3 markup-echo case tests Fastify, not this change | non-blocking | Accepted. One content-type pin per route; the echo case is dropped. |
| F5: some D1/D2 cases could not fail; name the backup suite | non-blocking | Accepted. Route-archive traversal and `.`-segment cases dropped; the root-level key case and the `routes-…tar` download kept; suite named. |
| F6: no polynomial-ReDoS finding expected on the unchanged opener tail | non-blocking | No action. |

### Revision 2 (commit `2695f095549731a32f179c00fe8d453518bf137d`): approved

Same reviewer and session (`anthropic/claude-opus-5-5`, effort `high`, Orca dispatch
`ctx_daf8d2125ded`), 2026-11-17. Verdict: **approved**, no findings remaining.

The reviewer re-ran the root-directory check against the revised D1 guard over 11
directories (including `/`, `//`, `/./`, empty, relative and trailing-slash) and 11
hostile names: none of the 154 cases was accepted, and all three accepted name kinds still
resolve to today's path. F2 to F5 are resolved as proposed. The one deviation from F5, a
root-level key with a trailing-slash storage directory in the D2 tests, was accepted: it
fails for an implementation that compares against the unresolved directory.
