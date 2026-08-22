import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../../../src/shared/types'
import { taskParameterLabel, taskStatusLabel } from '../../../../src/renderer/src/utils/taskPresentation'

describe('taskStatusLabel', () => {
  it('projects every stored task state to a capitalized display label', () => {
    const expected: Record<TaskStatus, string> = {
      queued: 'Queued',
      generating: 'Generating',
      completed: 'Completed',
      kept: 'Kept',
      failed: 'Failed',
      interrupted: 'Interrupted',
    }

    for (const [status, label] of Object.entries(expected)) {
      expect(taskStatusLabel(status as TaskStatus)).toBe(label)
    }
  })
})

describe('taskParameterLabel', () => {
  it('uses readable labels for known provider parameter identities', () => {
    expect(taskParameterLabel('outputFormat')).toBe('Format')
    expect(taskParameterLabel('negativePrompt')).toBe('Negative')
    expect(taskParameterLabel('personGeneration')).toBe('Persons')
    expect(taskParameterLabel('aspectRatio')).toBe('Aspect')
    expect(taskParameterLabel('imageSize')).toBe('Image size')
  })

  it('preserves an unknown provider parameter identity', () => {
    expect(taskParameterLabel('providerSpecificKey')).toBe('providerSpecificKey')
  })
})
