// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../../../src/main/config/defaults'
import type { Elaborator } from '../../../../src/shared/types'
import { until } from '../../until'

const mocks = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), settings: {} as Record<string, unknown> }))
vi.mock('../../../../src/renderer/src/context/SettingsContext', () => ({
  useSettings: () => ({ settings: mocks.settings, saveBrainstormSettings: mocks.save }),
}))
vi.mock('../../../../src/renderer/src/context/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
import { ElaborationSettingsModal } from '../../../../src/renderer/src/components/ElaborationSettingsModal'
import { ElaboratorsModal } from '../../../../src/renderer/src/components/ElaboratorsModal'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  mocks.settings = createDefaultConfig() as unknown as Record<string, unknown>
  mocks.save.mockReset()
  mocks.confirm.mockReset().mockResolvedValue(true)
  window.electronAPI = {
    reportUnsavedDraft: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

function expectFrozenFields(): void {
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    expect(field.disabled).toBe(true)
  }
}

describe('elaboration editor save ownership', () => {
  it('freezes the elaboration settings snapshot, blocks dismissal, and preserves a rejected draft for retry', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    mocks.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const onClose = vi.fn()
    render(<ElaborationSettingsModal onClose={onClose} />)
    const template = (await until(() => screen.getAllByRole('textbox')))[0] as HTMLTextAreaElement
    const original = template.value
    fireEvent.change(template, { target: { value: original + '\nSubmitted instruction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.save).toHaveBeenCalledOnce()
    expectFrozenFields()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.save).toHaveBeenCalledOnce()
    await act(async () => first.reject(new Error('SECRET_SENTINEL write failed')))
    expect(screen.getByRole('alert').textContent).not.toContain('SECRET_SENTINEL')
    expect(template.disabled).toBe(false)
    expect(template.value).toBe(original + '\nSubmitted instruction')
    fireEvent.change(template, { target: { value: original + '\nRetry instruction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.save.mock.calls[1][0].templates.expansion).toBe(original + '\nRetry instruction')
    expectFrozenFields()
    await act(async () => second.resolve())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('owns settings confirmation before saving and releases a declined confirmation', async () => {
    const confirmation = deferred<boolean>()
    mocks.confirm.mockReturnValueOnce(confirmation.promise)
    const onClose = vi.fn()
    render(<ElaborationSettingsModal onClose={onClose} />)
    const template = (await until(() => screen.getAllByRole('textbox')))[0] as HTMLTextAreaElement
    fireEvent.change(template, { target: { value: 'Missing required placeholders' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expectFrozenFields()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => confirmation.resolve(false))
    expect(template.disabled).toBe(false)
    expect(template.value).toBe('Missing required placeholders')
  })

  it('freezes edits while reset defaults load and keeps the current draft if loading fails', async () => {
    const defaults = deferred<ReturnType<typeof createDefaultConfig>['brainstorm']>()
    window.electronAPI.brainstormGetDefaults = vi.fn(() => defaults.promise)
    const onClose = vi.fn()
    render(<ElaborationSettingsModal onClose={onClose} />)
    const template = (await until(() => screen.getAllByRole('textbox')))[0] as HTMLTextAreaElement
    fireEvent.change(template, { target: { value: 'Authored draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset elaboration settings' }))
    await until(() => expect(window.electronAPI.brainstormGetDefaults).toHaveBeenCalledOnce())
    expectFrozenFields()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => defaults.reject(new Error('SECRET_SENTINEL defaults unavailable')))
    expect(template.value).toBe('Authored draft')
    expect(template.disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).not.toContain('SECRET_SENTINEL')
  })

  it('freezes elaborator fields through a delayed save and retains failed text for retry', async () => {
    const item: Elaborator = { id: 'one', kind: 'composition', name: 'Composition fixture', description: 'Description', template: 'Original' }
    const first = deferred<Elaborator>()
    const second = deferred<Elaborator>()
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    window.electronAPI.listElaborators = vi.fn(async () => [item])
    window.electronAPI.updateElaborator = update
    const onClose = vi.fn()
    render(<ElaboratorsModal onClose={onClose} />)
    await until(() => expect(screen.getByRole('option', { name: /Composition fixture/ })).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const template = screen.getByRole('textbox', { name: 'Template' }) as HTMLTextAreaElement
    fireEvent.change(template, { target: { value: 'Submitted instruction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expectFrozenFields()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
    await act(async () => first.reject(new Error('SECRET_SENTINEL write failed')))
    expect(screen.getByRole('alert').textContent).not.toContain('SECRET_SENTINEL')
    expect(template.value).toBe('Submitted instruction')
    expect(template.disabled).toBe(false)
    fireEvent.change(template, { target: { value: 'Retry instruction' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(update.mock.calls[1]).toEqual(['one', { name: item.name, description: item.description, template: 'Retry instruction' }])
    await act(async () => second.resolve({ ...item, template: 'Retry instruction' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
