/**
 * Standardize the human-readable label for a community feature based on its
 * geographic level. The raw NAME field from ACS and TIGERweb has redundant
 * context that's noisy in chart axes ("Census Tract 605.04, Dakota County,
 * Minnesota") — once the user has drilled into a county, repeating the
 * county and state in every label adds clutter.
 *
 * Rules (per Census geographic level):
 *   tract   "Census Tract 605.04, Dakota County, Minnesota"
 *           → "Tract 605.04"
 *   bg      "Block Group 1, Census Tract 605.04, Dakota County, Minnesota"
 *           → "BG 1 · Tract 605.04"
 *   county  "Dakota County, Minnesota"        → "Dakota County"
 *   place   "Rosemount city, Minnesota"        → "Rosemount"
 *   cousub  "Rosemount city, Dakota County, MN" → "Rosemount"
 *   state   "Minnesota"                        → "Minnesota"
 *   zcta    "ZCTA5 55068"                      → "55068"
 *
 * Fallback (unknown / no level): first comma-separated segment.
 */

import { stripLsadSuffix } from '../geo/loader'

export type GeographicLevel =
  | 'state'
  | 'county'
  | 'tract'
  | 'bg'
  | 'place'
  | 'cousub'
  | 'zcta'
  | 'cd'
  | 'sldl'
  | 'sldu'
  | 'unsd'
  | 'elsd'
  | 'scsd'

export function cleanCommunityName(rawName: string, level?: string): string {
  if (!rawName) return rawName
  const name = String(rawName).trim()
  if (!name) return name

  switch (level) {
    case 'tract': {
      // Allow tract IDs with or without a decimal (e.g. "605.04" or "1001").
      const m = name.match(/Census Tract\s+([\d.]+)/i)
      return m ? `Tract ${m[1]}` : firstPart(name)
    }

    case 'bg': {
      // "Block Group N, Census Tract X.YY, …" → "BG N · Tract X.YY"
      const m = name.match(/Block Group\s+(\d+),\s*Census Tract\s+([\d.]+)/i)
      return m ? `BG ${m[1]} · Tract ${m[2]}` : firstPart(name)
    }

    case 'county':
      // "Dakota County, Minnesota" → "Dakota County"
      return firstPart(name)

    case 'place':
    case 'cousub':
      // "Rosemount city, …" → "Rosemount"
      return stripLsadSuffix(firstPart(name))

    case 'state':
      // Already just the state name in ACS output
      return firstPart(name)

    case 'zcta': {
      // "ZCTA5 55068" → "55068"
      const m = name.match(/ZCTA5?\s+(\d+)/i)
      return m ? m[1] : firstPart(name)
    }

    case 'cd':
    case 'sldl':
    case 'sldu':
    case 'unsd':
    case 'elsd':
    case 'scsd':
      // ACS names for these are typically "District N (...)". Take what's
      // before the first comma; ACS doesn't append state names here.
      return firstPart(name)

    default:
      return firstPart(name)
  }
}

function firstPart(s: string): string {
  const idx = s.indexOf(',')
  return (idx >= 0 ? s.slice(0, idx) : s).trim()
}
