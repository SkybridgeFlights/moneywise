import { describe, expect, it, vi } from 'vitest'
import { configureSingleInstance } from './single-instance'

describe('packaged single-instance safety', () => {
  it('quits before database startup when another instance owns the lock', () => {
    const quit = vi.fn()
    const application = { requestSingleInstanceLock: () => false, quit, on: vi.fn() }
    expect(configureSingleInstance(application, () => [])).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(application.on).not.toHaveBeenCalled()
  })

  it('focuses and restores the primary window on a second launch', () => {
    let secondInstance: (() => void) | undefined
    const restore = vi.fn()
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: (_event: 'second-instance', listener: () => void) => { secondInstance = listener }
    }
    expect(configureSingleInstance(application, () => [{ isMinimized: () => true, restore, focus }])).toBe(true)
    secondInstance?.()
    expect(restore).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(application.quit).not.toHaveBeenCalled()
  })
})
