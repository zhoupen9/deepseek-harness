# Agent Note: Electron shell permission requests

Status: implemented

English | [中文](2026-09-10-electron-shell-permission-requests.zh.md)

## Problem

The Electron shell ([apps/electron](../../../../apps/electron/README.md)) installs a session permission request handler that granted only `local-fonts`, the permission behind the Settings font pickers. Installing a request handler replaces Electron's grant-all default, so that single comparison denied every other permission request — including `clipboard-sanitized-write`, which backs every copy control in the Web UI. `navigator.clipboard.writeText` rejected with `NotAllowedError`, the shared `writeClipboard` helper reported the refusal, and the copy buttons silently did nothing.

## Decision

[`apps/electron/src/permissions.ts`](../../../../apps/electron/src/permissions.ts) owns the granted permission names, and `main.ts` answers each request through `permissionGranted`. The set names both permissions the Web UI needs: `local-fonts` for the Settings font pickers, and `clipboard-sanitized-write` for the copy controls. Every other request stays denied, so a page cannot obtain a permission the shell never declared while the handler is installed.

## Alternatives considered

**Remove the request handler and keep Electron's default.** Clipboard writes would be granted again, but so would any permission a page requests — media, geolocation, serial, USB — with no review. The font-picker grant exists so the shell declares what it needs; deleting the handler trades one unannounced denial for unannounced grants.

**Fall back to `document.execCommand('copy')` inside `writeClipboard`.** The helper already carries that fallback for hosts that omit the async Clipboard API (jsdom, insecure contexts), but it returns false on a refused write by design: the refusal is a configuration fact, and working around it would let the UI report success while the shell stayed misconfigured.

**Grant `clipboard-read` alongside the write.** No client code reads the clipboard through the async API; paste arrives as a native clipboard event, which carries its own implicit grant. Granting the read would widen the set for a capability nothing uses.

## Consequences

Copy controls work again in the Electron shell: message copy, markdown code blocks, terminal and diff blocks, workspace rows, and the session-log export all share `writeClipboard`. A Web UI capability that needs an unnamed permission still gets no write and no prompt — the same silent failure this note fixes — so the granted set is the one place to extend.

## Testing

[`apps/electron/tests/permissions.spec.ts`](../../../../apps/electron/tests/permissions.spec.ts) covers the granted set and the denial of permissions the Web UI has no consumer for. The handler's wiring into `session.defaultSession` runs only when the shell is launched with a system Electron binary; no automated suite starts one.
