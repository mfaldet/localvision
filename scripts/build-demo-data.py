#!/usr/bin/env python3
"""Build the saved data files the live demo reads.

The demo page holds no API key, so it cannot call the Census data API. This
script downloads the Census Bureau's public bulk files for two American
Community Survey 5-year periods and writes small JSON files into
demo/public/data/. Re-run it once a year when a new period is released.

    pip install pandas
    python scripts/build-demo-data.py            # downloads ~270 MB into .cache/acs
    python scripts/build-demo-data.py --cache /path/to/files

Sources (U.S. Census Bureau, American Community Survey 5-year estimates):
  2020-2024  www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/
  2015-2019  www2.census.gov/programs-surveys/acs/summary_file/2019/prototype/
Tables: B01003 (population), B11001 (households), B19013 (median household
income), B25064 (median gross rent).

Dollar amounts for 2015-2019 are converted to 2024 dollars with the factor the
Census Bureau publishes for this pair of periods: R-CPI-U-RS annual average
2024 (462.5) / 2019 (375.8) = 1.23070782.
"""
import argparse, json, os, re, time, urllib.parse, urllib.request
import pandas as pd

BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file'
SRC = {
    2024: (f'{BASE}/2024/table-based-SF/data/5YRData', f'{BASE}/2024/table-based-SF/documentation/Geos20245YR.txt'),
    2019: (f'{BASE}/2019/prototype/5YRData', None),
}
TABLES = [('population', 'b01003'), ('households', 'b11001'), ('median_household_income', 'b19013'), ('median_gross_rent', 'b25064')]
DOLLARS = {'median_household_income', 'median_gross_rent'}
TOP = {'median_household_income': 250001, 'median_gross_rent': 3501}   # "or more" codes
BOTTOM = {'median_household_income': 2499, 'median_gross_rent': 99}    # "or less" codes
FACTOR = 462.5 / 375.8
PERIODS = ['2015–2019', '2020–2024']
LEVELS = {'050': 'county', '160': 'place', '140': 'tract'}
METRO = {'003': 'Anoka', '019': 'Carver', '037': 'Dakota', '053': 'Hennepin', '123': 'Ramsey', '139': 'Scott', '163': 'Washington'}
TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer'


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    print('downloading', url)
    urllib.request.urlretrieve(url, path)
    return path


def load(year, cache):
    """One row per geography: GEO_ID, the four estimates and their margins of error (90% confidence).
    Special codes become missing, except a margin the Bureau marks as controlled, which is 0."""
    out = None
    for key, table in TABLES:
        path = fetch(f'{SRC[year][0]}/acsdt5y{year}-{table}.dat', f'{cache}/acsdt5y{year}-{table}.dat')
        col, mcol = f'{table.upper()}_E001', f'{table.upper()}_M001'
        d = pd.read_csv(path, sep='|', dtype={'GEO_ID': str}, usecols=['GEO_ID', col, mcol]).rename(columns={col: key, mcol: key + '_moe'})
        d = d[d.GEO_ID.str[:3].isin(LEVELS) & (d.GEO_ID.str[3:7] == '0000')]
        v = d[key].astype('float')
        v = v.where(v >= 0)                                   # negative codes mean "no estimate"
        if key in TOP:
            v = v.where((v < TOP[key]) & (v > BOTTOM[key]))   # open-ended medians cannot be shown as a number
        m = d[key + '_moe'].astype('float')
        m = m.where(m != -555555555, 0)                       # controlled to official estimates: no sampling margin
        m = m.where((m >= 0) & v.notna())                     # other negative codes mean "no margin published"
        if key in DOLLARS and year == 2019:
            v, m = (v * FACTOR).round(), (m * FACTOR).round()
        d[key], d[key + '_moe'] = v, m
        out = d if out is None else out.merge(d, on='GEO_ID', how='outer')
    return out.set_index('GEO_ID')


def clean_place_name(name):
    name = name.rsplit(',', 1)[0]
    return re.sub(r' (city and borough|municipality|city|town|village|borough|CDP|urban county|metro government|consolidated government|unified government|metropolitan government)( \(balance\))?$', '', name)


def num(v):
    return None if pd.isna(v) else int(v)


