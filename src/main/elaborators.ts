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
      name: 'Photoreal scene',
      description: 'Vivid photorealistic, lighting and framing chosen.',
      template:
        'You expand a short concept into a vivid photorealistic image prompt. Pick concrete details for lighting, framing, and atmosphere that resolve ambiguity but leave the image AI room to compose. Each prompt is 25-40 words and reads as natural English.',
    },
    {
      id: nanoid(10),
      name: 'App icon',
      description: 'Centered subject, plain background, flat style, square.',
      template:
        'You expand a short concept into an app icon prompt. Centered subject, plain or simple background, flat or minimal style, suitable for a square format. Each prompt is 15-30 words.',
    },
    {
      id: nanoid(10),
      name: 'Illustration',
      description: 'Pick a medium and set a mood.',
      template:
        'You expand a short concept into an illustration prompt. Pick a specific medium (watercolor, line art, anime, gouache, etc.), set a mood, and frame the subject. Each prompt is 20-35 words.',
    },
    {
      id: nanoid(10),
      name: 'Cinematic still',
      description: 'Camera angle, dramatic lighting, brief setting.',
      template:
        'You expand a short concept into a cinematic still: pick a camera angle (close-up, wide, low-angle, etc.), dramatic lighting, mood, and a brief setting. Each prompt is 20-30 words.',
    },
    {
      id: nanoid(10),
      name: 'Concept art',
      description: 'Painterly, dynamic composition, dramatic.',
      template:
        'You expand a short concept into a concept art prompt: dynamic pose or composition, painterly medium, dramatic lighting, evocative mood. Each prompt is 20-35 words.',
    },
    {
      id: nanoid(10),
      name: 'Diverse variations',
      description: 'Vary location, time, attire, action across outputs.',
      template:
        "You expand a short concept into image prompts that are substantively different from each other. Vary location, time of day, attire, and action across the set. Keep the core subject identifiable but let everything else change. Each prompt is 15-30 words.",
    },
    {
      id: nanoid(10),
      name: 'Tight variants',
      description: 'Same subject, change one or two attributes only.',
      template:
        "You expand a short concept into image prompts that share an identical core subject. Across the set, change only one or two attributes (color, setting, mood, lighting) at a time. Each prompt is 15-30 words.",
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
  items.push(created)
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
