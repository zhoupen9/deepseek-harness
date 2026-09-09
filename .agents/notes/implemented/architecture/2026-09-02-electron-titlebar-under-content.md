# Agent Note: Electron title bar under page content — z-order below content, interactive controls win over the drag mask

Status: implemented

English | [中文](2026-09-02-electron-titlebar-under-content.zh.md)

## Problem

The Electron shell (apps/electron) draws its own window chrome in a frameless window; the frameless window, injected controls, IPC channels, and the WindowChrome seam were decided in [Electron frameless window with injected title-bar controls](../../archived/feature/2026-08-30-electron-frameless-window-chrome.md) (archived: the injected controls were later removed, leaving only the drag strip). The original implementation floated a 28px strip on top of the Web UI (z-index 2147483000) whose whole area was `-webkit-app-region: drag`: the top 28px of every page was a dead strip — page controls there could not be clicked. The desired behavior is the inverse: the page must not have a dead band at the top — interactive controls that overlap the title-bar strip receive the interaction, and the window is draggable only over the inert parts of the top strip.

## Decision

Electron's `-webkit-app-region` regions are geometric rectangles, not z-order aware (union of drag rects minus union of no-drag rects, point-tested at the native window level; the maintainer ruling in electron/electron#11768 applies). Lowering the strip's z-index alone cannot make overlapped controls interactive: a covered drag rect still drags. The shipped design keeps the original layout — no dedicated title bar, no reserved space — and changes the drag semantics:

- The drag strip (`#dsh-titlebar`) is prepended to `<body>` with `z-index: 0` and stays transparent, so page content paints above it and wins `document.elementFromPoint`. The shell injects no window controls (minimize / restore / close ride the OS or window-manager shortcuts), so nothing else floats above the page.
- The strip is split into drag segments. A controller re-evaluates each segment with `document.elementFromPoint` (pointer moves near the strip, capture-phase scroll, resize, pointer down; rAF-throttled). A segment flips to `no-drag` (`covered` class) exactly when an interactive control — a `button`, link, input, `[tabindex]`, an interactive `[role]`, or a descendant of one — is the topmost element over it, carving that control's area out of the drag mask. Inert page elements (the app background shell, header padding, plain text) keep the segment draggable, so the window stays movable over the non-interactive parts of the top strip.
- The native mask updates asynchronously (style recalc → layout → IPC), so a click within roughly one frame of the pointer entering a covered segment may still start a window drag; the pointer-down and pointer-move refreshes keep that window short. This residual race is accepted and documented.

## Consequences

- The Electron shell keeps its original look: no band, no layout shift, and no window controls over the page. The plain `dsh web` browser build is untouched (no client-package changes, no snapshot impact).
- Interactive controls at the top of the page (sidebar toggles, conversation header tabs and actions, details header controls) are clickable again; the strip drags the window over inert top areas.
- Overlays (modals, menus, tooltips, toasts; z-index >= 100 in the client) that extend into the top strip win interactions there, since their controls match the interactive classification.
- The interactive classification is a heuristic: an element counts as interactive by tag, `[tabindex]`, or interactive `[role]`, so an inert element with a click handler (a plain `div` with an `onClick`) counts as inert and stays draggable. The app's top-strip controls are all `<button>`/link elements, so the heuristic covers them.

## Alternatives considered

- **Reserved top band** (a 28px content-free strip below the chrome): rejected by the user — it reads as a dedicated title bar and shifts the page down.
- **Strict drag-only-where-uncovered** (a segment yields to any page element, interactive or not): rejected by the user — the app always covers the top strip, leaving no drag surface at all.
- **Simple z-index flip** (strip below content, no other change): rejected — Electron drag regions are geometric and z-order-blind, so covered controls would remain blocked by the drag mask.
- **Manual window dragging from the renderer** (mousedown plus moveBy over IPC): rejected — janky compared with the native caption drag.
- **`titleBarStyle: 'hidden'` / `titleBarOverlay`**: rejected — the native overlay draws controls above content, the opposite of the requested z-order.
