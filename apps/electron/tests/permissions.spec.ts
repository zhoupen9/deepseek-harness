import { describe, expect, it } from 'vitest'
import { permissionGranted } from '../src/permissions.ts'

describe('permissionGranted', () => {
  it('grants the permissions the Web UI needs', () => {
    expect(permissionGranted('clipboard-sanitized-write')).toBe(true)
    expect(permissionGranted('local-fonts')).toBe(true)
  })

  it('denies a permission the Web UI has no consumer for', () => {
    expect(permissionGranted('clipboard-read')).toBe(false)
    expect(permissionGranted('geolocation')).toBe(false)
    expect(permissionGranted('media')).toBe(false)
    expect(permissionGranted('notifications')).toBe(false)
  })
})
