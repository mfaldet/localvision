import { describe, it, expect } from 'vitest'
import { ascending, samplePalette } from './OuterCityView'

describe('fixed color scale helpers', () => {
  it('drops repeated breaks so they can serve as scale stops', () => {
    expect(ascending([0, 0, 0, 82, 232, 232, 624])).toEqual([0, 82, 232, 624])
    expect(ascending([])).toEqual([])
  })

  it('samples a palette at its ends and between its colors', () => {
    const palette = ['#000000', '#ffffff']
    expect(samplePalette(palette, 0)).toBe('rgb(0,0,0)')
    expect(samplePalette(palette, 1)).toBe('rgb(255,255,255)')
    expect(samplePalette(palette, 0.5)).toBe('rgb(128,128,128)')
  })

  it('gives every one of 21 breaks its own color on a 5-color palette', () => {
    const palette = ['#440154', '#3b528b', '#21908c', '#5dc863', '#fde725']
    const colors = Array.from({ length: 21 }, (_, i) => samplePalette(palette, i / 20))
    expect(new Set(colors).size).toBe(21)
  })
})
