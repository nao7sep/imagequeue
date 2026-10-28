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
  const enqueueBatch = vi.fn(async (_units: unknown[]) => [])
  window.electronAPI = {
    enqueue, enqueueBatch,
    getAllStoredTasks: async () => ({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] }),
    onQueueUpdated: () => () => undefined,
    getShowKeptImages: async () => false,
    toggleShowKeptImages: async () => true,
    onShowKeptImagesChanged: () => () => undefined,
  } as unknown as typeof window.electronAPI
  let context!: ReturnType<typeof useEnqueueConfigs>
  function Probe(): null { context = useEnqueueConfigs(); return null }
  await act(async () => { render(<QueueProvider><EnqueueConfigProvider><Probe /></EnqueueConfigProvider></QueueProvider>) })
  const commitOpenAi = vi.fn()
  const commitFlux = vi.fn()
  const commitBlocked = vi.fn()
  act(() => {
    context.setSnapshot('openai', { model: 'openai-model', params: { quality: 'low' }, ready: true, onEnqueue: commitOpenAi })
    context.setSnapshot('flux', { model: 'flux-model', params: { aspectRatio: '1:1' }, ready: true, onEnqueue: commitFlux })
    context.setSnapshot('grok', { model: 'grok-model', params: {}, ready: false, onEnqueue: commitBlocked })
  })
  await act(async () => { context.enqueueToAll('a cat') })
  expect(commitOpenAi).toHaveBeenCalledOnce()
  expect(commitFlux).toHaveBeenCalledOnce()
  expect(commitBlocked).not.toHaveBeenCalled()
  for (const unit of enqueueBatch.mock.calls[0][0]) expect(unit).not.toHaveProperty('onEnqueue')
  expect(enqueue).not.toHaveBeenCalled()
  expect(enqueueBatch).toHaveBeenCalledOnce()
  expect(enqueueBatch).toHaveBeenCalledWith([
    expect.objectContaining({ backend: 'openai', model: 'openai-model', prompt: 'a cat' }),
    expect.objectContaining({ backend: 'flux', model: 'flux-model', prompt: 'a cat' }),
  ])
  await act(async () => { context.enqueueToBackend('openai', 'another cat') })
  expect(commitOpenAi).toHaveBeenCalledTimes(2)
  await act(async () => { context.enqueueToBackend('openai', '') })
  expect(commitOpenAi).toHaveBeenCalledTimes(2)
})
