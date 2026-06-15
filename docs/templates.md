# Templates

Curated dashboard configs that bootstrap a domain-specific view in one call. Each template picks a sensible variable set, active KPI, color scheme, and default boundary levels.

## Available templates

| Template | Focus | Active KPI | Scheme |
|---|---|---|---|
| `equity` | Income, affordability, poverty, education | Median household income | Red ↔ Blue (diverging) |
| `housing` | Home value, rent, housing stock | Median home value | Viridis |
| `economic` | Income, employment, commute | Median household income | Blue → Green |
| `community` | Population, age, housing units | Total population | CB-safe sequential |

## Usage

```ts
import { LocalVisionApp } from 'localvision'

const app = LocalVisionApp.fromTemplate('equity', {
  container: '#app',
  boundaryContext: { stateFips: '27' },
  outer: { binding },
  inner: { /* placeholder until a city is picked */ },
  drillProvider: async ({ level, parent, context }) => { /* … */ },
})
```

`fromTemplate(name, options)` merges the template's defaults into your options. Anything you pass explicitly — `container`, `drillProvider`, `theme`, `defaultView` — overrides the template.

## Inspecting templates

```ts
import { DASHBOARD_TEMPLATES, TEMPLATE_IDS, getTemplate } from 'localvision'

console.log(TEMPLATE_IDS) // ['equity', 'housing', 'economic', 'community']

const equity = getTemplate('equity')
console.log(equity.variables)   // ACS catalog keys
console.log(equity.activeKpi)   // 'median_household_income'
```

`getTemplate` throws with the list of valid ids when you pass an unknown name — no silent `undefined`.

## Defining your own

A template is a plain object implementing `DashboardTemplate`:

```ts
import type { DashboardTemplate } from 'localvision'

const myTemplate: DashboardTemplate = {
  id: 'public-health',
  label: 'Public Health',
  description: 'Insurance coverage, age, income.',
  variables: ['no_health_insurance_count', 'median_age', 'median_household_income'],
  activeKpi: 'no_health_insurance_count',
  colorScheme: 'cbSafeSequential',
  defaultOuterBoundary: 'county',
  defaultInnerBoundary: 'tract',
}
```

Then build the app manually (the `fromTemplate` factory only knows the built-in registry):

```ts
new LocalVisionApp({
  container: '#app',
  defaultOuterBoundary: myTemplate.defaultOuterBoundary,
  defaultInnerBoundary: myTemplate.defaultInnerBoundary,
  outer: { binding, activeKpi: myTemplate.activeKpi },
  inner: { /* … */ },
})
```
