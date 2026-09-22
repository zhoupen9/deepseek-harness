import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopResourceLayout } from '../src/resource-layout.ts'

describe('desktop resource layout', () => {
  it('places the resources beside the application archive', () => {
    const resources = join('opt', 'deepseek-harness-desktop', 'resources')
    expect(desktopResourceLayout(join(resources, 'app.asar'))).toEqual({ assembled: true, root: resources })
  })

  it('keeps the application directory as the resource root of a source checkout', () => {
    const appPath = join('workspace', 'apps', 'desktop')
    expect(desktopResourceLayout(appPath)).toEqual({ assembled: false, root: appPath })
  })
})
