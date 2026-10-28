/**
 * The server's clock as seen from this browser (Phase 3, workstream C). Remote poses are stamped
 * with server time, so drawing them needs `serverNow()`. Each `ping`/`pong` gives a sample:
 * offset = serverTime + rtt / 2 - receivedAt. The sample with the smallest round trip of the
 * last few is the most trustworthy, so that one wins. Pure; tested in clock.test.ts.
 */
export const CLOCK_SAMPLES = 8

interface Sample {
  offset: number
  rtt: number
}

export class ServerClock {
  private samples: Sample[] = []
  private rough: number | null = null

  /** serverTime - localTime, in ms (0 until we know better). */
  get offset(): number {
    if (this.samples.length) {
      let best = this.samples[0]
      for (const s of this.samples) if (s.rtt < best.rtt) best = s
      return best.offset
    }
    return this.rough ?? 0
  }

  /** True once at least one round trip was measured. */
  get synced(): boolean {
    return this.samples.length > 0
  }

  /** A one-way server time (hello, joined): a rough offset until a round trip is measured. */
  seed(serverTime: number, receivedAt: number): void {
    if (Number.isFinite(serverTime)) this.rough = serverTime - receivedAt
  }

  /** A ping sent at `sentAt` came back at `receivedAt` carrying the server's `serverTime`. */
  sample(serverTime: number, sentAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt
    if (!Number.isFinite(serverTime) || !(rtt >= 0) || rtt > 30_000) return
    this.samples.push({ offset: serverTime + rtt / 2 - receivedAt, rtt })
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift()
  }

  /** The server's time now. */
  now(local: number = Date.now()): number {
    return local + this.offset
  }

  reset(): void {
    this.samples = []
    this.rough = null
  }
}
