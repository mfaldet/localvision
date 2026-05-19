/**
 * US state FIPS codes and metadata.
 * FIPS codes are always zero-padded 2-digit strings (e.g. "01" not 1).
 */

export interface StateMeta {
  fips: string
  name: string
  abbr: string
}

export const STATES: StateMeta[] = [
  { fips: '01', name: 'Alabama',              abbr: 'AL' },
  { fips: '02', name: 'Alaska',               abbr: 'AK' },
  { fips: '04', name: 'Arizona',              abbr: 'AZ' },
  { fips: '05', name: 'Arkansas',             abbr: 'AR' },
  { fips: '06', name: 'California',           abbr: 'CA' },
  { fips: '08', name: 'Colorado',             abbr: 'CO' },
  { fips: '09', name: 'Connecticut',          abbr: 'CT' },
  { fips: '10', name: 'Delaware',             abbr: 'DE' },
  { fips: '11', name: 'District of Columbia', abbr: 'DC' },
  { fips: '12', name: 'Florida',              abbr: 'FL' },
  { fips: '13', name: 'Georgia',              abbr: 'GA' },
  { fips: '15', name: 'Hawaii',               abbr: 'HI' },
  { fips: '16', name: 'Idaho',                abbr: 'ID' },
  { fips: '17', name: 'Illinois',             abbr: 'IL' },
  { fips: '18', name: 'Indiana',              abbr: 'IN' },
  { fips: '19', name: 'Iowa',                 abbr: 'IA' },
  { fips: '20', name: 'Kansas',               abbr: 'KS' },
  { fips: '21', name: 'Kentucky',             abbr: 'KY' },
  { fips: '22', name: 'Louisiana',            abbr: 'LA' },
  { fips: '23', name: 'Maine',                abbr: 'ME' },
  { fips: '24', name: 'Maryland',             abbr: 'MD' },
  { fips: '25', name: 'Massachusetts',        abbr: 'MA' },
  { fips: '26', name: 'Michigan',             abbr: 'MI' },
  { fips: '27', name: 'Minnesota',            abbr: 'MN' },
  { fips: '28', name: 'Mississippi',          abbr: 'MS' },
  { fips: '29', name: 'Missouri',             abbr: 'MO' },
  { fips: '30', name: 'Montana',              abbr: 'MT' },
  { fips: '31', name: 'Nebraska',             abbr: 'NE' },
  { fips: '32', name: 'Nevada',               abbr: 'NV' },
  { fips: '33', name: 'New Hampshire',        abbr: 'NH' },
  { fips: '34', name: 'New Jersey',           abbr: 'NJ' },
  { fips: '35', name: 'New Mexico',           abbr: 'NM' },
  { fips: '36', name: 'New York',             abbr: 'NY' },
  { fips: '37', name: 'North Carolina',       abbr: 'NC' },
  { fips: '38', name: 'North Dakota',         abbr: 'ND' },
  { fips: '39', name: 'Ohio',                 abbr: 'OH' },
  { fips: '40', name: 'Oklahoma',             abbr: 'OK' },
  { fips: '41', name: 'Oregon',               abbr: 'OR' },
  { fips: '42', name: 'Pennsylvania',         abbr: 'PA' },
  { fips: '44', name: 'Rhode Island',         abbr: 'RI' },
  { fips: '45', name: 'South Carolina',       abbr: 'SC' },
  { fips: '46', name: 'South Dakota',         abbr: 'SD' },
  { fips: '47', name: 'Tennessee',            abbr: 'TN' },
  { fips: '48', name: 'Texas',                abbr: 'TX' },
  { fips: '49', name: 'Utah',                 abbr: 'UT' },
  { fips: '50', name: 'Vermont',              abbr: 'VT' },
  { fips: '51', name: 'Virginia',             abbr: 'VA' },
  { fips: '53', name: 'Washington',           abbr: 'WA' },
  { fips: '54', name: 'West Virginia',        abbr: 'WV' },
  { fips: '55', name: 'Wisconsin',            abbr: 'WI' },
  { fips: '56', name: 'Wyoming',              abbr: 'WY' },
  // Territories
  { fips: '60', name: 'American Samoa',       abbr: 'AS' },
  { fips: '66', name: 'Guam',                 abbr: 'GU' },
  { fips: '69', name: 'Northern Mariana Islands', abbr: 'MP' },
  { fips: '72', name: 'Puerto Rico',          abbr: 'PR' },
  { fips: '78', name: 'U.S. Virgin Islands',  abbr: 'VI' },
]

// Build lookup maps at module load (O(1) lookups at runtime)
const BY_FIPS = new Map(STATES.map((s) => [s.fips, s]))
const BY_ABBR = new Map(STATES.map((s) => [s.abbr.toLowerCase(), s]))
const BY_NAME = new Map(STATES.map((s) => [s.name.toLowerCase(), s]))

/** Resolve a state to its FIPS code. Accepts FIPS, abbreviation, or full name. */
export function resolveStateFips(input: string): string {
  const trimmed = input.trim()

  // Already a valid FIPS?
  const padded = trimmed.padStart(2, '0')
  if (BY_FIPS.has(padded)) return padded

  // Abbreviation (e.g. "MN")
  const byAbbr = BY_ABBR.get(trimmed.toLowerCase())
  if (byAbbr) return byAbbr.fips

  // Full name (e.g. "Minnesota")
  const byName = BY_NAME.get(trimmed.toLowerCase())
  if (byName) return byName.fips

  throw new Error(`[LocalVision] Cannot resolve state FIPS for: "${input}"`)
}

/** Zero-pad a county FIPS to 3 digits. */
export function padCountyFips(fips: string | number): string {
  return String(fips).padStart(3, '0')
}

export function getStateMeta(fipsOrAbbrOrName: string): StateMeta | undefined {
  const f = fipsOrAbbrOrName.trim()
  return (
    BY_FIPS.get(f.padStart(2, '0')) ??
    BY_ABBR.get(f.toLowerCase()) ??
    BY_NAME.get(f.toLowerCase())
  )
}
