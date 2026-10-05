import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

// No test may reach the developer's real home: a test that leaves
// IMAGEQUEUE_DATA_DIR unset would otherwise resolve, and create, the real
// ~/.imagequeue. Each test file runs with a throwaway home of its own, which
// os.homedir() reads from HOME (USERPROFILE on Windows).
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true })
})