def tigerweb(layer, where, tolerance):
    """Boundaries from the Census TIGERweb service, simplified so the file stays small."""
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({'where': where, 'outFields': 'NAME,GEOID,STATE,COUNTY', 'returnGeometry': 'true', 'outSR': '4326',
                                    'f': 'geojson', 'maxAllowableOffset': tolerance, 'geometryPrecision': 5,
                                    'resultOffset': offset, 'resultRecordCount': 500})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(f'{TIGERWEB}/{layer}/query?{q}', timeout=120) as r:
                    page = json.load(r)
                break
            except Exception as e:
                if attempt == 3: raise
                time.sleep(3 * (attempt + 1))
        if 'error' in page:
            raise RuntimeError(page['error'])
        got = page.get('features', [])
        for f in got:
            f.pop('id', None)
        feats += got
        if len(got) < 500:
            return {'type': 'FeatureCollection', 'features': feats}
        offset += 500


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='.cache/acs')
    ap.add_argument('--out', default='demo/public/data')
    ap.add_argument('--skip-boundaries', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    for level in list(LEVELS.values()) + ['metro']:
        os.makedirs(f'{a.out}/{level}', exist_ok=True)

    old, new = load(2019, a.cache), load(2024, a.cache)
    geos = pd.read_csv(fetch(SRC[2024][1], f'{a.cache}/Geos20245YR.txt'), sep='|', dtype=str, usecols=['SUMLEVEL', 'COMPONENT', 'STATE', 'GEO_ID', 'NAME'])
    geos = geos[geos.SUMLEVEL.isin(LEVELS) & (geos.COMPONENT == '00') & geos.STATE.notna()]
    geos = geos[geos.STATE.astype(int) <= 56]                 # 50 states and DC
    keys = [k for k, _ in TABLES]
    cols = keys + [k + '_moe' for k in keys]   # estimates, then margins
    newd, oldd = new[cols].to_dict('index'), old[cols].to_dict('index')
    blank = dict.fromkeys(cols)
    written = 0
    for (sumlevel, state), g in geos.groupby(['SUMLEVEL', 'STATE']):
        level = LEVELS[sumlevel]
        rows = {}
        for gid in g.GEO_ID:
            short = gid.split('US')[1]
            n, o = newd.get(gid, blank), oldd.get(gid, blank)
            if level == 'tract':
                rows[short] = [num(n[c]) for c in cols]        # tracts were redrawn in 2020: latest period only
            else:
                # per period: the estimates, then the margins
                rows[short] = [num(o[c]) for c in keys] + [num(n[c]) for c in keys] + [num(o[c + '_moe']) for c in keys] + [num(n[c + '_moe']) for c in keys]
        doc = {'periods': PERIODS[1:] if level == 'tract' else PERIODS, 'measures': keys,
               'layout': 'for each period the estimates in measure order, then for each period the margins of error in measure order', 'rows': rows}
        with open(f'{a.out}/{level}/{state}.json', 'w') as f:
            json.dump(doc, f, separators=(',', ':'))
        written += 1

    # National color scales, so a color can mean the same thing wherever the visitor looks.
    # Breaks sit at every 5th percentile of all areas of a level, which puts the most
    # color steps where most areas are and keeps small differences visible.
    # For change: percentiles of the size of the percentage change, used on both sides of zero.
    scales = {}
    pct = [i / 20 for i in range(21)]
    for sumlevel, level in LEVELS.items():
        ids = geos[geos.SUMLEVEL == sumlevel].GEO_ID
        n, o = new.reindex(ids), old.reindex(ids)
        scales[level] = {}
        for k in keys:
            entry = {'breaks': [round(float(v), 1) for v in n[k].dropna().quantile(pct)]}
            if level != 'tract':
                change = ((n[k] / o[k].where(o[k] > 0) - 1) * 100).dropna().abs()
                entry['changeBreaks'] = [round(float(v), 2) for v in change.quantile([0.2, 0.4, 0.6, 0.8, 0.95])]
            scales[level][k] = entry
    with open(f'{a.out}/scales.json', 'w') as f:
        json.dump({'basis': 'all areas of each level in the 50 states and DC, 2020-2024', 'levels': scales}, f, separators=(',', ':'))

    # search list: every place, largest first, so the biggest place of a name comes first
    p = geos[geos.SUMLEVEL == '160']
    pop = new['population']
    index = sorted(([gid.split('US')[1], clean_place_name(name), num(pop.get(gid))] for gid, name in zip(p.GEO_ID, p.NAME)), key=lambda r: -(r[2] or 0))
    with open(f'{a.out}/places.json', 'w') as f:
        json.dump(index, f, separators=(',', ':'), ensure_ascii=False)

    if not a.skip_boundaries:
        # the opening view (Twin Cities, seven counties) is saved so it does not depend on a live service
        codes = ','.join(f"'{c}'" for c in METRO)
        counties = tigerweb(78, f"STATE='27' AND COUNTY IN ({codes})", 0.0004)
        tracts = {'type': 'FeatureCollection', 'features': []}
        for c in METRO:
            tracts['features'] += tigerweb(6, f"STATE='27' AND COUNTY='{c}'", 0.0002)['features']
        for name, fc in (('counties', counties), ('tracts', tracts)):
            with open(f'{a.out}/metro/{name}.geojson', 'w') as f:
                json.dump(fc, f, separators=(',', ':'))
            print('metro', name, len(fc['features']))
    with open(f'{a.out}/about.json', 'w') as f:
        json.dump({'periods': PERIODS, 'measures': keys, 'margins': '90% confidence, as published', 'dollar_year': 2024, 'inflation_factor_2019_to_2024': round(FACTOR, 8),
                   'tables': {k: t.upper() for k, t in TABLES}, 'built': time.strftime('%Y-%m-%d')}, f, indent=1)
    print('files written:', written, 'places in search list:', len(index))


if __name__ == '__main__':
    main()
