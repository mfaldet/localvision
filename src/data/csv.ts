/**
 * Lightweight CSV → DataTable loader.
 *
 * Limitations vs a full CSV parser (Papa Parse, etc.):
 *  - Supports double-quote-wrapped fields with embedded commas and escaped
 *    quotes (RFC 4180-ish).
 *  - Does NOT support multi-line quoted fields. Use Papa Parse if you need that.
 *  - Headers are required.
 */

import type { DataRow, DataTable } from './types'
import { resolveVariable } from './variables'
import type { VariableMeta } from './variables'

export interface ParseCsvOptions {
  /** Column name containing the GEOID. Default: auto-detect 'GEOID' / 'geoid' / 'GEO_ID'. */
  geoidColumn?: string
  /**
   * Column names to treat as values. Default: every column except geoidColumn
   * and `NAME`.
   */
  valueColumns?: string[]
  /**
   * Map a column name → catalog key or VariableMeta. By default, every value
   * column is resolved against CENSUS_VARIABLES; columns that don't match
   * become minimal stubs (numeric, category='community').
   */
  columnToVariable?: (column: string) => string | VariableMeta
  /** Optional NAME column. Default: auto-detect 'NAME' / 'name'. */
  nameColumn?: string
}

export function parseCsv(text: string, options: ParseCsvOptions = {}): DataTable {
  const rows = parseCsvRows(text)
  if (rows.length === 0) throw new Error('[LocalVision] CSV is empty.')

  const headers = rows[0]
  const dataRows = rows.slice(1)

  const geoidCol = options.geoidColumn ?? autoDetect(headers, ['GEOID', 'geoid', 'GEO_ID', 'geoId'])
  if (!geoidCol) {
    throw new Error('[LocalVision] CSV missing GEOID column (looked for GEOID, geoid, GEO_ID).')
  }
  const nameCol = options.nameColumn ?? autoDetect(headers, ['NAME', 'name'])

  const valueCols =
    options.valueColumns ??
    headers.filter((h) => h !== geoidCol && h !== nameCol)

  // Resolve variable metadata for each value column
  const variables: VariableMeta[] = valueCols.map((col) => {
    if (options.columnToVariable) {
      const resolved = options.columnToVariable(col)
      return typeof resolved === 'string' ? resolveVariable(resolved) : resolved
    }
    try {
      return resolveVariable(col)
    } catch {
      // Unknown column — emit a stub
      return {
        key: col,
        code: '',
        label: col,
        format: 'number',
        category: 'community',
      }
    }
  })

  // Build index map for column lookup
  const idx = new Map(headers.map((h, i) => [h, i]))

  const parsed: DataRow[] = dataRows.map((row) => {
    const geoid = String(row[idx.get(geoidCol) ?? -1] ?? '').trim()
    const name = nameCol ? row[idx.get(nameCol) ?? -1] : undefined
    const values: Record<string, number | null> = {}
    valueCols.forEach((col, i) => {
      const v = row[idx.get(col) ?? -1]
      values[variables[i].key] = parseNumeric(v)
    })
    return { geoid, name, values }
  })

  return { variables, rows: parsed }
}

/** Fetch and parse a CSV from a URL. */
export async function loadCsv(
  url: string,
  options: ParseCsvOptions = {},
): Promise<DataTable> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[LocalVision] Failed to load CSV: HTTP ${res.status}\n  URL: ${url}`)
  }
  const text = await res.text()
  return parseCsv(text, options)
}

// ─── Internal: tokenizer + helpers ────────────────────────────────────────────

function parseCsvRows(text: string): string[][] {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const out: string[][] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (line === '') continue
    out.push(parseCsvLine(line))
  }
  return out
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let i = 0
  let cur = ''
  let inQuotes = false

  while (i < line.length) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 2
      } else if (ch === '"') {
        inQuotes = false
        i++
      } else {
        cur += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        result.push(cur)
        cur = ''
        i++
      } else {
        cur += ch
        i++
      }
    }
  }
  result.push(cur)
  return result
}

function autoDetect(headers: string[], candidates: string[]): string | undefined {
  for (const c of candidates) if (headers.includes(c)) return c
  return undefined
}

function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null
  const t = String(raw).trim()
  if (!t || t === '(X)' || t === '**' || t === '*' || t === 'null' || t === 'NA') return null
  const n = Number(t)
  return isFinite(n) ? n : null
}
