import { describe, expect, it, vi } from 'vitest'

const { alert } = vi.hoisted(() => ({ alert: vi.fn() }))
vi.mock('react-native', () => ({ Alert: { alert } }))

import { confirmRecordDeletion } from './destructiveActions'

describe('destructive action protection', () => {
  it('requires explicit destructive confirmation before deleting', () => {
    const onConfirm = vi.fn()
    confirmRecordDeletion('Rent', onConfirm)
    expect(onConfirm).not.toHaveBeenCalled()
    const buttons = alert.mock.calls[0][2]
    expect(buttons[0]).toMatchObject({ text: 'Cancel', style: 'cancel' })
    expect(buttons[1]).toMatchObject({ text: 'Delete', style: 'destructive' })
    buttons[1].onPress()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
