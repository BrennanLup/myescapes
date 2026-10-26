/**
 * React view of the recording queue: the list, a summary for the home banner, and automatic
 * retries when the phone comes back online (plus a slow timer, because `online` events are
 * unreliable on some phones).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribe } from './api'
import { flushQueue, listRecordings, subscribeQueue, summarize, type QueuedRecording, type QueueSummary, type Uploader } from './queue'

export const RETRY_INTERVAL_MS = 60_000

export interface UploadQueue {
  items: QueuedRecording[]
  summary: QueueSummary
  uploading: boolean
  /** Upload everything waiting now (also items that failed before). */
  retry(): Promise<void>
}

export function useUploadQueue(opts: { uploader?: Uploader; auto?: boolean; fetch?: typeof fetch } = {}): UploadQueue {
  const { auto = true } = opts
  const [items, setItems] = useState<QueuedRecording[]>([])
  const [uploading, setUploading] = useState(false)
  const uploader = useRef<Uploader>(opts.uploader ?? ((item) => transcribe(item, opts.fetch ? { fetch: opts.fetch } : {})))

  const refresh = useCallback(async () => {
    try {
      setItems(await listRecordings())
    } catch {
      /* IndexedDB unavailable (private mode on old Safari): nothing queued */
    }
  }, [])

  const run = useCallback(async (includeFailed: boolean) => {
    setUploading(true)
    try {
      await flushQueue(uploader.current, { includeFailed })
    } catch {
      /* errors are recorded on the items */
    } finally {
      setUploading(false)
      void refresh()
    }
  }, [refresh])

  useEffect(() => {
    void refresh()
    return subscribeQueue(() => void refresh())
  }, [refresh])

  const waiting = items.some((i) => i.status === 'pending')
  useEffect(() => {
    if (!auto || !waiting) return
    const kick = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      void run(false)
    }
    kick()
    window.addEventListener('online', kick)
    const t = setInterval(kick, RETRY_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', kick)
      clearInterval(t)
    }
  }, [auto, waiting, run])

  const retry = useCallback(() => run(true), [run])
  return { items, summary: summarize(items), uploading, retry }
}
