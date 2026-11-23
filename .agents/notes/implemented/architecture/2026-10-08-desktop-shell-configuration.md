# Agent Note: Desktop shell configuration independent of the Host

Status: implemented

English | [中文](2026-10-08-desktop-shell-configuration.zh.md)

## Problem

Desktop updates and native recovery can run before the Host starts or while it is unavailable. Depending on Host configuration prevents these functions from resolving their preferences when needed. A shared settings page does not identify which process owns each preference.

## Decision

Electron main owns `userData/desktop/settings.json` independently of Host startup and Cordis evaluation. The test authentication popup switch uses this file; the [Desktop reference](../../../../apps/desktop/README.md#local-desktop-settings) owns its fields and behavior.

Ownership follows runtime dependencies: Electron-owned functions needing configuration before Host startup or while the Host is unavailable use shell configuration. Host plugin settings, including shared Web/Desktop preferences, continue to use Cordis. Displaying a setting in Desktop alone does not justify shell ownership. A unified settings interface can use separate storage owners.

Startup appearance before Host evaluation uses derived state rather than a second preference. The main window's Web UI reports its theme source; Electron stores the value in `userData/desktop/theme.json` and applies it to the native theme, window canvas, and packaged index at the next launch. Host settings remain the only authoritative preference: the Host's index injections replace the hint after readiness, and a missing or invalid hint falls back to the operating system.

The `desktop` subdirectory groups shell configuration without relocating existing files. The [shortcut decision](2026-09-20-device-local-shortcut-preferences.md) retains ownership of `userData/keybindings.json` and its persistence semantics. The [shared Web application decision](2026-09-10-desktop-web-wrapper.md) still governs Host composition and profile configuration.

## Alternatives considered

**Put every preference in Cordis.** This requires a working Host. Reading `cordis.patch.yml` directly in Electron duplicates configuration evaluation; a patch alone omits plugin defaults and other configuration layers.

**Move every setting shown in Desktop.** Interface placement does not imply a Host-independent requirement. This splits shared Web/Desktop preferences and moves configuration away from its consuming plugins.

**Read the Host user-settings document for the startup theme.** It evaluates Cordis configuration layers before the Host exists, and its result still needs reconciliation with the Host's own index injections. The derived hint needs no evaluation and is replaced at readiness.

## Consequences

Shell and Host configuration have separate owners. Each setting needs documented ownership and effective timing. Independent shell configuration supports additional Host-independent functions without introducing a second application backend.

The theme hint is derived state: losing it falls back to the operating system, and the next Web UI report rewrites it. The Host remains the authority for the preference. Electron mirrors the palette contract of the ui-theme boot injections (`color-scheme`, `--dsh-boot-bg`, and `body[data-ds-dark-theme]`), so changing that contract updates both carriers. Existing settings are candidates for individual evaluation when their functionality changes or a Host-independent use is required. This is an evaluation direction, not a scheduled migration or predefined list. A migration must identify a single authoritative source, transfer existing values and define when changes take effect, without ambiguous precedence between two stores. Shared Host-managed settings remain in Cordis unless their ownership requirements change.
