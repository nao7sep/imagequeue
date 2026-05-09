import fs from 'fs'
import path from 'path'
import type { DrawThingsModelParams } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'

function getParamsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'params.json')
}

type ParamsStore = Record<string, DrawThingsModelParams>

function load(): ParamsStore {
  try {
    const file = getParamsFilePath()
    if (!fs.existsSync(file)) return {}
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ParamsStore
  } catch {
    return {}
  }
}

export function getModelParams(modelFile: string): DrawThingsModelParams | null {
  return load()[modelFile] ?? null
}

export function setModelParams(modelFile: string, params: DrawThingsModelParams): void {
  const file = getParamsFilePath()
  const store = load()
  store[modelFile] = params
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf-8')
}
