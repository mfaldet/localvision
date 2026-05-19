/**
 * Geographic boundary levels available in LocalVision.
 *
 * OuterLevel — for comparing multiple communities on a choropleth map.
 * InnerLevel — for sub-community layers within a single place.
 *
 * All data sourced from US Census Bureau TIGER/Line Cartographic Boundary Files
 * (1:500,000 generalization scale) via https://www2.census.gov/geo/tiger/
 */

// ─── Outer levels (ADM hierarchy, nation → community) ────────────────────────

export type OuterLevel =
  | 'state'    // ADM1 — 50 states + DC + territories
  | 'county'   // ADM2 — ~3,200 counties / county-equivalents
  | 'place'    // ADM3 — ~30,000 incorporated places and CDPs
  | 'cousub'   // ADM3-alt — county subdivisions (townships, boroughs, MCDs)

// ─── Inner levels (sub-community, within a place/county) ─────────────────────

export type InnerLevel =
  | 'tract'    // Census tracts — ~85,000 nationwide, ~2,500–8,000 residents
  | 'bg'       // Block groups — subdivisions of tracts, ~600–3,000 residents
  | 'zcta'     // ZIP Code Tabulation Areas — approximate ZIP boundaries
  | 'cousub'   // County subdivisions — townships, boroughs, MCDs
  | 'place'    // Incorporated places / CDPs within a study area
  | 'cd'       // Congressional districts (119th Congress)
  | 'unsd'     // Unified school districts
  | 'elsd'     // Elementary school districts
  | 'scsd'     // Secondary school districts
  | 'sldl'     // State legislative districts — lower chamber
  | 'sldu'     // State legislative districts — upper chamber

export type AnyLevel = OuterLevel | InnerLevel

// ─── Human-readable metadata ─────────────────────────────────────────────────

export interface LevelMeta {
  label: string
  description: string
  /** Typical population range */
  popRange?: string
  /** Whether this layer requires a state FIPS to fetch */
  requiresState: boolean
  /** Whether this layer requires a county FIPS to further filter */
  canFilterByCounty: boolean
}

export const LEVEL_META: Record<AnyLevel, LevelMeta> = {
  state:  { label: 'States',                    description: '50 states, DC, and territories',                      requiresState: false, canFilterByCounty: false },
  county: { label: 'Counties',                  description: 'Counties and county-equivalents (~3,200)',             requiresState: false, canFilterByCounty: false },
  place:  { label: 'Places / CDPs',             description: 'Incorporated places and Census Designated Places',    requiresState: true,  canFilterByCounty: false },
  cousub: { label: 'County Subdivisions',       description: 'Townships, boroughs, minor civil divisions',          requiresState: true,  canFilterByCounty: false },
  tract:  { label: 'Census Tracts',             description: 'Statistical neighborhoods, ~2,500–8,000 residents',   popRange: '1,200–8,000', requiresState: true, canFilterByCounty: true },
  bg:     { label: 'Block Groups',              description: 'Subdivisions of tracts, ~600–3,000 residents',        popRange: '600–3,000',   requiresState: true, canFilterByCounty: true },
  zcta:   { label: 'ZIP Code Areas (ZCTA)',     description: 'Approximate ZIP Code boundaries',                     requiresState: false, canFilterByCounty: false },
  cd:     { label: 'Congressional Districts',   description: '119th Congress districts',                            requiresState: true,  canFilterByCounty: false },
  unsd:   { label: 'Unified School Districts',  description: 'K–12 school districts',                               requiresState: true,  canFilterByCounty: false },
  elsd:   { label: 'Elementary School Dist.',   description: 'Elementary-only school districts',                    requiresState: true,  canFilterByCounty: false },
  scsd:   { label: 'Secondary School Dist.',    description: 'Secondary-only school districts',                     requiresState: true,  canFilterByCounty: false },
  sldl:   { label: 'State House Districts',     description: 'State legislative lower chamber',                     requiresState: true,  canFilterByCounty: false },
  sldu:   { label: 'State Senate Districts',    description: 'State legislative upper chamber',                     requiresState: true,  canFilterByCounty: false },
}
