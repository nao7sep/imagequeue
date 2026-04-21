import { PNG } from 'pngjs'
import { getFloat16 } from '@petamoriken/float16'

export function decodeDTTensor(tensor: Uint8Array): Buffer {
  const intView = new DataView(tensor.buffer, tensor.byteOffset, 17 * 4)
  const magic = intView.getUint32(0, true)
  if (magic === 1012247) {
    throw new Error('fpzip-compressed DTTensor not supported yet')
  }
  const height = intView.getUint32(6 * 4, true)
  const width = intView.getUint32(7 * 4, true)
  const channels = intView.getUint32(8 * 4, true)

  const pixelCount = width * height
  const f16View = new DataView(tensor.buffer, tensor.byteOffset + 68)

  const png = new PNG({ width, height, colorType: 2 }) // RGB no alpha
  png.data = Buffer.alloc(width * height * 4) // pngjs always needs 4 channels for .data

  for (let i = 0; i < pixelCount; i++) {
    for (let c = 0; c < Math.min(channels, 3); c++) {
      const f16 = getFloat16(f16View, (i * channels + c) * 2, true)
      const u8 = Math.max(0, Math.min(255, Math.round((f16 + 1) * 127)))
      png.data[i * 4 + c] = u8
    }
    png.data[i * 4 + 3] = 255 // alpha
  }

  return PNG.sync.write(png)
}
