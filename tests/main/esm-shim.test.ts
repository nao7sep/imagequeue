import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'

// electron-vite gives every main-process and preload bundle its own `__dirname`
// and `__filename`, so a module that declares either makes the bundle a syntax
// error at load: the app fails to start while its tests, which never load the
// bundle, still pass. Modules use `import.meta.dirname` instead.
const SHIMMED = new Set(['__dirname', '__filename'])
const BUNDLED = ['src/main', 'src/preload']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

function declaredShims(file: string): string[] {
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] })
  const found: string[] = []
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier' && SHIMMED.has(declarator.id.name)) found.push(declarator.id.name)
      }
    }
    if (declaration?.type === 'FunctionDeclaration' && declaration.id && SHIMMED.has(declaration.id.name)) found.push(declaration.id.name)
  }
  return found
}

describe("bundled modules and electron-vite's shims", () => {
  it('declare no __dirname or __filename of their own', () => {
    const files = BUNDLED.flatMap((dir) => sourceFiles(join(process.cwd(), dir)))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.flatMap((file) => declaredShims(file).map((name) => `${relative(process.cwd(), file)}: ${name}`))
    expect(offenders).toEqual([])
  })

  it('finds such a declaration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'imagequeue-esm-shim-'))
    try {
      const probe = join(dir, 'probe.ts')
      writeFileSync(probe, "import { fileURLToPath } from 'node:url'\nconst __filename = fileURLToPath(import.meta.url)\nexport function __dirname(): string { return __filename }\n")
      expect(declaredShims(probe)).toEqual(['__filename', '__dirname'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
