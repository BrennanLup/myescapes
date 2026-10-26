import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiCallError } from '../../contracts/errors'
import {
  audioBlob,
  enqueueRecording,
  flushQueue,
  getRecording,
  isRetryable,
  listRecordings,
  markTranscribed,
  readyLabel,
  removeRecording,
  resetQueueStoreForTests,
  subscribeQueue,
  summarize,
  uploadRecording,
  waitingLabel,
} from './queue'

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetQueueStoreForTests()
})

describe('recording queue (IndexedDB)', () => {
  it('keeps the audio on the phone until the server confirms the transcript, then deletes it', async () => {
    const item = await enqueueRecording({ audio: audio(), durationSeconds: 12.34, liveTranscript: 'we did the vault' })
    expect(item.status).toBe('pending')
    expect(item.id).toMatch(/^rec_/)
    const stored = await getRecording(item.id)
    expect(stored?.audio?.byteLength).toBe(4)
    expect(stored?.durationSeconds).toBe(12.3)
    expect(audioBlob(stored!)?.type).toBe('audio/webm')

    const upload = vi.fn(async () => ({ transcript: 'We did The Vault.' }))
    const done = await uploadRecording(item.id, upload)
    expect(upload).toHaveBeenCalledOnce()
    expect(done).toMatchObject({ status: 'transcribed', transcript: 'We did The Vault.', audio: null })
    expect((await getRecording(item.id))?.audio).toBeNull()
  })

  it('a failed upload leaves the recording waiting, with the attempt counted', async () => {
    const item = await enqueueRecording({ audio: audio(), durationSeconds: 5 })
    await expect(uploadRecording(item.id, async () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow('Failed to fetch')
    const after = await getRecording(item.id)
    expect(after).toMatchObject({ status: 'pending', attempts: 1 })
    expect(after?.audio?.byteLength).toBe(4)
    expect(after?.lastError).toBeTruthy()
    expect(waitingLabel(summarize(await listRecordings()).waiting)).toBe('1 recording waiting to upload')
  })

  it('errors that retrying cannot fix mark the recording failed (still kept)', async () => {
    const item = await enqueueRecording({ audio: audio(), durationSeconds: 5 })
    const bad = new ApiCallError(415, { error: 'Unsupported audio', code: 'unsupported_media' }, '415')
    await expect(uploadRecording(item.id, async () => Promise.reject(bad))).rejects.toBe(bad)
    expect(await getRecording(item.id)).toMatchObject({ status: 'failed', attempts: 1, lastError: 'Unsupported audio' })
    expect(isRetryable(bad)).toBe(false)
    expect(isRetryable(new ApiCallError(429, { error: 'cap', code: 'spending_cap' }, '429'))).toBe(true)
    expect(isRetryable(new ApiCallError(503, { error: 'down', code: 'db_unavailable' }, '503'))).toBe(true)
    expect(isRetryable(new TypeError('network'))).toBe(true)
  })

  it('flushQueue uploads every waiting recording oldest first and skips failed ones unless asked', async () => {
    const a = await enqueueRecording({ audio: audio(), durationSeconds: 1, now: new Date('2026-10-26T01:00:00Z') })
    const b = await enqueueRecording({ audio: audio(), durationSeconds: 2, now: new Date('2026-10-26T02:00:00Z') })
    const c = await enqueueRecording({ audio: audio(), durationSeconds: 3, now: new Date('2026-10-26T03:00:00Z') })
    await uploadRecording(c.id, async () => Promise.reject(new ApiCallError(400, { error: 'bad', code: 'invalid' }, '400'))).catch(() => {})
    const seen: string[] = []
    const res = await flushQueue(async (item) => {
      seen.push(item.id)
      return { transcript: `t-${item.id}` }
    })
    expect(seen).toEqual([a.id, b.id])
    expect(res).toEqual({ uploaded: 2, failed: 0 })
    const s = summarize(await listRecordings())
    expect(s).toEqual({ waiting: 1, ready: 2, failed: 1 })
    expect(readyLabel(s.ready)).toBe('2 transcripts ready to log')

    const again = await flushQueue(async () => ({ transcript: 'fixed' }), { includeFailed: true })
    expect(again).toEqual({ uploaded: 1, failed: 0 })
  })

  it('shares one upload when the log screen and the background retry race', async () => {
    const item = await enqueueRecording({ audio: audio(), durationSeconds: 1 })
    let calls = 0
    const upload = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return { transcript: 'once' }
    }
    const [x, y] = await Promise.all([uploadRecording(item.id, upload), uploadRecording(item.id, upload)])
    expect(calls).toBe(1)
    expect(x.transcript).toBe('once')
    expect(y.transcript).toBe('once')
    // Already transcribed: no new upload.
    await uploadRecording(item.id, upload)
    expect(calls).toBe(1)
  })

  it('notifies subscribers and forgets removed recordings', async () => {
    const fn = vi.fn()
    const off = subscribeQueue(fn)
    const item = await enqueueRecording({ audio: audio(), durationSeconds: 1 })
    await markTranscribed(item.id, 'hello')
    await removeRecording(item.id)
    off()
    expect(fn).toHaveBeenCalledTimes(3)
    expect(await listRecordings()).toEqual([])
    await expect(uploadRecording(item.id, async () => ({ transcript: 'x' }))).rejects.toThrow(/no longer/)
  })
})
