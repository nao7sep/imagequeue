import type { TaskStatus } from '../../../shared/types'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import type { Translator } from '../../../shared/i18n/translate'

// A status is stored as its English word and shown as catalogue text.
const TASK_STATUS_LABELS: Record<TaskStatus, MessageKey> = {
  queued: 'task.status.queued',
  generating: 'task.status.generating',
  completed: 'task.status.completed',
  kept: 'task.status.kept',
  failed: 'task.status.failed',
  interrupted: 'task.status.interrupted',
}

// Parameter names are request keys; the few the details panel renames are
// worded here, and any other key shows as itself.
const TASK_PARAMETER_LABELS: Record<string, MessageKey> = {
  outputFormat: 'task.param.outputFormat',
  negativePrompt: 'task.param.negativePrompt',
  personGeneration: 'task.param.personGeneration',
  aspectRatio: 'task.param.aspectRatio',
  imageSize: 'task.param.imageSize',
}

export function taskStatusLabel(t: Translator['t'], status: TaskStatus): string {
  return t(TASK_STATUS_LABELS[status])
}

export function taskParameterLabel(t: Translator['t'], key: string): string {
  const label = TASK_PARAMETER_LABELS[key]
  return label ? t(label) : key
}
