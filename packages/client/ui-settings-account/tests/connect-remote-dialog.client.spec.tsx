// @vitest-environment jsdom
/** Remote Harness connection form: localized failures and the shell-owned switch. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectRemoteDialog } from '../src/client/ConnectRemoteDialog.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { DesktopRemoteConnectionResult } from '../src/types.ts'

afterEach(cleanup)

function mount(
  copy: typeof en | typeof zh = en,
  connectRemote: (url: string) => Promise<DesktopRemoteConnectionResult> = vi.fn(async () => ({ ok: true as const })),
) {
  const close = vi.fn()
  render(<ConnectRemoteDialog connectRemote={connectRemote} close={close} t={key => copy[key]} />)
  return { close, connectRemote }
}

it.each([en, zh])('disables the action until a URL is entered (%s)', (copy) => {
  mount(copy)
  const action = screen.getByRole('button', { name: copy.remoteConnect })
  expect(screen.getByRole('dialog').textContent).toContain(copy.remoteTitle)
  expect(screen.getByRole('dialog').textContent).toContain(copy.remoteDescription)
  expect(action.hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByLabelText(copy.remoteUrlLabel), { target: { value: '  http://127.0.0.1:3080/?token=t  ' } })
  expect(action.hasAttribute('disabled')).toBe(false)
})

it('submits the trimmed URL and stays busy while the shell switches', async () => {
  const pending = Promise.withResolvers<DesktopRemoteConnectionResult>()
  const connectRemote = vi.fn(() => pending.promise)
  mount(en, connectRemote)
  fireEvent.change(screen.getByLabelText(en.remoteUrlLabel), { target: { value: ' http://127.0.0.1:3080/?token=t ' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.remoteConnect })) })
  expect(connectRemote).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3080/?token=t')
  expect(screen.getByRole('status').textContent).toBe(en.remoteConnecting)
  await act(async () => { pending.resolve({ ok: true }) })
  expect(screen.getByRole('status').textContent).toBe(en.remoteConnecting)
  expect(screen.getByRole('button', { name: en.cancel }).hasAttribute('disabled')).toBe(true)
})

it.each([
  ['invalid-url', 'remoteInvalidUrl'],
  ['missing-token', 'remoteMissingToken'],
  ['unreachable', 'remoteUnreachable'],
  ['authentication', 'remoteAuthentication'],
  ['no-injections', 'remoteNoInjections'],
  ['version-mismatch', 'remoteVersionMismatch'],
  ['local-host', 'remoteLocalHost'],
  ['local-stop', 'remoteLocalStop'],
  ['internal', 'remoteInternal'],
] as const)('renders %s as localized copy', async (failure, key) => {
  const connectRemote = vi.fn(async (): Promise<DesktopRemoteConnectionResult> => ({ ok: false, failure }))
  mount(en, connectRemote)
  fireEvent.change(screen.getByLabelText(en.remoteUrlLabel), { target: { value: 'http://127.0.0.1:3080/?token=t' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.remoteConnect })) })
  expect(screen.getByRole('alert').textContent).toBe(en[key])
  expect(screen.getByRole('button', { name: en.remoteConnect }).hasAttribute('disabled')).toBe(false)
})

it('treats a rejected request as an internal failure and allows retry', async () => {
  const connectRemote = vi.fn(async () => { throw new Error('ipc closed') })
  mount(en, connectRemote)
  fireEvent.change(screen.getByLabelText(en.remoteUrlLabel), { target: { value: 'http://127.0.0.1:3080/?token=t' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.remoteConnect })) })
  expect(screen.getByRole('alert').textContent).toBe(en.remoteInternal)
})

it('dismisses from the close button and Escape only while idle', async () => {
  const pending = Promise.withResolvers<DesktopRemoteConnectionResult>()
  const props = mount(en, vi.fn(() => pending.promise))
  fireEvent.change(screen.getByLabelText(en.remoteUrlLabel), { target: { value: 'http://127.0.0.1:3080/?token=t' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.remoteConnect })) })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(props.close).not.toHaveBeenCalled()
  await act(async () => { pending.resolve({ ok: false, failure: 'unreachable' }) })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(props.close).toHaveBeenCalledOnce()
})
