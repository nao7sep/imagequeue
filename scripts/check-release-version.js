const path = require('node:path')

const manifest = require(path.join(__dirname, '..', 'package.json'))
const tag = process.env.RELEASE_TAG
const expected = `v${manifest.version}`

if (!tag) {
  console.error('RELEASE_TAG is required')
  process.exit(2)
}

if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package.json version ${expected}`)
  process.exit(1)
}

console.log(`Release tag matches package.json: ${tag}`)
