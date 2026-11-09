import type { CV } from '@techstark/opencv-js'

const WATERMARK_LEFT = 0.78
const WATERMARK_TOP = 0.915

let cvPromise: Promise<CV> | null = null

async function getOpenCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then(async (module) => {
      const cvModule = module.default
      const cv = cvModule instanceof Promise ? await cvModule : cvModule
      if (cv.Mat) return cv
      await new Promise<void>((resolve) => {
        cv.onRuntimeInitialized = resolve
      })
      return cv
    })
  }
  return cvPromise
}

function watermarkMask(imageData: ImageData) {
  const { width, height, data } = imageData
  const mask = new Uint8Array(width * height)
  let pixels = 0
  let iconPixels = 0
  let wordPixels = 0

  const cornerLeft = Math.floor(width * WATERMARK_LEFT)
  const cornerTop = Math.floor(height * WATERMARK_TOP)
  for (let y = cornerTop; y < height; y++) {
    for (let x = cornerLeft; x < width; x++) {
      const index = (y * width + x) * 4
      const red = data[index]
      const green = data[index + 1]
      const blue = data[index + 2]
      if (
        red >= 185 &&
        green >= 185 &&
        blue >= 185 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) <= 65
      ) {
        mask[y * width + x] = 255
        pixels++
        if (x < width * 0.835) iconPixels++
        else wordPixels++
      }
    }
  }

  const iconArea = (width * 0.835 - cornerLeft) * (height - cornerTop)
  const wordArea = (width - width * 0.835) * (height - cornerTop)
  const isOsonPravaMark =
    iconPixels >= Math.max(20, iconArea * 0.025) &&
    wordPixels >= Math.max(30, wordArea * 0.008)

  return { mask, pixels, isOsonPravaMark }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Rasmni qayta ishlashning iloji bo‘lmadi.'))),
      type
    )
  })
}

export async function cleanOsonPravaWatermark(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file

  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('Rasmni tahrirlash uchun canvas ochilmadi.')
  }

  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const { mask, pixels, isOsonPravaMark } = watermarkMask(imageData)
  if (
    !isOsonPravaMark ||
    pixels < Math.max(80, Math.floor(canvas.width * canvas.height * 0.00035))
  ) {
    return file
  }

  const cv = await getOpenCv()
  const source = cv.imread(canvas)
  const bgr = new cv.Mat()
  const maskMat = new cv.Mat(canvas.height, canvas.width, cv.CV_8UC1)
  const expandedMask = new cv.Mat()
  const output = new cv.Mat()
  const rgba = new cv.Mat()
  const kernelSize = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.015) | 1)
  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(kernelSize, kernelSize)
  )

  try {
    maskMat.data.set(mask)
    cv.dilate(maskMat, expandedMask, kernel)
    cv.cvtColor(source, bgr, cv.COLOR_RGBA2BGR)
    cv.inpaint(bgr, expandedMask, output, Math.max(3, kernelSize / 2), cv.INPAINT_TELEA)
    cv.cvtColor(output, rgba, cv.COLOR_BGR2RGBA)
    cv.imshow(canvas, rgba)

    const cleaned = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let index = 3; index < cleaned.data.length; index += 4) {
      cleaned.data[index] = imageData.data[index]
    }
    context.putImageData(cleaned, 0, 0)
  } finally {
    source.delete()
    bgr.delete()
    maskMat.delete()
    expandedMask.delete()
    output.delete()
    rgba.delete()
    kernel.delete()
  }

  const blob = await canvasBlob(canvas, file.type)
  const nameParts = file.name.split('.')
  const extension = nameParts.pop()
  const name = `${nameParts.join('.')}-cleaned${extension ? `.${extension}` : ''}`
  return new File([blob], name, { type: blob.type, lastModified: file.lastModified })
}
