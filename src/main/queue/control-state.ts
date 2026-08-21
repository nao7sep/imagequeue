import type { QueueControlState } from '../../shared/types'
import { inFlightCount, isQueuePaused } from '../backends/cancellation'
import { queueManager } from './queue-manager'

export function buildControlState(): QueueControlState {
  return {
    paused: isQueuePaused(),
    generating: inFlightCount(),
    queued: queueManager.countByStatus('queued'),
    interrupted: queueManager.countByStatus('interrupted'),
  }
}
