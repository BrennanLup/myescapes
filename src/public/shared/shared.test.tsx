import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { attributionLines, DirectoryAttribution, FOURSQUARE_ATTRIBUTION, OSM_ATTRIBUTION } from './Attribution'
import { SpoilerReveal } from './Spoiler'
import { formatDate, formatMinutes, formatPercent, formatScore, googleMapsLink, initials, placeLine, playersLabel, publicName, safeHttpUrl } from './format'

afterEach(cleanup)

describe('format helpers', () => {
  it('formats dates as calendar dates without a time-zone shift', () => {
    expect(formatDate('2026-10-12')).toBe('Oct 12, 2026')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDate('not a date')).toBe('not a date')
  })

  it('formats scores, minutes and rates', () => {
    expect(formatScore(84.6)).toBe('85')
    expect(formatScore(null)).toBe('—')
    expect(formatMinutes(52)).toBe('52 min')
    expect(formatMinutes(null)).toBeNull()
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(null)).toBe('—')
    expect(playersLabel(2, 6)).toBe('2-6 players')
    expect(playersLabel(4, 4)).toBe('4 players')
    expect(playersLabel(null, null)).toBeNull()
  })

  it('builds the public name from display name and handle only', () => {
    expect(publicName({ id: 'u', handle: 'alice', displayName: 'Alice', image: null })).toEqual({ name: 'Alice', handle: '@alice' })
    expect(publicName({ id: 'u', handle: null, displayName: '  ', image: null })).toEqual({ name: 'Player', handle: null })
    expect(initials('Alice Anders')).toBe('AA')
    expect(initials('@bob')).toBe('BO')
  })

  it('links Google Maps by stored url, place id or a search', () => {
    expect(googleMapsLink({ url: 'https://maps.example/x', name: 'A' })).toBe('https://maps.example/x')
    const byId = googleMapsLink({ placeId: 'ChIJ123', name: 'Starlight Escapes', address: '12 Main St', city: 'San Francisco' })
    expect(byId).toBe('https://www.google.com/maps/search/?api=1&query=Starlight%20Escapes%2C%2012%20Main%20St%2C%20San%20Francisco&query_place_id=ChIJ123')
    expect(googleMapsLink({ name: 'Maple & Key', address: '' })).toBe('https://www.google.com/maps/search/?api=1&query=Maple%20%26%20Key')
  })

  it('only lets http(s) links through', () => {
    expect(safeHttpUrl('starlight.example.com')).toBe('https://starlight.example.com/')
    expect(safeHttpUrl('http://a.example/x')).toBe('http://a.example/x')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,hi')).toBeNull()
    expect(safeHttpUrl('')).toBeNull()
    expect(safeHttpUrl(null)).toBeNull()
  })

  it('joins place parts, skipping blanks and the unknown country', () => {
    expect(placeLine('Toronto', '', 'ZZ')).toBe('Toronto')
    expect(placeLine('San Francisco', 'CA', 'US')).toBe('San Francisco, CA, US')
  })
})

describe('directory attribution', () => {
  it('falls back to Foursquare and OSM when the page sent none', () => {
    expect(attributionLines([])).toEqual([FOURSQUARE_ATTRIBUTION, OSM_ATTRIBUTION])
  })

  it('fills in links, keeps one line per source and always credits OSM contributors', () => {
    const lines = attributionLines([
      { source: 'osm', license: 'ODbL-1.0', text: 'OpenStreetMap' },
      { source: 'osm', license: 'ODbL-1.0', text: 'dup' },
      { source: 'foursquare', license: '', text: '' },
      { source: 'google', license: '', text: 'Google' },
    ])
    expect(lines.map((l) => l.source)).toEqual(['osm', 'foursquare'])
    expect(lines[0].text).toContain('© OpenStreetMap contributors')
    expect(lines[0].url).toBe('https://www.openstreetmap.org/copyright')
    expect(lines[1]).toMatchObject({ license: 'Apache-2.0', url: FOURSQUARE_ATTRIBUTION.url })
  })

  it('renders licence links and never a non-http link', () => {
    render(<DirectoryAttribution entries={[{ source: 'osm', license: 'ODbL-1.0', text: '© OpenStreetMap contributors', url: 'javascript:alert(1)' }]} />)
    const box = screen.getByTestId('directory-attribution')
    expect(box.textContent).toContain('© OpenStreetMap contributors')
    expect(box.textContent).toContain('ODbL-1.0')
    for (const a of box.querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^https:\/\//)
  })

  it('credits players for user-contributed facts', () => {
    render(<DirectoryAttribution entries={[{ source: 'user', license: '', text: '' }]} />)
    expect(screen.getByTestId('directory-attribution').textContent).toContain('added or corrected by players')
  })
})

describe('SpoilerReveal', () => {
  it('does not render hidden content until revealed, and can hide it again', () => {
    render(
      <SpoilerReveal testId="s">
        <p>the butler did it</p>
      </SpoilerReveal>,
    )
    expect(screen.queryByText('the butler did it')).toBeNull()
    expect(screen.getByTestId('s').dataset.revealed).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Show spoilers' }))
    expect(screen.getByText('the butler did it')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide spoilers' }))
    expect(screen.queryByText('the butler did it')).toBeNull()
  })
})
