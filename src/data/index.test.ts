import { describe, expect, it } from 'vitest'
import { FIXTURE_DATASET } from '@/contracts/fixtures'
import { formatEscapeTime, ratingBucket, roomsForSort } from './index'

const { rooms, reviews } = FIXTURE_DATASET

describe('formatEscapeTime', () => {
  it('formats minutes', () => {
    expect(formatEscapeTime(52)).toBe('52 min')
    expect(formatEscapeTime(60)).toBe('1 h')
    expect(formatEscapeTime(75)).toBe('1 h 15 min')
    expect(formatEscapeTime(null)).toBe('—')
    expect(formatEscapeTime(60, false)).toBe("Didn't escape (1 h)")
    expect(formatEscapeTime(null, false)).toBe("Didn't escape")
  })
})

describe('roomsForSort', () => {
  it('sorts by city with group labels', () => {
    const s = roomsForSort(rooms, reviews, 'city')
    expect(s.map((x) => x.group)).toEqual(['San Francisco', 'San Francisco', 'Toronto'])
    expect(s[0].room.name).toBe('Mars Base Omega')
  })
  it('sorts by date newest first and rating highest first', () => {
    expect(roomsForSort(rooms, reviews, 'date').map((x) => x.room.id)).toEqual(['room_fx_3', 'room_fx_1', 'room_fx_2'])
    expect(roomsForSort(rooms, reviews, 'rating').map((x) => x.group)).toEqual(['90+', '80-89', '70-79'])
  })
  it('puts failed escapes last', () => {
    const s = roomsForSort(rooms, reviews, 'escapeTime')
    expect(s.map((x) => x.room.id)).toEqual(['room_fx_3', 'room_fx_1', 'room_fx_2'])
    expect(s[2].group).toBe("Didn't escape")
  })
  it('handles rooms without reviews and empty input', () => {
    expect(roomsForSort([], [], 'genre')).toEqual([])
    expect(roomsForSort(rooms, [], 'rating').every((x) => x.group === 'Unrated')).toBe(true)
    expect(ratingBucket(42)).toBe('Under 60')
  })
})
