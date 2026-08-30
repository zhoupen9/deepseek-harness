import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WorkspaceFilesControllerInvariant from '../src/invariant.ts'

describe('api-workspace-files-controller invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(WorkspaceFilesControllerInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-api-workspace-files-controller', () => {})
    }).toThrow(/already registered/)
  })
})
