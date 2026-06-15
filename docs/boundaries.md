# Boundaries

LocalVision ships with a `BoundaryLoader` that knows how to fetch every US Census ADM and sub-community level — caches them locally so subsequent loads are instant.

## Levels

| Method | Geographic level | Notes |
|---|---|---|
| `states()` | All 50 states + DC + territories | Nation-wide; cached |
| `counties(stateFips?)` | Counties of a state, or nation-wide | ~3200 nation-wide |
| `places(stateFips)` | Incorporated places + CDPs | ~30k nation-wide |
| `countySubdivisions(stateFips)` | Townships, boroughs, MCDs | |
| `tracts(stateFips, countyFips?)` | Census tracts | Optional county filter |
| `blockGroups(stateFips, countyFips?)` | Block groups (~600–3000 ppl) | Optional county filter |
| `zctas()` | ZIP code tabulation areas | ~15MB nation-wide; use `filterByBbox` |
| `congressionalDistricts(stateFips)` | 118th Congress districts | |
| `unifiedSchoolDistricts(stateFips)` | K-12 districts | |
| `placesIndex(stateFips?)` | Lightweight name+GEOID index | No geometry; ~10k names per state |

State input is permissive: `27`, `"27"`, `"MN"`, `"Minnesota"` — they all resolve to FIPS 27.

## Caching

Three layers, all opt-in:

```ts
const loader = new BoundaryLoader({
  sessionCache: true,      // sessionStorage (5MB cap, per-tab)
  persistentCache: true,   // IndexedDB (gigabytes, survives reloads)
})
```

Plus an always-on in-memory cache + concurrent-request deduplication. The cache pipeline reads in this order:

```
in-memory → in-flight dedup → IndexedDB → sessionStorage → network
```

After the first fetch of (say) MN tracts, reloading the page is instant.

```ts
console.log(loader.cacheStats)
// → { hits: 12, misses: 1, coalesced: 3, inFlight: 0, memSize: 12 }
```

Clear it explicitly when you need to:

```ts
await loader.clearCache()
```

## Loader internals

Two data sources under the hood:

- **`www2.census.gov`** static cartographic boundary files — fastest for nation-wide fetches (states, all counties). CORS-enabled for these specific files.
- **TIGERweb REST API** (`tigerweb.geo.census.gov/.../tigerWMS_ACS2022`) — fully CORS-enabled, paginated, used for state-scoped queries (state's counties, places, tracts, etc.).

TIGERweb has a WAF that rejects large `OBJECTID IN (...)` queries when geometry is requested. The loader works around this by enumerating OBJECTIDs in chunks of 30. You should not need to know this; it's just here so the next person doesn't get bitten.

## Spatial helpers

For point-in-polygon work (e.g. "which county does this lat/lon fall in?"):

```ts
import { bbox, bboxCenter, pointInPolygon, findFeatureContaining } from 'localvision'

const center = bboxCenter(cityPolygon.geometry)
const county = findFeatureContaining(center, countyFeatureCollection.features)
```

LocalVision uses this internally to resolve a city's containing county FIPS when the user picks a city for Inner-view drill-down.
