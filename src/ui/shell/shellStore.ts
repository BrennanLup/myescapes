/** Shell-local UI state (controls hint, toast, server status). Not part of the app store. */
import { useEffect } from 'react'
import { create } from 'zustand'
import { apiClient, type ServerStatus } from '@/contracts/api'

export interface ShellState {
  /** Controls hint card visible. */
  hintOpen: boolean
  /** Bumps each time the hint is (re)opened so its auto-fade timer restarts. */
  hintNonce: number
  toast: { id: number; text: string } | null
  serverStatus: ServerStatus | null
  serverStatusError: boolean
  openHint(): void
  closeHint(): void
  showToast(text: string): void
  clearToast(id: number): void
}

let toastId = 0

export const useShell = create<ShellState>()((set, get) => ({
  hintOpen: false,
  hintNonce: 0,
  toast: null,
  serverStatus: null,
  serverStatusError: false,
  openHint: () => set((s) => ({ hintOpen: true, hintNonce: s.hintNonce + 1 })),
  closeHint: () => set({ hintOpen: false }),
  showToast: (text) => set({ toast: { id: ++toastId, text } }),
  clearToast: (id) => {
    if (get().toast?.id === id) set({ toast: null })
  },
}))

let statusPromise: Promise<void> | null = null

/** Fetch `/api/status` once per session (retry allowed after an error). */
export function fetchServerStatus(force = false): Promise<void> {
  if (statusPromise && !force) return statusPromise
  statusPromise = apiClient
    .getStatus()
    .then((serverStatus) => useShell.setState({ serverStatus, serverStatusError: false }))
    .catch(() => {
      useShell.setState({ serverStatusError: true })
      statusPromise = null
    })
  return statusPromise
}

export function useServerStatus() {
  const status = useShell((s) => s.serverStatus)
  const error = useShell((s) => s.serverStatusError)
  useEffect(() => {
    void fetchServerStatus()
  }, [])
  return { status, error }
}

/** Test helper. */
export function resetShellForTests() {
  statusPromise = null
  useShell.setState({ hintOpen: false, hintNonce: 0, toast: null, serverStatus: null, serverStatusError: false })
}
