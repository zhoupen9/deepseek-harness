/** Projection of the optional Desktop preload carrier onto the launcher's application commands. */
import { expect, it, vi } from 'vitest'
import { desktopApplicationCommands } from '../src/client/desktop-application.ts'

/** Development application group with recording stubs. */
function applicationOf() {
  return {
    development: true,
    about: vi.fn(() => Promise.resolve()),
    quit: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve()),
    connectRemote: vi.fn(() => Promise.resolve({ ok: true as const })),
  }
}

it('projects the shell carrier onto the launcher commands', async () => {
  const application = applicationOf()
  const open = vi.fn(() => Promise.resolve())
  const commands = desktopApplicationCommands({ protocolVersion: 1, application, updates: { open } })
  expect(commands?.development).toBe(true)
  await commands!.about()
  await commands!.openUpdates()
  await commands!.reload()
  await commands!.restart()
  await commands!.quit()
  await commands!.connectRemote!('http://127.0.0.1:3080/?token=t')
  expect(application.about).toHaveBeenCalledOnce()
  expect(application.quit).toHaveBeenCalledOnce()
  expect(application.reload).toHaveBeenCalledOnce()
  expect(application.restart).toHaveBeenCalledOnce()
  expect(application.connectRemote).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3080/?token=t')
  expect(open).toHaveBeenCalledOnce()
})

it('omits the remote command when this shell cannot reach a remote Harness', () => {
  const { connectRemote: _connectRemote, ...application } = applicationOf()
  const commands = desktopApplicationCommands({ protocolVersion: 1, application, updates: { open: () => Promise.resolve() } })
  expect(commands?.connectRemote).toBeUndefined()
})

it('exposes no commands outside this shell contract', () => {
  const open = () => Promise.resolve()
  expect(desktopApplicationCommands(undefined)).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1 })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1, updates: { open } })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1, application: applicationOf() })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 2, application: applicationOf(), updates: { open } })).toBeUndefined()
})
