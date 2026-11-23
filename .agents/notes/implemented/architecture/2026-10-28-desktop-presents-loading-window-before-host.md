# Agent Note: Present the Desktop loading window before Host startup

Status: implemented

English | [中文](2026-10-28-desktop-presents-loading-window-before-host.zh.md)

## Problem

The shell creates the main window hidden and first shows it from `enterWorkspace`, which runs after profile preparation, the login-shell read, the complete Host Web profile, and the welcome credential and locale read. A launch therefore creates the tray icon immediately but presents no window for the whole Host startup, even though the shared loading page has already loaded into the hidden window. Users cannot distinguish startup work from a stalled application, and tray activation, a second launch, and `dsh://open` do nothing visible during that period.

## Decision

`reconcileBackend` presents the main window as soon as its initial `dsh-app://app/` document loads, before it starts the Host. The shared loading page is visible for profile preparation, login-shell capture, Host startup, and client plugin loading. This restores the presentation timing of the [archived immediate-window decision](../../archived/architecture/2026-09-09-desktop-immediate-window-and-direct-start.md).

`bootPagePresented` records that the boot page is the current surface, so activation through the tray, a second launch, or `dsh://open` focuses the presented window instead of ignoring it. The flag clears when the welcome window or workspace replaces the page. `openInitialWindow` still chooses that surface only after Host readiness and the credential and locale read: the welcome window opens and hides the main window, while the workspace path reveals the document that already shows the loading page.

A failed initial document load does not present the window; the native recovery dialog remains the only visible surface. A later startup failure leaves the presented loading page behind that dialog. The [welcome window note](2026-09-08-desktop-welcome-window-material.md) supplies the onboarding decision this presentation wraps.

## Alternatives considered

**Keep the window hidden until the Host is ready.** The loading page would still load and draw, but users would see only a tray icon for the multi-second Host startup and activation during that period would remain unresponsive. Presenting the already-loaded page adds no startup work.

**Create the window shown (`show: true`).** That presents an empty window before the packaged document paints. Presenting after the initial load shows the boot page without a blank frame.

**Wait for the welcome decision before presenting anything.** The decision needs Host credentials and locale, so it inherits the whole delay it is meant to hide.

**Decide onboarding from a local completion marker.** The [welcome window note](2026-09-08-desktop-welcome-window-material.md) records why a completion flag cannot replace the cold-start credential check; a local marker would also diverge from account state changed by sign-out or another client.

## Consequences

The loading page is visible for the complete Host startup, and the tray, Dock, a second launch, and `dsh://open` can focus it. Window controls work from the first loaded frame. Startup failures show the native recovery dialog over the loading page.

First-run onboarding briefly shows the boot page before the welcome window replaces it. A window the user hides during startup is shown again when the workspace opens. Presented-before-startup and welcome-replacement ordering are covered by the Desktop startup tests.
