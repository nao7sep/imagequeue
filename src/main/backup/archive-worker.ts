import { parentPort, workerData } from 'node:worker_threads'
import { runArchiveSession } from './archive-engine'

void runArchiveSession(workerData.action, workerData.root, workerData.stores)
  .then((result) => parentPort?.postMessage(result))
