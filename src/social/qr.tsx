/**
 * QR code for an invite link, drawn locally with the `qrcode` package (no third-party QR service,
 * so the link never leaves the device). `qrcode` is loaded lazily so it only downloads when shown.
 */
import { useEffect, useState } from 'react'

export async function qrSvg(text: string): Promise<string> {
  const QR = await import('qrcode')
  const toString = (QR.toString ?? (QR as unknown as { default: typeof QR }).default.toString) as typeof QR.toString
  return toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#3b2a26', light: '#ffffff' } })
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function QrCode({ text, size = 200, label = 'QR code for your invite link' }: { text: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setSrc(null)
    setFailed(false)
    qrSvg(text)
      .then((svg) => live && setSrc(svgDataUrl(svg)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [text])
  if (failed) return <p className="text-sm text-ink-soft">Couldn't draw the QR code. Share the link instead.</p>
  return (
    <div className="inline-block rounded-xl bg-white p-2 ring-1 ring-panel-edge" style={{ width: size + 16, height: size + 16 }}>
      {src ? <img data-testid="invite-qr" src={src} alt={label} width={size} height={size} /> : <span className="sr-only">Drawing QR code…</span>}
    </div>
  )
}
