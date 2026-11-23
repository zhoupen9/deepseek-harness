# Agent Note: Chat file opens route to the Files view when one is registered

Status: implemented

English | [中文](2026-08-31-chat-file-open-view-routing.zh.md)

## Problem

Chat page file links open through `openFile`: the `chatFileMentions` mention resolver, the turn-tail chips, and the file-tool rows call it, and it opens the path natively on the Host (`openWorkspacePath` → `openNativePath`, [tool-call file open in OS](../../archived/feature/2026-07-28-tool-call-file-open-in-os.md)). The out-of-tree `ui-files` plugin wants a chat file link to open inside its Files explorer and switch the conversation to that tab. The platform already delivers that gesture: `ConversationSession` passes `openView(view, focus)` to every `conversation.view` component, which sets the active tab and addresses a one-shot focus request the addressed view consumes (the Files view honors `view === 'files'` with `focus = path`). But the chat file-open owners — `TurnTailOwnerProps` (what a `chatFileMentions` provider's `forClosing(owner)` receives) and `ChatNodeOwnerProps` (keyed node renderers, including file-tool rows) — carried only `openFile`, and the chat's file-open entry point always opened natively, so no surface could route an open to a Conversation View.

## Decision

**Chat file opens route through one decision point.** `ChatView.requestOpenFile` — the `openFile` every chat surface calls (tool rows, produced-file chips, shipped prose mentions) — switches to the `files` conversation view when that view is registered, and falls back to the Host opener otherwise. The Files view id is the protocol constant `FILES_VIEW_ID = 'files'`, matching the id the ui-files plugin registers for its `conversation.view` entry; `ConversationSession` now hands the session's registered view roster to every view entry (`ConvViewOwnerProps.conversationViews`), and `ChatView` reads it for the decision.

**The owners also carry the view opener.** `ChatView` passes its `openView` owner prop through `ChatNodeSeat` into the routed `ChatNodeOwnerProps`, and `TurnTailNodeView` and `AssistantNodeView` copy it into the `TurnTailOwnerProps` they build — so a `chatFileMentions` provider can route a mention click itself (`owner.openView('files', path)`) instead of going through `openFile`.

## Alternatives considered

**A new Host RPC.** Rejected: tab switching is browser-side conversation-store state; the Host has no part in it.

**A `chatFileOpen` service consulted by `openFile`.** Rejected: the provider would still need `openView`, which only the component layer holds; the owner-prop threading plus the roster-gated routing in `ChatView` is the minimal seam.

## Consequences

In a deployment with a registered `files` view, every chat file link — tool-row paths, produced-file chips, shipped prose mentions — switches to that tab with the path as its focus, and the Files view reveals the file (completing the one-shot request). Deployments without the view keep the exact prior behavior: the Host opens the path natively. `ConvViewOwnerProps` gains `conversationViews` (the catalog regenerates; view-entry builders in tests were updated). The `~/.dsh` ui-files provider routes its own prose mentions via `owner.openView`, and its Files view already consumes the focus request.
