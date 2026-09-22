// @vitest-environment jsdom
/** FontFaceRow behavior: title/description, the default option plus detected
 * families (each previewed in its own face), selection drives setFont, and the
 * displayed value follows the store mirror. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FontFaceRow, type FontFaceRowComponentProps } from '../src/client/FontFaceRow.tsx'
import { createFontFaceRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'variantFont.title': 'Font',
  'variantFont.description': 'Font used for interface text',
  'variantFont.default': 'Default',
}

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

type StatusSnapshot = Parameters<Parameters<FontFaceRowComponentProps['useSessionStatus']>[0]>[0]
const noStatus: StatusSnapshot = new Map()
const useSessionStatus: FontFaceRowComponentProps['useSessionStatus'] = selector => selector(noStatus)

function mount(families: string[], font = '') {
  const store = createFontFaceRowStore().create()
  store.actions.sync(font, 0)
  store.actions.setFamilies(families, false)
  const setFont = vi.fn()
  const props: FontFaceRowComponentProps = {
    useResource,
    usePanelInfo,
    useSessions: emptySessions(),
    useSessionStatus,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    titleKey: 'variantFont.title',
    descKey: 'variantFont.description',
    defaultKey: 'variantFont.default',
    setFont,
  }
  render(<FontFaceRow {...props} />)
  return { store, setFont }
}

describe('FontFaceRow', () => {
  it('renders the title, description, the default option, and one option per detected family', () => {
    mount(['Arial', 'Georgia'])
    expect(screen.getByText('Font')).toBeDefined()
    expect(screen.getByText('Font used for interface text')).toBeDefined()
    const combobox = screen.getByRole('combobox', { name: 'Font' }) as HTMLSelectElement
    expect(combobox.options).toHaveLength(3)
    expect(combobox.options[0]!.textContent).toBe('Default')
    expect(combobox.options[0]!.value).toBe('')
    expect(combobox.options[1]!.value).toBe('Arial')
    expect(combobox.options[2]!.value).toBe('Georgia')
  })

  it('options preview their own family; selecting drives setFont and the display follows the store', () => {
    const b = mount(['Arial', 'Georgia'])
    const select = screen.getByRole('combobox', { name: 'Font' }) as HTMLSelectElement
    const arialOption = select.options[1]!
    expect(arialOption.style.fontFamily).toBe('Arial')
    fireEvent.change(select, { target: { value: 'Arial' } })
    expect(b.setFont).toHaveBeenCalledWith('Arial')
    // No store write yet: the displayed value is unchanged.
    expect(select.value).toBe('')
    act(() => { b.store.actions.sync('Arial', 1) })
    expect(select.value).toBe('Arial')
  })

  it('selecting the default option writes the empty family', () => {
    const b = mount(['Arial'], 'Arial')
    const select = screen.getByRole('combobox', { name: 'Font' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '' } })
    expect(b.setFont).toHaveBeenCalledWith('')
  })
})
