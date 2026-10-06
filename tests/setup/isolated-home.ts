import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

// No test may reach the developer's real home or data root: a test that leaves
// IMAGEQUEUE_DATA_DIR unset would otherwise resolve, and create, the real
// ~/.imagequeue, and one that restores an inherited override would reach
// whatever root the developer exported. Each test file runs with a throwaway
// home of its own, which os.homedir() reads from HOME (USERPROFILE on Windows),
// and its data root starts inside that home; a test that sets its own override
// restores this one.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.IMAGEQUEUE_DATA_DIR = path.join(home, '.imagequeue')

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true })
})
