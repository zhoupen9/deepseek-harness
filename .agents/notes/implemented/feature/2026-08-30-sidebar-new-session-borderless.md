# Agent Note: Sidebar New Session borderless left-aligned control

Status: implemented

English | [中文](2026-08-30-sidebar-new-session-borderless.zh.md)

## Problem

The expanded sidebar's New Session control was a filled 38px bar — elevated button fill with an l2 border — whose icon and label were centered. The backdrop made it read as a heavy call-to-action competing with the brand row above it and the workspace list below it, and the centered layout left the label's left edge ragged against the column's other left-aligned rows.

## Decision

Render the expanded New Session control borderless — no background and no border — with its icon and label left-aligned. Hover keeps the shared interactive background (`--dsw-alias-interactive-bg-hover`) already used by the icon buttons, so the control still reads as interactive without a resting backdrop. The collapsed rail keeps its lone icon centered via `justify-content: center`, because left-alignment applies only to the wide icon-plus-label form.

## Alternatives considered

**Left-align only, keep the backdrop** — rejected. The backdrop is the heavier problem: a borderless left-aligned control de-emphasizes the button to match the brand row's quiet New Session shortcut.

**Remove hover feedback too** — rejected. A subtle hover keeps parity with the other shell icon controls and preserves the affordance on the rail, where the control is icon-only.

## Consequences

The expanded New Session control now reads as a quiet, left-aligned row consistent with the rest of the sidebar, with hover as its only emphasis. The change is confined to `SidebarRoot.module.css` (the `.newSession`, `.newSession:hover`, and `.collapsed .newSession` rules); no markup or localization changes.

## Verification

The `sidebar-styles.client.spec.ts` suite asserts `.newSession` is `justify-content: flex-start`, `background: transparent`, and `border: none`, that hover uses `--dsw-alias-interactive-bg-hover`, and that `.collapsed .newSession` re-centers its icon.
