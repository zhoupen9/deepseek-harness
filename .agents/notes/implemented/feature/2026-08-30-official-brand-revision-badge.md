# Agent Note: Official brand with a footer revision label

Status: implemented

English | [中文](2026-08-30-official-brand-revision-badge.zh.md)

## Problem

The `ui-brand-official` plugin renders the DeepSeek Harness wordmark in the `sidebar.brand.name` slot, but only the shell fallback — the "DSH Local Build" label — shows the build's git revision. A local developer who enables the official brand therefore loses the revision identifier: the revision is computed by the sidebar's fallback branch and never renders once the name slot is occupied.

## Decision

The sidebar shell declares a new `sidebar.footer.version` seat below the brand row, above New Session, and `ui-brand-official`'s `OfficialBuildRevision` renders the opt-in revision label there. The revision is no longer stacked under the wordmark, so the brand row stays a single clean line and the shell's brand-row top-align accommodation is gone. The opt-in is the build-time public value `DSH_CLIENT_REVISION_BADGE=true`; the text is `version[-commit]`, compiled from the same `DSH_CLIENT_VERSION` and `DSH_CLIENT_COMMIT_HASH` values the sidebar fallback reads. It renders in subtle gray (`--dsw-alias-label-tertiary`) below the brand row, hidden on the collapsed rail, and omitted when the flag is off or `DSH_CLIENT_VERSION` is absent. Official release builds do not set the flag, so their wordmark stays clean; a local build sets it alongside `DSH_CLIENT_BUILD_PROFILE=official` and `DSH_CLIENT_TITLE` to get the official brand plus the revision.

## Alternatives considered

**Render the revision below the wordmark in the name slot** — rejected. Stacking it under the 24px wordmark forces the brand row to grow to two lines and requires top-aligning the shell's brand slots; a seat below the brand row keeps the curated wordmark clean and puts the revision near the brand without crowding it.

**Always render the revision when version metadata is present** — rejected. Official release builds also inline `DSH_CLIENT_VERSION` and `DSH_CLIENT_COMMIT_HASH`, so an unconditional revision line would change the curated release wordmark; the opt-in flag keeps the release appearance unchanged.

**Embed the wordmark into the shell fallback** — rejected. The shell fallback is generic and already renders the DeepSeek whale mark; putting the full wordmark there would move brand artwork into the shell instead of keeping it in the brand plugin.

## Consequences

A local build can show the official wordmark plus the git revision by setting `DSH_CLIENT_REVISION_BADGE=true`. The revision label lives in `ui-brand-official` — one CSS module and a formatting helper — rendered into the shell-owned `sidebar.footer.version` seat below the brand row, while the sidebar brand row keeps its single-line centered layout. The revision formatting is a small private helper rather than a shared export, because exporting a helper would widen a client plugin's public API for a small fold.

## Verification

The `browser-plugin.client.spec.tsx` suite asserts the revision label renders with the `version-commit` text when opted in, and is absent when the flag is off, when version metadata is missing, and on the collapsed rail. The `sidebar-root.client.spec.tsx` and `apply.client.spec.tsx` suites assert the shell declares and renders `sidebar.footer.version` with the same `wide` flag as the other foot seats.
