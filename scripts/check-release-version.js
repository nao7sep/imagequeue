const path = require('node:path')

const manifest = require(path.join(__dirname, '..', 'package.json'))
const tag = process.argv[2]
const expected = `v${manifest.version}`

if (!tag) {
  console.error('Usage: npm run check:release-version -- <tag>')
  process.exit(2)
}

if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package.json version ${expected}`)
  process.exit(1)
}

console.log(`Release tag matches package.json: ${tag}`)
