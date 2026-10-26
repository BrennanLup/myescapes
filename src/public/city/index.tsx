/** Public city page /cities/:slug (workstream 17). Uses ROUTES.cityPage. STUB. */
import type { RouteProps } from '../../router'
import { Placeholder } from '../../pages/Placeholder'

export function CityPage({ params }: RouteProps) {
  return <Placeholder title={`City: ${params.slug}`} ws={17} />
}
