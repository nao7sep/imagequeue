import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type { Elaborator } from '../shared/types'
import { ensureDataDir, getDataDir } from './config'

function getElaboratorsFilePath(): string {
  ensureDataDir()
  return path.join(getDataDir(), 'elaborators.json')
}

function defaultElaborators(): Elaborator[] {
  return [
    {
      id: nanoid(10),
      name: 'Concrete subject',
      description: 'Flesh out who or what is present and what is happening.',
      template:
        "You expand the user's seed into a concrete description of the subject and what is happening. Pick specific people, objects, or creatures, what they are doing, and brief context. Do not specify medium, framing, lighting, or visual style — describe only the subject and its situation. Each prompt is 20-35 words of natural English.",
    },
    {
      id: nanoid(10),
      name: 'Subject in setting',
      description: 'Place the subject in a specific place and time.',
      template:
        "You expand the user's seed by placing the subject in a specific setting. Pick a concrete place and time, and include environmental details that ground the subject. Do not specify medium, framing, or visual style — describe only the subject, place, and situation. Each prompt is 20-35 words.",
    },
    {
      id: nanoid(10),
      name: 'Diverse situations',
      description: 'Vary what the subject is doing and where, across outputs.',
      template:
        "You expand the user's seed into prompts that vary substantially across the set. For each prompt, change what the subject is doing, where they are, and who or what is with them. Keep the core subject identifiable. Do not specify medium or visual style — describe only the subject and its situation. Each prompt is 15-30 words.",
    },
  ]
}

function isElaborator(value: unknown): value is Elaborator {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Elaborator>
  if (typeof v.id !== 'string' || !v.id) return false
  if (typeof v.name !== 'string') return false
  if (typeof v.template !== 'string') return false
  if (v.description != null && typeof v.description !== 'string') return false
  return true
}

function readFile(): Elaborator[] | null {
  const file = getElaboratorsFilePath()
  if (!fs.existsSync(file)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isElaborator)
  } catch {
    return null
  }
}

function writeFile(items: Elaborator[]): void {
  fs.writeFileSync(getElaboratorsFilePath(), JSON.stringify(items, null, 2), 'utf-8')
}

export function listElaborators(): Elaborator[] {
  const stored = readFile()
  if (stored !== null) return stored
  const seeded = defaultElaborators()
  writeFile(seeded)
  return seeded
}

export function createElaborator(input: { name: string; description?: string; template: string }): Elaborator {
  const items = listElaborators()
  const created: Elaborator = {
    id: nanoid(10),
    name: input.name.trim() || 'Untitled',
    description: input.description?.trim() || undefined,
    template: input.template,
  }
  items.unshift(created)
  writeFile(items)
  return created
}

export function updateElaborator(id: string, patch: { name?: string; description?: string; template?: string }): Elaborator | null {
  const items = listElaborators()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  const current = items[index]
  const next: Elaborator = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
    description: patch.description !== undefined ? (patch.description.trim() || undefined) : current.description,
    template: patch.template !== undefined ? patch.template : current.template,
  }
  items[index] = next
  writeFile(items)
  return next
}

export function deleteElaborator(id: string): boolean {
  const items = listElaborators()
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return false
  writeFile(next)
  return true
}

export function resetElaborators(): Elaborator[] {
  const seeded = defaultElaborators()
  writeFile(seeded)
  return seeded
}

export function getElaborator(id: string): Elaborator | null {
  return listElaborators().find((item) => item.id === id) ?? null
}
