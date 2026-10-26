/**
 * Crew tagging in the log flow (workstream 36): friend chips by frequency (ROUTES.crewSuggestions),
 * plus guest names. STUB.
 */
import type { CrewTag } from '../../../contracts/models'

export interface CrewPickerProps {
  value: CrewTag[]
  onChange(value: CrewTag[]): void
}

export function CrewPicker(_props: CrewPickerProps) {
  return <div data-testid="crew-picker" />
}
