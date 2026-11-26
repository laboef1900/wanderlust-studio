# Issue #653: About portrait in the profile card and migrated About content

- **Issue:** [#653](https://github.com/laboef1900/wanderlust-studio/issues/653), owner decision comment
  2026-11-26: scope **A + B** (content migration into the existing Markdown body, plus an optional
  per-locale portrait in the profile card). Options C (styled heading conventions) and D (structured
  profile data) are out of scope.
- **Base:** `origin/dev` at `c7b3a75`. Branch `feature/653-about-portrait`.
- **Design revision:** r3 (2026-11-26; resolves design review r1 findings F1–F5 and r2 finding F6, see §12).
- **Risk class:** the owner rated B *normal*. This repo's CLAUDE.md lists "the site identity tables and
  exported identity/content build snapshot" as **high risk**, so this spec applies the high-risk rigor:
  written spec, trust boundaries, misuse cases, invariants, rollback plan.

## 1. Acceptance criteria (from the issue, A + B only)

| # | Criterion |
|---|---|
| AC1 | Old About content exists for DE and EN as `##` sections in the existing body, lightly shortened, no mixed language, no dead "read more" CTA, no Instagram closing line (Appendix A). |
| AC2 | Optional portrait per locale (image + alt text) in the profile card, replacing the compass icon; the compass stays as fallback when no portrait is set for that locale. |
| AC3 | Portrait and inline photos render with correct alt text and responsive `srcset`/`sizes`; no text over a photo. |
| AC4 | No hardcoded UI strings: all new admin copy in `site/src/i18n/ui.ts`, both locales complete. |
| AC5 | Published About URLs unchanged (`aboutPath` in `site/src/lib/paths.ts` and the route words are not touched; nothing in routing changes). |
| AC6 | Tests updated (`site-identity` validator, `site-identity-render`, uploader identity routes/store, About editor DOM); `astro check`, `tsc --noEmit`, Vitest pass. |
| AC7 | Portrait edited in the About editor next to the equipment line (#514 pattern). |

## 2. Existing behaviour and preservation invariants

- `site_identity` is a singleton row; localized text lives in the `localized` jsonb column, whose
  allowed keys are `IDENTITY_LOCALIZED_FIELDS` (`site/src/lib/site-identity.ts`). `identityFromRow`
  rejects unknown keys; `normalizeIdentity` rejects unknown top-level keys and requires every
  localized map.
- `GET`/`PUT /settings/identity` (admin-only, `uploader/src/settings-routes.ts`) is the only text
  writer; optimistic `revision`; `mergeIdentityEdit` keeps values of disabled locales.
- The build gets identity only through `SITE_IDENTITY_JSON` (`toIdentitySnapshot` →
  `parseIdentitySnapshot` in `site/src/lib/build-identity.ts`). `studioDescriptor` is admin-only and
  never enters the snapshot.
- The About editor's equipment line (`uploader/public/about-equipment.js`, #514) edits
  `identity.aboutGear` through the same PUT, sending the loaded identity with one field replaced.
- Settings → Site identity (`uploader/public/settings-identity.js`) builds the PUT body from form
  fields.

Invariants this change MUST keep:

- **I1** No SQL DDL. The portrait is a new key inside `site_identity.localized`; no table, column or
  constraint changes.
- **I2** An identity without a portrait renders the About page byte-identically to today (compass
  card), in every language mode.
- **I3** Disabled-locale portraits are retained on save and never enter the snapshot (same as
  `aboutGear`).
- **I4** Only admin sessions can write the portrait (existing `requireAdmin` on `PUT /settings/identity`).
- **I5** A new or changed portrait MUST reference a photo hosted on this install's image host
  (canonical variant base under `PUBLIC_BASE_URL`); no arbitrary third-party URL can reach readers.
- **I6** Equipment-line behaviour, copy and DOM contract (#514) stay unchanged; its existing tests pass
  without edits to their assertions.
- **I7** Saving Settings → Site identity never drops or alters a stored portrait.
- **I8** No published URL or slug changes (SEO slug contract).

## 3. Data contract

```ts
// site/src/lib/site-identity.ts
export interface AboutPortrait {
  src: string;            // canonical variant BASE, e.g. https://img.example/photos/2022/simon (no -640.webp)
  width: number;          // intrinsic px, positive integer
  height: number;
  alt: string;            // per-locale, required, identity text rule, 1..300 code points
  format?: 'jpeg';        // same meaning as RemoteHeroImage.format
  focus?: { x: number; y: number }; // 0..100, optional
}
export type IdentityPortraitMap = Partial<Record<IdentityLocale, AboutPortrait>>;
// Identity gains: aboutPortrait: IdentityPortraitMap
```

- `IDENTITY_LOCALIZED_FIELDS` gains `'aboutPortrait'`, so it is stored in `localized` and merged by
  `mergeIdentityEdit` per locale like the text maps. `neutralIdentity()` gets `aboutPortrait: {}`.
- **Pure validator** (`normalizeIdentity`, shared by uploader writes, dump restore and the build):
  `aboutPortrait` must be an object whose keys are `de`/`en`; each value passes
  `isCanonicalJourneyHero` (`site/src/lib/journey-snapshot.ts`: canonical http(s) base URL, safe
  path, no query/hash/credentials, positive integer dimensions, optional `jpeg`, optional bounded
  focus) **and** its `alt` passes the identity `text()` rule with min 1 / max 300 code points (NFC,
  trimmed, no `\p{C}`). The validator returns a fresh object containing only the allowed keys with
  the normalized alt. Errors raise `IdentityError('aboutPortrait.<locale>')`.
- **Snapshot:** `aboutPortrait` IS public (it renders) and enters `IdentitySnapshot`, filtered to the
  active locales exactly like `tagline`/`aboutRole`/`aboutGear`; `parseIdentitySnapshot` rejects
  portrait keys for locales outside `locales`. Snapshot `v` stays `1` (producer and consumer are the
  same release; the build never reads a snapshot from another version).

## 4. Trust boundaries and validation

| Boundary | Check |
|---|---|
| Admin PUT `/settings/identity` | Existing admin guard, body shape, revision. **New:** after shape validation, every active-locale portrait in the request that is not deep-equal to the currently stored portrait for that locale must have `src` = `${imageBase}/${key}` with `new URL(src).origin === new URL(imageBase).origin` and `assertSafeKey(key)` passing (`uploader/src/storage.ts`). Failure → 400 `{ code: 'invalid_identity', field: 'aboutPortrait.<locale>' }`. Unchanged stored entries are exempt so an image-host change (e.g. localhost → server) never blocks unrelated identity saves; the build re-points them anyway. |
| Shared helper | Extract the origin/prefix/safe-key part of `heroKey` in `uploader/src/journeys.ts` into one exported helper (e.g. `hostedImageKey(src, imageBase): string`, throwing on failure) used by both journeys and identity. Journey behaviour and error codes stay identical (journey tests unchanged). |
| Dump restore | `validateDumpIdentity` already runs `identityFromRow` → the pure validator covers the portrait. No host check at restore (dumps move between hosts; the build retargets). |
| Build | `parseIdentitySnapshot` re-validates. `build-identity.ts` exposes `identityPortrait(locale): RemoteHeroImage \| null`, re-pointing `src` to `imageOrigin(process.env.PUBLIC_BASE_URL)` via `retargetImageOrigins` (same as `journeys-loader.ts`). |
| Render | Astro text interpolation only (`alt` attribute, `srcset` built from validated base + numeric widths). No `set:html`. `focus` goes through `focusPosition` (clamped). |

Misuse cases:

- **M1** Admin pastes an external URL (tracking pixel / hotlink) → refused by I5 at PUT.
- **M2** `javascript:`/`data:` or credentials in `src` → refused by `isCanonicalJourneyHero`.
- **M3** Alt with control/bidi characters or 10k chars → refused by `text()` rule.
- **M4** Variant URL instead of base (`…-640.webp`) → rejected: `isCanonicalJourneyHero` refuses dots
  in the path and `assertSafeKey` refuses such a key (negative test required). Real residual limit: a
  syntactically valid hosted base may name a non-existent photo or carry wrong dimensions; the server
  does not check library existence/metadata (journey *publication* does; identity saves do not). The
  ready-only picker is the normal-UI safeguard, not server-side proof. Accepted and documented.
- **M5** A non-admin author session calls PUT → 403 (existing guard; covered by a test).
- **M6** Tampered dump with portrait for an unknown locale key or extra keys → restore refused.

## 5. Rendering (public site, `AboutPage.astro`)

Design direction (impeccable, mode *Read*, Editorial Magazine): the portrait is a photograph, so it
gets real presence instead of a 56 px avatar, but it stays inside the existing card and no text
sits on it.

- **Portrait set for this locale:** the card opens with a square, cover-cropped portrait plate
  (`aspect-square`, `object-cover`, focus honoured, `rounded` (4 px) with the card's `border-navy/10`
  hairline), full card width, capped at `max-w-xs` (20 rem) and left-aligned on narrow/tablet widths
  so it never balloons in the single-column layout. Below it the name (`h2`) and role line, without
  the compass disc. Stats and equipment box unchanged.
- **No portrait:** the current compass markup, unchanged (I2).
- `RemoteImage` with `alt = portrait.alt`, `loading="eager"` (it is above the fold on phones),
  `decoding="async"`, intrinsic `width`/`height` for CLS, and a named `ABOUT_PORTRAIT_SIZES` constant
  derived from the grid geometry (card column = `1fr` of `[1fr_2.2fr]` in `max-w-6xl` minus
  `px-5`, `gap-12`, card `p-6`; below `lg` the 20 rem cap), with a unit test pinning the arithmetic
  like `ABOUT_BODY_SIZES`.
- Old page's inline Trübsee photo stays a body image (existing `ABOUT_BODY_SIZES` path).

## 6. Admin UI (About editor, `uploader/public/about.html`)

Mode *Operate*, Editorial Desk styling from `admin.css`; no new visual vocabulary.

- One **Portrait** section per locale panel, placed directly above the existing Equipment section
  (card order mirrors the public card). Contents: a small preview thumbnail (`smallestVariant`-style
  URL, `alt=""` because the alt field is adjacent and labelled) or an empty-state line;
  **Choose from library** (opens `MediaPicker` single-select; prefills alt from the photo's library
  alt for that locale when the alt field is empty); **Remove**; an alt-text input with label, help,
  live code-point counter (max 300) and required-when-photo validation; **Save portrait**; status,
  error (`role="alert"`), conflict **Reload** exactly like the equipment line; a timing note (saved
  separately from page text, live after the next rebuild).
- **Shared identity state (required):** the equipment and portrait sub-editors share ONE loaded
  identity record and revision. Each save sends the loaded identity (projected to active locales)
  with only its own field/locale replaced, and on success updates the shared record so the other
  sub-editor's next save does not hit a false 409. A real conflict (other tab/settings) shows the
  conflict state in the saving sub-editor; reload refreshes both and confirms before discarding unsaved
  input in either. Implementation may generalise `about-equipment.js` into a small shared loader used
  by `about-equipment.js` and a new `about-portrait.js`; the equipment DOM ids, copy keys and
  behaviour stay as they are (I6).
- Input in these sections must not dirty the page draft (same `stopPropagation` rule as the
  equipment line).
- Keyboard and screen reader: buttons are real `<button>`s, focus returns to the trigger after the
  picker closes, errors are announced and focusable.
- **Settings → Site identity** does not get portrait controls. `settings-identity.js` passes the
  loaded `aboutPortrait` (active locales) through unchanged in its PUT body (I7), and maps an
  `aboutPortrait.<locale>` error field to a general invalid-identity message.

## 7. i18n

New `editor.chrome.aboutPortrait*` keys in both `de` and `en` dictionaries of
`site/src/i18n/ui.ts` (heading, help, choose, remove, alt label/help/count/over/required, save,
saving, saved, cleared, unsaved, timing, loading, load failed, conflict, forbidden, host-refused,
empty state). No new public-site strings: the portrait alt comes from data; the compass fallback is
unchanged. Completeness test covers the keys.

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| PUT 400 `aboutPortrait.<locale>` | Inline error in that locale's portrait section; nothing saved; input kept. |
| PUT 409 | Conflict message + Reload, input kept, no silent retry. |
| PUT 403 | Forbidden message; controls disabled. |
| Network / 5xx | "Not confirmed" message; input kept. |
| Identity GET fails | Both sub-editors show load-failed + Retry; page text editing unaffected. |
| Portrait photo later deleted from the library | Card shows a broken image until the portrait is changed/removed. Same limitation as journey heroes today (media-impact only scans stories); documented, not fixed here. |
| Snapshot invalid | Build fails closed (existing behaviour). |

## 9. Rollback and containment

- Revert the PR and redeploy the previous image. **Hazard:** an older release rejects the unknown
  `localized.aboutPortrait` key in `identityFromRow` — even when it is an empty map `{}`, which every
  identity save on this release writes — so the older identity store cannot load. Rollback sequence
  (writers offline):
  1. Stop the new `app` container (no identity save may re-add the key).
  2. Take and verify a database dump (`pg_dump` or the admin dump taken before stopping).
  3. `UPDATE site_identity SET localized = localized - 'aboutPortrait' WHERE id = true;`
     (targeted UPDATE per Golden Rule 3; nothing else changes; never delete releases or `/data`).
  4. Start the previous image and **explicitly rebuild** (Settings → Rebuild site now): existing
     public releases are retained across boot, so the portrait HTML stays live until a release built
     by the older image replaces it. Verify the About page shows the compass card again.
- New-format dumps (any dump containing the `aboutPortrait` key, empty or not) are refused by older
  releases' restore (fail closed). Path back: restore with this release's reader, stop it, run the
  UPDATE above offline, then start the older release and rebuild.
- Recorded in `docs/claude/project-status.md` with the #653 entry.
- Content (Appendix A) is ordinary page content; page revisions keep the previous body.

## 10. Verification plan

- `site/`: `npx vitest run` for `site-identity.test.ts`, `site-identity-render.test.ts` (portrait
  present/absent per locale, alt, srcset/sizes, compass fallback, inactive-locale exclusion, I2 byte
  identity), sizes geometry test, `ui` completeness; full `npm test`; `npx astro check`.
- `uploader/`: identity store/merge tests, settings PUT route tests (valid hosted portrait, foreign
  origin refused, unchanged stored foreign-origin entry accepted, non-admin 403, inactive locale
  rejected/retained), journeys tests unchanged and green, dump restore with portrait, About editor DOM
  tests (pick → alt prefill → save; shared revision across equipment+portrait saves; conflict),
  settings-identity DOM passthrough; full `npm test`; `npx tsc --noEmit`; integration suites with
  `TEST_DATABASE_URL` against a disposable Postgres.
- End-to-end on an isolated local stack (own compose project, own ports, own data dir): log in,
  upload the two photos, set portrait + alt per locale, paste Appendix A, insert the Trübsee photo,
  publish/rebuild, check DE and EN About pages at desktop and phone widths, alt text, `srcset`,
  console/network errors, keyboard flow in the editor, and that About URLs are unchanged.

## 11. Approval record and exception

- **Waived rule:** CLAUDE.md → "Change Risk and Required Rigor", High row: "Explicit human approval"
  — only as it applies to approving this **design** before implementation.
- **Scope:** `laboef1900/wanderlust-studio`, issue #653 only.
- **Reason:** the owner authorised (prompt of 2026-11-26) replacing the human design-approval pause
  with an independent AI design approval for this issue.
- **Risks:** an AI reviewer can miss owner intent or a security subtlety.
- **Compensating controls:** independent reviewer (not the author) must approve this exact revision;
  independent PR review of the full diff; required CI; the PR is left unmerged for the owner, whose
  merge remains the human approval of the change itself.
- **Authorised by:** repository owner (@laboef1900), in the task prompt for #653.
- **Expiry:** at final PR handoff or abandonment of #653.
- **Design approval:** r1 (`c5ec35b`) CHANGES REQUIRED by omp · `openai-codex/gpt-6-astra` (Orca
  dispatch `ctx_89e2c815f706`); r2 (`c2d2cf0`) CHANGES REQUIRED (F6); **r3 (`94e77bf`) APPROVED**
  by the same independent reviewer (dispatch `ctx_227e409c0a9b`), 2026-11-26.

## 12. Review r1 resolutions (normative for implementation)

**F1 — reload confirmation scopes.** Reload (from either sub-editor, any locale) computes the dirty
scopes across the whole page: `equipment` (any locale dirty) and `portrait` (any locale's photo or
alt differs from saved).
- Only equipment dirty → the existing `aboutGearReloadConfirm` dialog and copy, unchanged (existing
  assertions stay).
- Portrait dirty (alone or with equipment) → a new combined confirmation
  (`editor.chrome.aboutIdentityReloadConfirm*` keys, both locales) naming the affected fields and
  locales that will be discarded.
- Nothing dirty → reload without a dialog.
- Cancel keeps both drafts untouched. Confirm then failed GET → load-failed state, drafts kept.
- A successful save never repaints or discards the other sub-editor's draft (only its own saved value
  and the shared revision change).
- Tests: dirty portrait + equipment-Reload; dirty equipment + portrait-Reload; cancel; confirm;
  confirm-then-failed-GET; equipment-only dirty still shows the old dialog.

**F2 — single operation owner.** The shared controller owns one `busy` operation for all identity
saves and reloads across both sub-editors and all locales, acquired synchronously before any
confirmation dialog or request. While busy (F6, r3), **every identity-mutating control on the page is
locked**: equipment and portrait inputs, alt inputs, Choose from library, Remove, Save and Reload, in
all locales (`disabled`, same pattern as Settings → Site identity's scope lock); the picker cannot be
opened. Inputs therefore cannot change between dispatch and response, so no later draft can be
lost; the lock releases when the operation settles, with focus restored per §6. No automatic retry. Each operation carries a token; only
the current token's response is applied. On PUT success the controller adopts the acknowledged
patch (the normalized value it sent for that field/locale, plus the returned `revision`/`savedAt`;
the PUT returns no identity). On uncertain outcome (network/5xx) drafts are kept and the revision is
not advanced. Tests with deferred responses: overlapping save attempts (second refused while first is
in flight, no false 409), reload vs. in-flight save, then consecutive equipment→portrait saves
succeed with the advanced revision.

**F3 — rollback:** §9 rewritten (offline writers, empty-map hazard, explicit rebuild, dump path).
Tests: old-format rows/dumps (key absent) load; empty, populated and inactive-only portrait maps
round-trip through dump restore; foreign-origin restored portrait builds with no external hostname in
emitted `srcset`/`src`.

**F4 — runbook:** Appendix A apply steps rewritten against the actual controls; descriptions are
reference-only; production application is an owner step, distinct from the PR.

**F5 — M4 corrected** (§4); variant-suffix rejection test required.

**Other reviewer guidance adopted:** `ABOUT_PORTRAIT_SIZES` derives from the *card* column's inner
width (grid width after gutters and gap ÷ 3.2 × 1, minus card padding and border), min'd with 20 rem
below `lg`, with breakpoint-edge and narrow-phone tests; I2 byte-identity in all four language modes;
hostile alt (quotes/markup) render assertions; no other locale's portrait used as fallback; settings
tests for text save, asset-then-text save, and stale revision not resurrecting a removed portrait;
focus returns to the trigger after picker Cancel/Escape; alt over-limit shown without `maxlength`
truncation.

## Appendix A: migrated About content

Source: the live WordPress pages `/en/about-me/` (modified 2024-09-12) and `/uber-mich/`
(2024-02-01). Edits: duplicated CAS sentence removed from *Education*, "In short" filler dropped,
EN *Education* corrected to the DE source ("college of higher education", not a second university),
DE *Knowledge* heading translated, *Meine Vorhaben* translated for EN, "read more" CTA and Instagram
line removed (footer social links cover Instagram). The old `## Simon` heading is dropped: the card
carries the name.

Apply (owner-operated production migration, after deploy, in the admin; not part of the PR):

1. Media library: upload both photos and set their DE/EN alt text (table below).
2. Pages → About, for each active locale: set the title; paste the body; replace the marker comment
   with the Trübsee photo inserted via the photo tool (the marker must not ship).
3. In the same panel's Portrait section: Choose from library → the portrait; check the alt text;
   **Save portrait** and wait for the saved confirmation (it is saved separately from page text).
4. Save the page / Save & rebuild, then verify both public About pages (portrait, alt, inline photo,
   no mixed language).

The descriptions below are **reference-only**: the About editor has no description control and this
issue does not add one (the page falls back to its existing description behaviour). The PR delivers
the capability and this runbook; AC1 is complete for production only after the owner has applied it.
The isolated E2E pass exercises this exact sequence.

### Photos

| Photo | DE alt | EN alt |
|---|---|---|
| Portrait (square, `Portrait-Simon-Jul-28-2022-10`) | Porträt von Simon: lächelnd, mit grau melierten Haaren und Bart, vor dunklem Hintergrund | Portrait of Simon smiling, with greying hair and a beard, against a dark background |
| Trübsee waterfall (`4-Trubsee-16.07.2022`) | Wasserfall, der über dunkle Felsen zwischen grünen Hängen beim Trübsee hinabstürzt | Waterfall cascading over dark rocks between green slopes near Trübsee |

### DE (`about/de`)

- **Titel:** Über mich
- **Beschreibung:** Entdecke auf Simon's Wanderlust Simons Reisen und persönliche Geschichten. Erfahre mehr über mich und meine Abenteuer.

```markdown
Ich bin Simon und begeistere mich seit einigen Jahren für das Reisen. Hier möchte ich etwas über mich und meine Erfahrungen erzählen. Ich freue mich nicht nur darauf, neue Reiseziele zu entdecken, sondern auch andere Kulturen kennenzulernen und die Schönheit der Welt zu bewundern. Meine Reisen führten mich unter anderem an die Strände Mittelamerikas und auf die griechischen Inseln und haben mir unvergessliche Erinnerungen geschenkt. Sie haben mich geprägt und meine Sicht auf die Welt bereichert.

Seit einigen Jahren beschäftige ich mich intensiv mit der Fotografie. Es bereitet mir grosse Freude, die atemberaubende Schönheit der Welt durch die Linse meiner Kamera einzufangen. Ausserdem halte ich meine Reiseerlebnisse und meine Begeisterung für den Sport gerne in Fotos und Videos fest. 2021 bis 2022 habe ich einen CAS in Fotografie absolviert, um meine Fähigkeiten zu verbessern und mein Wissen zu vertiefen. Diese Weiterbildung hat nicht nur mein technisches Können erweitert, sondern auch meine kreative Perspektive bereichert.

<!-- Trübsee-Foto hier mit dem Foto-Werkzeug einfügen -->

## Meine Ausbildung

Mein Weg in die Welt der Informatik begann mit einer Ausbildung zum Informatiker, gefolgt von einer intensiven Weiterbildung in Informatik an einer Höheren Fachschule. Mein Wissensdurst führte mich anschliessend zu einem Bachelorstudium an einer Fachhochschule.

## Erkenntnis

In meinen ersten Berufsjahren im Helpdesk erkannte ich schnell, dass mich mein Interesse und meine Fähigkeiten zu komplexeren technischen Herausforderungen und einem tieferen Verständnis der Technologie drängten. Diese Erkenntnis war der Wendepunkt, der mich motivierte, mich weiterzubilden und auf spezialisierte Bereiche der Informatik zu konzentrieren.

## Schwerpunktwechsel zu Linux

Während meines Bachelorstudiums entdeckte ich meine Faszination für Linux-Systeme. Der Wechsel zu Linux war nicht nur eine berufliche Entscheidung, sondern auch eine persönliche Vorliebe, die mir einen essenziellen und spannenden Bereich der Informatik eröffnete. Die Arbeit mit Linux hat mir auch gezeigt, wie wichtig diese Systeme als Basis für künftige Themen und Technologien sind.

## Fachwissen

Mein berufliches Fachwissen ist breit und vielfältig: Ich habe umfangreiche Erfahrung mit Ansible, Linux-Basissystemen, Container-Technologien sowie Web- und Datenbankservern gesammelt. Damit entwickle und optimiere ich komplexe IT-Lösungen.

## Meine Vorhaben

Ich bin immer auf der Suche nach neuen Herausforderungen und Projekten, um meine Fähigkeiten und Kenntnisse weiterzuentwickeln. Aktuell liegt mein Fokus auf Fotografie, Videografie, Technologie und persönlicher Entwicklung. In diesen Bereichen möchte ich meine Expertise ausbauen und neue Möglichkeiten erkunden; meine Leidenschaft dafür motiviert mich, kontinuierlich dazuzulernen.
```

### EN (`about/en`)

- **Title:** About me
- **Description:** Discover Simon's journeys and personal stories on Simon's Wanderlust. Find out more about me and my adventures.

```markdown
I'm Simon, and travelling has been my passion for a few years now. Here I'd like to tell you a little about myself and my experiences. I look forward not only to discovering new destinations but also to getting to know other cultures and marvelling at the beauty of the world. My travels have taken me to the beaches of Central America and the Greek islands, among other places, and left me with unforgettable memories. They have shaped me and enriched my view of the world.

For a number of years I have been deeply involved in photography, and it gives me great pleasure to capture the breathtaking beauty of the world through the lens of my camera. I also like to record my travels and my enthusiasm for sport in photos and videos. From 2021 to 2022 I completed a CAS in photography to improve my skills and deepen my knowledge. This training not only expanded my technical skills but also enriched my creative perspective.

<!-- Insert the Trübsee photo here with the photo tool -->

## Education

My journey into IT began with an apprenticeship as a computer scientist, followed by intensive further training in computer science at a college of higher education. My thirst for knowledge then led me to a bachelor's degree at a university of applied sciences.

## Realisation

In my first years on the helpdesk, I quickly realised that my interests and skills were pushing me towards more complex technical challenges and a deeper understanding of technology. This realisation was the turning point that motivated me to continue my education and focus on specialised areas of IT.

## Change of focus to Linux

I discovered my fascination with Linux systems during my bachelor's degree. Switching to Linux was not only a professional decision but also a personal preference that let me immerse myself in an essential and exciting area of computer science. Working with Linux has also shown me how important these systems are as a foundation for future topics and technologies.

## Expertise

My professional expertise is broad and diverse: I have gained extensive experience with Ansible, Linux base systems, container technologies, and web and database servers. With these skills I develop and optimise complex IT solutions.

## My plans

I am always looking for new challenges and projects to develop my skills and knowledge. My current focus is on photography, videography, technology and personal development. I want to build my expertise in these areas and explore new opportunities; my passion for them keeps me learning and growing.
```
