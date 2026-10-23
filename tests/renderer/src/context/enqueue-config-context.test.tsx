// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueueProvider } from '../../../../src/renderer/src/context/QueueContext'
import { EnqueueConfigProvider, useEnqueueConfigs } from '../../../../src/renderer/src/context/EnqueueConfigContext'

vi.mock('../../../../src/renderer/src/hooks/useVisiblePanes', () => ({
  useVisiblePanes: () => ({ backends: ['openai', 'flux', 'grok'] }),
}))
afterEach(cleanup)

it('submits Send to All through one batch so backends share one session operation', async () => {
  const enqueue = vi.fn(async () => [])
  const enqueueBatch = vi.fn(async () => [])
  window.electronAPI = {
    enqueue, enqueueBatch,
    getQueueSnapshot: async () => ({ kind: 'snapshot', revision: 0, tasks: { openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] } }),
    onQueueUpdated: () => () => undefined,
    getShowKeptImages: async () => false,
    toggleShowKeptImages: async () => true,
    onShowKeptImagesChanged: () => () => undefined,
  } as unknown as typeof window.electronAPI
  let context!: ReturnType<typeof useEnqueueConfigs>
  function Probe(): null { context = useEnqueueConfigs(); return null }
  await act(async () => { render(<QueueProvider><EnqueueConfigProvider><Probe /></EnqueueConfigProvider></QueueProvider>) })
  act(() => {
    context.setSnapshot('openai', { model: 'openai-model', params: { quality: 'low' }, ready: true })
    context.setSnapshot('flux', { model: 'flux-model', params: { aspectRatio: '1:1' }, ready: true })
    context.setSnapshot('grok', { model: 'grok-model', params: {}, ready: false })
  })
  await act(async () => { context.enqueueToAll('a cat') })
  expect(enqueue).not.toHaveBeenCalled()
  expect(enqueueBatch).toHaveBeenCalledOnce()
  expect(enqueueBatch).toHaveBeenCalledWith([
    expect.objectContaining({ backend: 'openai', model: 'openai-model', prompt: 'a cat' }),
    expect.objectContaining({ backend: 'flux', model: 'flux-model', prompt: 'a cat' }),
  ])
})
