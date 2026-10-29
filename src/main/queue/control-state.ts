import type { QueueControlState } from '../../shared/types'
import { generatingCount, isQueuePaused } from '../backends/cancellation'
import { queueManager } from './queue-manager'

export function buildControlState(): QueueControlState {
  return {
    paused: isQueuePaused(),
    generating: generatingCount(),
    queued: queueManager.countByStatus('queued'),
    interrupted: queueManager.countByStatus('interrupted'),
  }
}
