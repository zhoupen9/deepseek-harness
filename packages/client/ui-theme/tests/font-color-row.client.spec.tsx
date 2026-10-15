// @vitest-environment jsdom
/** FontColorRow behavior: copy, per-mode swatch values, color writes, and resets. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FontColorRow } from '../src/client/FontColorRow.tsx'
import type { FontColorRowComponentProps } from '../src/client/FontColorRow.tsx'
import { createFontColorRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'fontColor.title': 'Font color',
  'fontColor.description': 'Default text color for light and dark mode',
  'fontColor.light': 'Light mode',
  'fontColor.dark': 'Dark mode',
  'fontColor.reset': 'Reset',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

// Every session-scope fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
// Access hooks the session, workspace, and remote-access plugins merge into GlobalStandardProps.
const useSessionAccess: GlobalStandardProps['useSessionAccess'] = () => false
const useWorkspaceAccess: GlobalStandardProps['useWorkspaceAccess'] = () => false
const useRemoteAccess: GlobalStandardProps['useRemoteAccess'] = () => false

type StatusSnapshot = Parameters<Parameters<FontColorRowComponentProps['useSessionStatus']>[0]>[0]
const noStatus: StatusSnapshot = new Map()
const useSessionStatus: FontColorRowComponentProps['useSessionStatus'] = selector => selector(noStatus)

function mount(light = '', dark = '') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createFontColorRowStore().create()
  store.actions.sync(light, dark, 0)
  const setFontColorLight = vi.fn()
  const setFontColorDark = vi.fn()
  const props: FontColorRowComponentProps = {
    useResource,
    usePanelInfo,
    useSessions: emptySessions(),
    useSessionAccess,
    useWorkspaceAccess,
    useRemoteAccess,
    useSessionStatus,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setFontColorLight,
    setFontColorDark,
  }
  render(<FontColorRow {...props} />)
  return { store, setFontColorLight, setFontColorDark }
}

const swatch = (name: string): HTMLInputElement =>
  screen.getByLabelText(name) as HTMLInputElement

const resetButton = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

describe('FontColorRow', () => {
  it('renders the copy and both palette-mode swatches', () => {
    mount()
    expect(screen.getByText('Font color')).toBeDefined()
    expect(screen.getByText('Default text color for light and dark mode')).toBeDefined()
    expect(screen.getByText('Light mode')).toBeDefined()
    expect(screen.getByText('Dark mode')).toBeDefined()
    expect(resetButton('Reset Light mode')).toBeDefined()
    expect(resetButton('Reset Dark mode')).toBeDefined()
  })

  it('shows the persisted color per mode, or the shipped palette default while unset', () => {
    mount()
    expect(swatch('Light mode').value).toBe('#0f1115')
    expect(swatch('Dark mode').value).toBe('#f9fafb')
    cleanup()
    mount('#ABCDEF', '#012345')
    expect(swatch('Light mode').value).toBe('#abcdef')
    expect(swatch('Dark mode').value).toBe('#012345')
    cleanup()
    // Three-digit hex expands to the six-digit value a color input needs.
    mount('#fff')
    expect(swatch('Light mode').value).toBe('#ffffff')
    cleanup()
    // A non-hex durable form (hand-edited settings) cannot feed a native
    // color input; the swatch falls back to that mode's palette default.
    mount('rgb(15, 17, 21)')
    expect(swatch('Light mode').value).toBe('#0f1115')
  })

  it('color input changes route to the per-mode writer', () => {
    const b = mount()
    fireEvent.change(swatch('Light mode'), { target: { value: '#123456' } })
    expect(b.setFontColorLight).toHaveBeenCalledWith('#123456')
    fireEvent.change(swatch('Dark mode'), { target: { value: '#654321' } })
    expect(b.setFontColorDark).toHaveBeenCalledWith('#654321')
    // No store write yet: the display keeps the previous (unset default) value.
    expect(swatch('Light mode').value).toBe('#0f1115')
  })

  it('each mode reset writes back an empty string (no override)', () => {
    const b = mount('#101010', '#202020')
    fireEvent.click(resetButton('Reset Light mode'))
    expect(b.setFontColorLight).toHaveBeenCalledWith('')
    fireEvent.click(resetButton('Reset Dark mode'))
    expect(b.setFontColorDark).toHaveBeenCalledWith('')
  })
})
