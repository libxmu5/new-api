/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { ISpec } from '@visactor/vchart'
import { getCurrencyDisplay } from '@/lib/currency'
import type { DistributionRow, StatsBucket, StatsMetric } from '../types'

type TFunction = (key: string) => string

const THEME_CHART_COLOR_VARIABLES = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
] as const

function readCssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  const bodyStyle = window.getComputedStyle(document.body)
  const rootStyle = window.getComputedStyle(document.documentElement)
  return (
    bodyStyle.getPropertyValue(name) || rootStyle.getPropertyValue(name)
  ).trim()
}

function getThemeChartColors(): string[] {
  return THEME_CHART_COLOR_VARIABLES.map(readCssVar).filter(Boolean)
}

function getSuccessFailureColors(): [string, string] {
  const success = readCssVar('--chart-2') || '#10b981'
  const failure = readCssVar('--destructive') || '#ef4444'
  return [success, failure]
}

export function renderQuota(rawQuota: number, digits = 4): string {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return rawQuota.toLocaleString()
  const usd = rawQuota / config.quotaPerUnit
  const rate = 'exchangeRate' in meta ? meta.exchangeRate : 1
  const symbol = 'symbol' in meta ? meta.symbol : '$'
  const value = usd * rate
  const fixed = value.toFixed(digits)
  if (parseFloat(fixed) === 0 && rawQuota > 0 && value > 0) {
    return symbol + Math.pow(10, -digits).toFixed(digits)
  }
  return symbol + fixed
}

function formatInt(value: number): string {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value
  )
}

export function formatMetricValue(metric: StatsMetric, value: number): string {
  if (metric === 'cost') return renderQuota(value, 4)
  return formatInt(value)
}

export function metricValueOf(
  metric: StatsMetric,
  row: Pick<DistributionRow, 'quota' | 'prompt_tokens' | 'completion_tokens' | 'total_count'>
): number {
  switch (metric) {
    case 'cost':
      return row.quota
    case 'tokens':
      return row.prompt_tokens + row.completion_tokens
    case 'calls':
      return row.total_count
  }
}

interface TrendSpecOptions {
  series: StatsBucket[]
  metric: StatsMetric
  chartType: 'bar' | 'area'
  t: TFunction
}

export function buildTrendSpec(options: TrendSpecOptions): ISpec {
  const { series, metric, chartType, t } = options

  let values: Array<{ bucket: string; series: string; value: number }> = []
  let colors: string[]

  if (metric === 'cost') {
    values = series.map((item) => ({
      bucket: item.bucket,
      series: t('Cost'),
      value: item.quota,
    }))
    colors = getThemeChartColors().slice(0, 1)
  } else if (metric === 'tokens') {
    const promptLabel = t('Prompt Tokens')
    const completionLabel = t('Completion Tokens')
    for (const item of series) {
      values.push({
        bucket: item.bucket,
        series: promptLabel,
        value: item.prompt_tokens,
      })
      values.push({
        bucket: item.bucket,
        series: completionLabel,
        value: item.completion_tokens,
      })
    }
    colors = getThemeChartColors().slice(0, 2)
  } else {
    const successLabel = t('Success')
    const failureLabel = t('Failure')
    for (const item of series) {
      values.push({
        bucket: item.bucket,
        series: successLabel,
        value: item.success_count,
      })
      values.push({
        bucket: item.bucket,
        series: failureLabel,
        value: item.failure_count,
      })
    }
    colors = getSuccessFailureColors()
  }

  const isCost = metric === 'cost'
  const formatValue = (v: number) => formatMetricValue(metric, v)

  const spec = {
    type: chartType,
    data: [{ id: 'trend', values }],
    xField: 'bucket',
    yField: 'value',
    seriesField: 'series',
    stack: true,
    height: 340,
    color: colors.length > 0 ? colors : undefined,
    legends: { visible: true, orient: 'bottom' },
    ...(chartType === 'area'
      ? {
          area: { style: { fillOpacity: 0.25 } },
          line: { style: { lineWidth: 2 } },
          point: { style: { visible: false } },
        }
      : { bar: { style: {} } }),
    axes: [
      {
        orient: 'left',
        label: {
          formatMethod: (v: unknown) =>
            isCost ? renderQuota(Number(v), 2) : formatInt(Number(v)),
        },
      },
      { orient: 'bottom', sampling: true },
    ],
    tooltip: {
      dimension: {
        content: {
          key: (datum: Record<string, unknown> | undefined) =>
            String(datum?.series ?? ''),
          value: (datum: Record<string, unknown> | undefined) =>
            formatValue(Number(datum?.value ?? 0)),
        },
      },
      mark: {
        content: {
          key: (datum: Record<string, unknown> | undefined) =>
            String(datum?.series ?? ''),
          value: (datum: Record<string, unknown> | undefined) =>
            formatValue(Number(datum?.value ?? 0)),
        },
      },
    },
  }
  return spec as unknown as ISpec
}

interface DistributionSpecOptions {
  rows: DistributionRow[]
  metric: StatsMetric
  variant: 'pie' | 'bar'
  t: TFunction
}

export function buildDistributionSpec(options: DistributionSpecOptions): ISpec {
  const { rows, metric, variant, t } = options
  const values = rows
    .map((row) => ({
      label: row.label || t('Unknown'),
      value: metricValueOf(metric, row),
    }))
    .filter((item) => item.value > 0)

  const colors = getThemeChartColors()
  const formatValue = (v: number) => formatMetricValue(metric, v)

  if (variant === 'pie') {
    const spec = {
      type: 'pie',
      data: [{ id: 'distribution', values }],
      valueField: 'value',
      categoryField: 'label',
      outerRadius: 0.85,
      innerRadius: 0.55,
      height: 340,
      color: colors.length > 0 ? colors : undefined,
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      tooltip: {
        mark: {
          content: {
            key: (datum: Record<string, unknown> | undefined) =>
              String(datum?.label ?? ''),
            value: (datum: Record<string, unknown> | undefined) =>
              formatValue(Number(datum?.value ?? 0)),
          },
        },
      },
    }
    return spec as unknown as ISpec
  }

  const spec = {
    type: 'bar',
    data: [{ id: 'distribution', values: [...values].reverse() }],
    direction: 'horizontal',
    xField: 'value',
    yField: 'label',
    height: 340,
    color: colors.length > 0 ? colors.slice(0, 1) : undefined,
    legends: { visible: false },
    axes: [
      {
        orient: 'bottom',
        label: {
          formatMethod: (v: unknown) =>
            metric === 'cost' ? renderQuota(Number(v), 2) : formatInt(Number(v)),
        },
      },
      { orient: 'left' },
    ],
    tooltip: {
      mark: {
        content: {
          key: (datum: Record<string, unknown> | undefined) =>
            String(datum?.label ?? ''),
          value: (datum: Record<string, unknown> | undefined) =>
            formatValue(Number(datum?.value ?? 0)),
        },
      },
    },
  }
  return spec as unknown as ISpec
}
