/**
 * Toasts go through the shell's single toast slot (rendered by the HUD outside any
 * overlay), so a "Pinned!" message outlives the confirm overlay that triggered it.
 */
import { useShell } from '@/ui/shell/shellStore'

export function showToast(text: string): void {
  useShell.getState().showToast(text)
}
