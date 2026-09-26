import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../../../src/shared/types'
import { taskParameterLabel, taskStatusLabel } from '../../../../src/renderer/src/utils/taskPresentation'
import { createTranslator } from '../../../../src/shared/i18n/translate'

const { t } = createTranslator('en')

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
      expect(taskStatusLabel(t, status as TaskStatus)).toBe(label)
    }
  })
})

describe('taskParameterLabel', () => {
  it('uses readable labels for known provider parameter identities', () => {
    expect(taskParameterLabel(t, 'outputFormat')).toBe('Format')
    expect(taskParameterLabel(t, 'negativePrompt')).toBe('Negative')
    expect(taskParameterLabel(t, 'personGeneration')).toBe('Persons')
    expect(taskParameterLabel(t, 'aspectRatio')).toBe('Aspect')
    expect(taskParameterLabel(t, 'imageSize')).toBe('Image size')
  })

  it('preserves an unknown provider parameter identity', () => {
    expect(taskParameterLabel(t, 'providerSpecificKey')).toBe('providerSpecificKey')
  })
})
