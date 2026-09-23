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
  expect(application.about).toHaveBeenCalledOnce()
  expect(application.quit).toHaveBeenCalledOnce()
  expect(application.reload).toHaveBeenCalledOnce()
  expect(application.restart).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledOnce()
})

it('exposes no commands outside this shell contract', () => {
  const open = () => Promise.resolve()
  expect(desktopApplicationCommands(undefined)).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1 })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1, updates: { open } })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 1, application: applicationOf() })).toBeUndefined()
  expect(desktopApplicationCommands({ protocolVersion: 2, application: applicationOf(), updates: { open } })).toBeUndefined()
})
