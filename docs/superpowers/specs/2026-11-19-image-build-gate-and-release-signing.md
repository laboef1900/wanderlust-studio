# Image build gate and release signing

Status: owner-directed 2026-11-19 ("proceed" to the two CI improvements left out of the
2026-11-19 review). Risk: **high** for the release-pipeline change, **normal** for the PR build
gate.

## Approval and scope

The owner approved two changes after the 2026-11-19 CI review:

1. A build-only Docker check on pull requests, so a broken `Dockerfile` or a missing COPY input
   fails review instead of the next tagged release.
2. A signature and an installed-image SBOM for what is published, replacing the previous
   documented position that "no image signing, provenance attestation or installed-image SBOM is
   claimed" (`SECURITY.md`, *GitHub automation*).

No release, tag, push to a protected branch, deployment, or registry mutation is authorized by
this implementation request. The first real signature appears on the next `v*.*.*` release.

**Non-goals.**

- **No buildx provenance/SLSA attestation.** Candidates are built once per native runner and
  merged with `docker buildx imagetools create`. Per-arch buildx provenance turns each candidate
  into an index, and the promoted artifact into an index of indexes; consumers resolve nested
  indexes inconsistently, and `promote.mjs`'s digest comparison assumes a single manifest per
  candidate. Genuine SLSA provenance needs one multi-platform build, which the native-only
  (no-QEMU) qualification design forbids. This is a documented limitation, not an oversight.
- **No change** to qualification, candidate digests, promotion, tags, release eligibility, or the
  required-check set.
- **The image gate is not a required check.** It is path-scoped and excluded for fork heads, so it
  must never be able to block a legitimate merge.

## The PR image gate

New `ci.yml` job `image · docker build`, `ubuntu-latest`, 45-minute timeout, `contents: read`.

- Runs for pushes to `dev`/`main`, manual dispatches, and PRs whose head repository is this
  repository. Fork heads are excluded because they cannot read `DHI_TOKEN`; a skipped job reports
  "Skipped", never a false green.
- A `scope` step decides whether the image inputs changed, comparing `github.event.before` (push)
  or `pull_request.base.sha` (PR) against the head commit. When the base is unknown — zero SHA,
  unreachable commit, shallow history — it builds. **Fail-safe rule: unknown base means build.**
- Inputs: `Dockerfile`, `.dockerignore`, `LICENSE`, `NOTICE`, `.github/native-owner`,
  `uploader/package.json`, `uploader/package-lock.json`, `uploader/scripts`, `site/package.json`,
  `site/package-lock.json`, `site/scripts`, `site/src/i18n/ui.ts`, and the three
  `docs/third-party-*.json` files. These are the paths the `Dockerfile` copies by name or that
  change the installed dependency set.
- The build uses `docker buildx build --platform=linux/amd64` with **no output target and no
  push**: the image exists only in the builder cache. Registry credentials are limited to
  `docker login dhi.io` for the hardened base images, discarded in an `always()` step.
- Layers are exported to the GitHub Actions cache (`type=gha, mode=max, scope=image-amd64`),
  because a cold build downloads the ~524 MB Protomaps slice and runs `npm ci` twice.

### The arm64 leg

`image-arm64` builds the same image for `linux/arm64` **only for pushes to `main`**, and only when
the `image` job's scope decision was `build=true` (it consumes that job's `build` output).

- It runs on `ubuntu-24.04-arm`, because the `Dockerfile` executes code during the build and this
  repository forbids QEMU.
- PRs and `dev` pushes stay amd64-only. Consequence accepted with this design: an arm64-only
  regression reaches `main` before it is seen. It is still caught before the tag — a failed
  `ci.yml` on the main push makes `release.yml`'s eligibility check refuse every `v*.*.*` tag for
  that revision.
- Its layers use a separate cache scope (`image-arm64`) so the two architectures never share
  layers.
- Not a required check either; it does not run on PRs.

## Signature and SBOM

Candidate job (per native architecture), after the qualified image is pushed:

1. `anchore/sbom-action` scans the pushed candidate by reference and writes
   CycloneDX JSON to `$PRIVATE_ROOT/sbom/<arch>.cdx.json` (`upload-artifact: false`,
   `upload-release-assets: false`; registry credentials are the workflow token).
