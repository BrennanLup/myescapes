/**
 * Loads crew profile pictures for the polaroid stickers, once per URL. A picture that fails
 * (or whose host doesn't allow CORS, which would taint the canvas) resolves to null and the
 * sticker keeps its initials.
 */
export type ImageFactory = () => HTMLImageElement

const cache = new Map<string, Promise<HTMLImageElement | null>>()

export function loadAvatar(url: string, make: ImageFactory = () => new Image()): Promise<HTMLImageElement | null> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise((resolve) => {
      const im = make()
      im.crossOrigin = 'anonymous'
      im.decoding = 'async'
      // Google profile pictures refuse requests that carry a referrer from other sites.
      im.referrerPolicy = 'no-referrer'
      im.onload = () => resolve(im)
      im.onerror = () => resolve(null)
      im.src = url
    })
    cache.set(url, p)
  }
  return p
}

/** Loads every URL; resolves to the ones that loaded. */
export async function loadAvatars(urls: readonly string[], make?: ImageFactory): Promise<Map<string, HTMLImageElement>> {
  const unique = [...new Set(urls)]
  const imgs = await Promise.all(unique.map((u) => loadAvatar(u, make)))
  const out = new Map<string, HTMLImageElement>()
  unique.forEach((u, i) => {
    const im = imgs[i]
    if (im) out.set(u, im)
  })
  return out
}

/** Tests only. */
export function clearAvatarCache() {
  cache.clear()
}
