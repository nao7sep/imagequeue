import { useEffect, useState } from 'react'

export interface DecodedImage {
  /** The image to draw: the last one that decoded, until the next one has. */
  src: string | null
  /** The URL whose load has settled, whether it decoded or failed. */
  settled: string | null
  /** Whether the settled URL failed to load or decode. */
  failed: boolean
}

const NONE: DecodedImage = { src: null, settled: null, failed: false }

/** Loads and decodes an image off screen before it is drawn, so moving from
 *  one image to the next never shows an empty or half-drawn frame; a newer URL
 *  supersedes a load still in flight. A null URL clears the image at once. */
export function useDecodedImage(url: string | null): DecodedImage {
  const [image, setImage] = useState<DecodedImage>(NONE)
  useEffect(() => {
    if (!url) {
      setImage(NONE)
      return
    }
    let current = true
    const loader = new Image()
    loader.src = url
    loader.decode().then(
      () => { if (current) setImage({ src: url, settled: url, failed: false }) },
      () => { if (current) setImage({ src: null, settled: url, failed: true }) },
    )
    return () => { current = false }
  }, [url])
  return image
}