2. `cosign sign` keyless-signs the candidate digest, and `cosign attest --type cyclonedx` attaches
   the SBOM to that digest.
3. The SBOM is uploaded as `qualified-sbom-<arch>`; the existing `qualified-digest-<arch>` artifact
   is unchanged, so `promote.mjs`'s `qualified-digests/<arch>.json` path still holds.

Release job, after promotion:

4. `cosign sign` keyless-signs the **promoted index digest** — the reference operators deploy.
5. `cosign verify` with an explicit certificate identity
   (`^https://github\.com/laboef1900/wanderlust-studio/\.github/workflows/release\.yml@refs/tags/v`)
   and OIDC issuer (`https://token.actions.githubusercontent.com`) proves the signature the job
   just made is verifiable. **Fail-closed: an unverifiable signature fails the release.**
6. SBOMs are attached to the GitHub Release as assets.

Keyless signing needs `id-token: write` on both jobs. No long-lived signing key exists, so there is
no key to rotate or leak; the tradeoff is a runtime dependency on the public Fulcio/Rekor
instances and on `sigstore/cosign-installer` plus `anchore/sbom-action`, both SHA-pinned.

## Invariants and trust boundaries

- Published image bytes are unchanged by this spec. Same classic build, same qualification, same
  digests, same promotion by digest. Signing and SBOMs are additive registry metadata; they cannot
  alter the manifest a digest names.
- Signature and SBOM failures fail the release. A partially signed release is not a release.
- PR runs still receive no GHCR credentials, no signing identity and no write permissions. The new
  jobs get `DHI_TOKEN` only, only on same-repository heads (and, for arm64, only on `main`
  pushes), and discard it.
- The arm64 image build cannot run on a PR, a fork, or a `dev` push: `image-arm64` requires
  `needs.image.outputs.build == 'true'` **and** a `push` to `refs/heads/main` on a public
  repository. A skipped arm64 job can therefore never be mistaken for a passing arm64 build.
- Dependabot cannot reach the image gate's write-free path differently than any other PR.
- `security-events`, `packages`, `contents: write` and `id-token` grants exist only in
  `security.yml` and `release.yml`, where they already were (plus `id-token` added to the release
  candidate and release jobs).

## Misuse cases considered

- **A PR edits `Dockerfile` to leak the DHI token.** The build never receives the token in its
  environment; only the `docker login` step does, in a separate step. Docker build args are not
  secrets and none is passed.
- **A fork PR claims a green image check.** Excluded by job `if:`; the job is skipped, and it is
  not a required check.
- **A tampered SBOM.** The attestation is signed and bound to the digest; consumers verify it with
  the same identity rules as the image signature.
- **Signing the wrong artifact.** The signature is applied to `steps.promote.outputs.digest`, which
  is the digest produced by `promote.mjs` from the two qualified candidate digests, and it is
  verified before the GitHub Release is created.
- **Base-image drift makes the gate red for unrelated PRs.** The gate only rebuilds when an input
  path changes or the base is unknown; a red gate is visible but never blocking.

## Acceptance and verification

- `actionlint` (the digest-pinned image already used by CI) passes on both workflows.
- `node --test .github/release/*.test.mjs` still passes; `promote.mjs`/`eligibility.mjs` are
  untouched.
- The scope step is exercised locally against real commit ranges: an image-input change builds, a
  docs-only change skips, and an unreachable base builds.
- The arm64 leg's gating is static: `actionlint` validates the expressions and `needs` wiring; its
  native build cannot run locally and first executes on the next `main` push that changes an image
  input.
- Local Playwright/Vitest suites are unaffected.
- **Not verifiable locally, reported as such:** the actual DHI build, GitHub Actions cache export,
  Fulcio/Rekor signing, and registry attestation. The first `workflow_dispatch` of `ci.yml` after
  merge is the intended check that the gate builds; the next release is the first signature.

## Recovery and containment

- The image gate is additive: delete the job to remove it; nothing else depends on it.
- Signing steps are additive and positioned after the digest is recorded and before the release is
  created. Reverting them restores the previous behaviour; already-published images keep their
  signatures and remain valid.
- If Fulcio/Rekor is unavailable, the release fails before creating a GitHub Release. Rerun the
  failed jobs of the same run — never rebuild a different image under the same tag.
- If the SBOM action or syft fails, the release fails; a retry is safe because it does not change
  the qualified digests.
