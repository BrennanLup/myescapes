/**
 * Directory attribution. Every public page that shows directory data (venue names, addresses,
 * coordinates) shows where the facts came from, as the source licences require:
 *   - Foursquare Open Source Places: Apache-2.0
 *   - OpenStreetMap: ODbL, "© OpenStreetMap contributors" linking to the copyright page
 */
import type { Attribution, DirectorySource } from '../../contracts/models'

export const FOURSQUARE_ATTRIBUTION: Attribution = {
  source: 'foursquare',
  license: 'Apache-2.0',
  text: 'Venue data from Foursquare Open Source Places',
  url: 'https://opensource.foursquare.com/os-places/',
}

export const OSM_ATTRIBUTION: Attribution = {
  source: 'osm',
  license: 'ODbL-1.0',
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright',
}

const DEFAULTS: Partial<Record<DirectorySource, Attribution>> = { foursquare: FOURSQUARE_ATTRIBUTION, osm: OSM_ATTRIBUTION }

const LICENSE_URLS: Record<string, string> = {
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
  'ODbL-1.0': 'https://opendatacommons.org/licenses/odbl/1-0/',
  ODbL: 'https://opendatacommons.org/licenses/odbl/1-0/',
}

/**
 * The lines to show: the page's own attribution entries (one per source), filled in with the
 * standard text and links for Foursquare and OSM. `user` and `google` entries need no licence line:
 * user facts are covered by "added by players", and Google is only a link (we store just place ids).
 * With no entries at all (for example a city page whose server sent none), the Foursquare and OSM
 * lines are shown anyway, since directory pages are built from those two sources.
 */
export function attributionLines(entries: Attribution[], opts: { fallbackToDefaults?: boolean } = {}): Attribution[] {
  const bySource = new Map<DirectorySource, Attribution>()
  for (const e of entries) {
    if (bySource.has(e.source)) continue
    const d = DEFAULTS[e.source]
    bySource.set(e.source, {
      source: e.source,
      license: e.license || d?.license || '',
      text: e.text || d?.text || '',
      url: e.url ?? d?.url,
    })
  }
  if (bySource.size === 0 && (opts.fallbackToDefaults ?? true)) return [FOURSQUARE_ATTRIBUTION, OSM_ATTRIBUTION]
  // OSM's licence asks for the "© OpenStreetMap contributors" credit, whatever text the importer stored.
  const osm = bySource.get('osm')
  if (osm && !/openstreetmap contributors/i.test(osm.text)) bySource.set('osm', { ...osm, text: OSM_ATTRIBUTION.text })
  return [...bySource.values()].filter((a) => a.source === 'foursquare' || a.source === 'osm' || a.source === 'user')
}

function safeLink(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

export function DirectoryAttribution({ entries, fallbackToDefaults }: { entries: Attribution[]; fallbackToDefaults?: boolean }) {
  const lines = attributionLines(entries, { fallbackToDefaults })
  return (
    <div data-testid="directory-attribution" className="text-xs leading-relaxed text-[#c9b3a3]">
      <p className="m-0 font-semibold text-[#fbeedd]">Directory data</p>
      <ul className="m-0 mt-1 list-none p-0">
        {lines.map((a) => {
          const href = safeLink(a.url)
          const licenseHref = LICENSE_URLS[a.license]
          return (
            <li key={a.source} data-source={a.source}>
              {a.source === 'user' ? (
                'Some details were added or corrected by players.'
              ) : (
                <>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#fbeedd]">
                      {a.text}
                    </a>
                  ) : (
                    a.text
                  )}
                  {a.license && (
                    <>
                      {', licensed under '}
                      {licenseHref ? (
                        <a href={licenseHref} target="_blank" rel="noopener noreferrer" className="text-[#fbeedd]">
                          {a.license}
                        </a>
                      ) : (
                        a.license
                      )}
                    </>
                  )}
                  .
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
