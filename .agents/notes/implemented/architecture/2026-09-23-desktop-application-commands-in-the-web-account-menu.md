# Agent Note: Desktop application commands in the Web account menu

Status: implemented

English | [中文](2026-09-23-desktop-application-commands-in-the-web-account-menu.zh.md)

The sidebar account menu carries the Desktop shell's application commands, minus the macOS-only window visibility commands, and only requests effects the main process performs.

## Problem

The Desktop shell's application commands live in the native application menu. The primary Linux window is frameless with an auto-hidden menu bar, and Windows replaces the application menu with the caption's Application popup, so no native surface offers those commands on every platform. The macOS menu additionally carries window visibility commands that act on the OS window rather than the product.

## Decision

The sidebar account launcher renders a shell application group above the account rows and Quit below them: About DeepSeek Harness, Check for Updates…, Reload Page and Restart App and Host in a development build, and Quit DeepSeek Harness. The macOS-only Hide, Hide Others, and Show All commands stay in the native menu.

The Web UI only requests these commands. `apps/desktop/src/preload-app.ts` exposes `dshDesktop.application` — `development` plus `about`, `quit`, `reload`, and `restart` — to `dsh-app://app` documents, and every handler keeps the existing `assertProductSender` check. `packages/client/ui-settings-account/src/client/desktop-application.ts` projects that carrier onto the launcher's commands and joins the existing update carrier for Check for Updates…, so the update prompt keeps one channel. `packages/client/ui-settings-account` builds the group only for a carrier that advertises `protocolVersion: 1` with the application and update groups; older shells keep the account-only menu.

Reload and restart stay development-only in both places. `createWindow` appends the `--dsh-desktop-development` renderer argument only for the primary window of an unpackaged build, the preload reports it as `development`, and the main process independently rejects those channels when it runs packaged. About keeps the platform split of the native menu: the shell's dimmed dialog on Windows, where Electron's fallback is a bare message box, and the native About panel elsewhere.

## Alternatives considered

**Keep the native menu as the only route.** The Linux frameless window and the Windows caption menu already provide these commands, but neither is where a user looks for account-level actions, and neither is reachable while window chrome stays hidden.

**Serve a shell-owned command list to the Web UI.** Returning descriptors asynchronously would make the menu's contents depend on a request and force loading state into the launcher, while the labels and icons are Web-owned copy. A fixed carrier with a development flag keeps rendering synchronous and keeps copy in the locale dictionaries.

**Expose reload and restart in every build.** Electron's own menu gates them on development; reload drops in-page viewing state and restart stops the running Host without an update prompt's task preparation, so a packaged build offers only the shutdown path.

**Mirror the macOS window visibility commands in the Web menu.** Those commands act on the OS window from a native menu that already carries them; the Web menu owns account and application commands.

## Consequences

The account package reads a second Desktop carrier, the same pattern `ui-settings-general` and `ui-sidebar-browser` already use for their own capabilities. Version skew is explicit: a shell that predates this carrier keeps the account-only menu instead of offering rows that cannot work.

Development gating exists twice on purpose. The preload hides the rows, and the main process rejects the channels in a packaged build, so a modified renderer cannot reach them. The Web Quit command and the native Quit item run the same ordered shutdown.

## Testing

`packages/client/ui-settings-account/tests/account.client.spec.tsx` pins the rendered rows with and without the development commands, each command's dispatch, and the console report for a rejected command. `apply.client.spec.ts` pins the composition from a stubbed `dshDesktop`, and `desktop-application.client.spec.ts` covers the carrier projection and its absence cases. `apps/desktop/tests/main-startup.spec.ts` covers the About platform split, the development reload and restart path, the packaged rejection, and the quit request; `apps/desktop/tests/preload-app.spec.ts` covers the exposed channels and the development flag.

## Related

The [DeepSeek account browser login](2026-09-14-deepseek-account-login.md) note owns the launcher's sign-out placement and the account stream.
