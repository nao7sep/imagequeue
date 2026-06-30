import { describe, expect, it } from 'vitest'
import { parseCliRelease } from '../../../src/main/dependencies/cli-release'

const RELEASE = {
  tag_name: 'v1.20260430.0',
  assets: [
    { name: 'gRPCServerCLI-macOS', browser_download_url: 'https://example.com/grpc', digest: 'sha256:aaa' },
    {
      name: 'draw-things-cli',
      browser_download_url: 'https://example.com/draw-things-cli',
      digest: 'sha256:7E5FB3AF',
    },
  ],
}

describe('parseCliRelease', () => {
  it('extracts the CLI asset tag, url, and lowercased sha256 from its digest', () => {
    expect(parseCliRelease(RELEASE)).toEqual({
      tag: 'v1.20260430.0',
      assetUrl: 'https://example.com/draw-things-cli',
      sha256: '7e5fb3af',
    })
  })

  it('returns a null sha256 when the asset has no digest (cannot verify)', () => {
    const noDigest = {
      tag_name: 'v1.20260430.0',
      assets: [{ name: 'draw-things-cli', browser_download_url: 'https://example.com/x' }],
    }
    expect(parseCliRelease(noDigest)?.sha256).toBeNull()
  })

  it('returns null when the tag, the asset, or the payload is missing', () => {
    expect(parseCliRelease(null)).toBeNull()
    expect(parseCliRelease({ assets: RELEASE.assets })).toBeNull()
    expect(parseCliRelease({ tag_name: 'v1.0.0', assets: [{ name: 'other' }] })).toBeNull()
  })
})
