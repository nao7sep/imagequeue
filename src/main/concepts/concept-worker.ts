import { parentPort, workerData } from 'node:worker_threads'
import * as database from './concept-database'
import { serializeError } from '../../shared/serialize-error'
database.initializeConceptStore(workerData.dataDir, (level, message, fields) => parentPort?.postMessage({ type: 'log', level, message, fields }))
parentPort?.on('message', ({ id, op, args }) => {
  try {
    const operation = database[op as keyof typeof database] as (...args: unknown[]) => unknown
    const value = operation(...args)
    parentPort?.postMessage({ id, value, paths: database.drainSetAsideConceptStorePaths() })
  } catch (error) {
    parentPort?.postMessage({ id, error: { ...serializeError(error), ...(error as object) }, paths: database.drainSetAsideConceptStorePaths() })
  }
  if (op === 'closeConceptStore') parentPort?.close()
})
