/**
 * Which X-Forwarded-For hops to believe. On Railway the app is reached only through Railway's edge
 * proxy, which connects from a private address and appends the client address it saw (there may be
 * an internal hop or two in between). We trust up to `TRUST_PROXY_HOPS` (default 3) peers, and only
 * while each is a private, loopback or shared (CGNAT) address: the first public address from the
 * right is the client. `request.ip` is then the address the edge proxy saw, never a value the
 * client wrote into X-Forwarded-For, so per-IP rate limits can't be dodged by rotating that header.
 *
 * (Fastify's numeric `trustProxy` fails closed on purpose, which would make every visitor share
 * the proxy's address and one rate-limit bucket; `true` trusts every hop, which is spoofable.)
 */
import { BlockList, isIPv4 } from 'node:net'

const DEFAULT_HOPS = 3

const privateRanges = new BlockList()
for (const [net, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv6')
}

/** True for loopback, private (RFC 1918 / ULA), link-local and CGNAT addresses. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  try {
    return isIPv4(a) ? privateRanges.check(a, 'ipv4') : privateRanges.check(a, 'ipv6')
  } catch {
    return false
  }
}

/** `TRUST_PROXY_HOPS`: a whole number 0-10, default 3. */
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS
  if (raw === undefined || raw.trim() === '') return DEFAULT_HOPS
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : DEFAULT_HOPS
}

/** Fastify `trustProxy` function: hop `i` (0 = the socket peer) is a proxy we believe. */
export function trustProxyFor(env: NodeJS.ProcessEnv = process.env): (addr: string, i: number) => boolean {
  const hops = trustProxyHops(env)
  return (addr, i) => i < hops && isPrivateAddress(addr)
}
