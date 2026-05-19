import * as Plot from '@observablehq/plot'
import type { KpiSeries, ChartConfig, KpiFormat } from '../types'
import type { ResolvedTheme } from '../theme/tokens'

function formatValue(value: number, format?: KpiFormat, unit?: string): string {
  switch (format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`
    case 'currency': return `$${value.toLocaleString()}`
    case 'rate': return `${value.toFixed(1)}${unit ?? ''}`
    default: return value.toLocaleString()
  }
}

export function renderChart(
  config: ChartConfig,
  series: KpiSeries,
  container: HTMLElement,
  theme: ResolvedTheme,
  width: number,
  height: number,
): void {
  container.innerHTML = ''

  const color = config.color ?? theme.colorPrimary
  const { data } = series

  let plot: SVGSVGElement | HTMLElement

  const sharedOptions: Plot.PlotOptions = {
    width,
    height: config.height ?? height,
    marginLeft: 52,
    marginBottom: 36,
    marginRight: 16,
    marginTop: 8,
    style: {
      background: 'transparent',
      color: theme.colorTextMuted,
      fontFamily: theme.fontFamily,
      fontSize: '11px',
      overflow: 'visible',
    },
    x: {
      tickSize: 0,
      tickPadding: 8,
      line: false,
    },
    y: {
      tickSize: 0,
      tickPadding: 8,
      line: false,
      tickFormat: (d: number) => formatValue(d, series.format, series.unit),
    },
  }

  switch (config.type) {
    case 'bar':
      plot = Plot.plot({
        ...sharedOptions,
        marks: [
          Plot.gridY({ stroke: theme.colorBorder, strokeOpacity: 0.5 }),
          Plot.barY(data, {
            x: 'category',
            y: 'value',
            fill: color,
            fillOpacity: 0.85,
            rx: 3,
            tip: {
              format: {
                x: (d: string | number) => String(d),
                y: (d: number) => formatValue(d, series.format, series.unit),
              },
            },
          }),
          Plot.ruleY([0], { stroke: theme.colorBorder }),
        ],
      })
      break

    case 'line':
      plot = Plot.plot({
        ...sharedOptions,
        marks: [
          Plot.gridY({ stroke: theme.colorBorder, strokeOpacity: 0.5 }),
          Plot.areaY(data, {
            x: 'category',
            y: 'value',
            fill: color,
            fillOpacity: 0.08,
            curve: 'monotone-x',
          }),
          Plot.lineY(data, {
            x: 'category',
            y: 'value',
            stroke: color,
            strokeWidth: 2,
            curve: 'monotone-x',
          }),
          Plot.dotY(data, {
            x: 'category',
            y: 'value',
            fill: color,
            r: 3,
            tip: {
              format: {
                x: (d: string | number) => String(d),
                y: (d: number) => formatValue(d, series.format, series.unit),
              },
            },
          }),
        ],
      })
      break

    case 'area':
      plot = Plot.plot({
        ...sharedOptions,
        marks: [
          Plot.gridY({ stroke: theme.colorBorder, strokeOpacity: 0.5 }),
          Plot.areaY(data, {
            x: 'category',
            y: 'value',
            fill: color,
            fillOpacity: 0.25,
            curve: 'monotone-x',
          }),
          Plot.lineY(data, {
            x: 'category',
            y: 'value',
            stroke: color,
            strokeWidth: 1.5,
            curve: 'monotone-x',
          }),
        ],
      })
      break

    case 'scatter':
      plot = Plot.plot({
        ...sharedOptions,
        marks: [
          Plot.gridY({ stroke: theme.colorBorder, strokeOpacity: 0.5 }),
          Plot.gridX({ stroke: theme.colorBorder, strokeOpacity: 0.5 }),
          Plot.dot(data, {
            x: 'category',
            y: 'value',
            fill: color,
            fillOpacity: 0.7,
            r: 5,
            tip: true,
          }),
          Plot.ruleY([0], { stroke: theme.colorBorder }),
        ],
      })
      break

    case 'donut': {
      // Observable Plot doesn't have a native donut — build a simple SVG one
      plot = buildDonutSvg(data, color, theme, width, config.height ?? height)
      break
    }

    default:
      return
  }

  container.appendChild(plot)
}

function buildDonutSvg(
  data: KpiSeries['data'],
  color: string,
  theme: ResolvedTheme,
  width: number,
  height: number,
): SVGSVGElement {
  const total = data.reduce((s, d) => s + d.value, 0)
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(cx, cy) - 24
  const inner = r * 0.58

  const palette = [color, theme.colorAccent, ...theme.chartPalette.slice(2)]

  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))

  let startAngle = -Math.PI / 2

  data.forEach((d, i) => {
    const slice = (d.value / total) * 2 * Math.PI
    const endAngle = startAngle + slice
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const xi1 = cx + inner * Math.cos(endAngle)
    const yi1 = cy + inner * Math.sin(endAngle)
    const xi2 = cx + inner * Math.cos(startAngle)
    const yi2 = cy + inner * Math.sin(startAngle)
    const large = slice > Math.PI ? 1 : 0

    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute(
      'd',
      `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi2} ${yi2} Z`,
    )
    path.setAttribute('fill', palette[i % palette.length])
    path.setAttribute('fill-opacity', '0.85')
    svg.appendChild(path)
    startAngle = endAngle
  })

  // Center label
  const pct = document.createElementNS(svgNS, 'text')
  pct.setAttribute('x', String(cx))
  pct.setAttribute('y', String(cy + 6))
  pct.setAttribute('text-anchor', 'middle')
  pct.setAttribute('fill', theme.colorText)
  pct.setAttribute('font-size', '20')
  pct.setAttribute('font-weight', '600')
  pct.textContent = String(data.length)
  svg.appendChild(pct)

  const sub = document.createElementNS(svgNS, 'text')
  sub.setAttribute('x', String(cx))
  sub.setAttribute('y', String(cy + 22))
  sub.setAttribute('text-anchor', 'middle')
  sub.setAttribute('fill', theme.colorTextMuted)
  sub.setAttribute('font-size', '11')
  sub.textContent = 'segments'
  svg.appendChild(sub)

  return svg
}
