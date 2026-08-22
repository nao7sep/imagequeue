import type { TaskStatus } from '../../../shared/types'

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'Queued',
  generating: 'Generating',
  completed: 'Completed',
  kept: 'Kept',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

const TASK_PARAMETER_LABELS: Record<string, string> = {
  outputFormat: 'Format',
  negativePrompt: 'Negative',
  personGeneration: 'Persons',
  aspectRatio: 'Aspect',
  imageSize: 'Image size',
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status]
}

export function taskParameterLabel(key: string): string {
  return TASK_PARAMETER_LABELS[key] ?? key
}
