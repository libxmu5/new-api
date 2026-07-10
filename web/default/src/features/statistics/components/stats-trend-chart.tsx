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
import { useEffect, useMemo, useState } from 'react'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/context/theme-provider'
import { VCHART_OPTION } from '@/lib/vchart'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { buildTrendSpec } from '../lib/charts'
import type { StatsBucket, StatsMetric } from '../types'

const METRIC_TABS: Array<{ value: StatsMetric; labelKey: string }> = [
  { value: 'cost', labelKey: 'Cost' },
  { value: 'tokens', labelKey: 'Tokens' },
  { value: 'calls', labelKey: 'Calls' },
]

const CHART_TYPE_TABS = [
  { value: 'bar', labelKey: 'Bar Chart' },
  { value: 'area', labelKey: 'Area Chart' },
] as const

interface StatsTrendChartProps {
  series: StatsBucket[]
  loading: boolean
}

export function StatsTrendChart({ series, loading }: StatsTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [metric, setMetric] = useState<StatsMetric>('cost')
  const [chartType, setChartType] = useState<'bar' | 'area'>('bar')
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setThemeReady(false)
      const ThemeManager = await import('@visactor/vchart').then(
        (m) => m.ThemeManager
      )
      if (cancelled) return
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [resolvedTheme])

  const spec = useMemo(() => {
    if (series.length === 0) return null
    return buildTrendSpec({ series, metric, chartType, t })
  }, [series, metric, chartType, t])

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5'>
        <h3 className='text-sm font-semibold'>{t('Usage Trend')}</h3>
        <div className='flex flex-wrap items-center gap-2'>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as StatsMetric)}
          >
            <TabsList className='h-8'>
              {METRIC_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className='px-2.5 text-xs'
                >
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs
            value={chartType}
            onValueChange={(value) => setChartType(value as 'bar' | 'area')}
          >
            <TabsList className='h-8'>
              {CHART_TYPE_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className='px-2.5 text-xs'
                >
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>
      <div className='min-h-[340px] p-2'>
        {loading || !themeReady ? (
          <Skeleton className='h-[340px] w-full' />
        ) : spec == null ? (
          <div className='text-muted-foreground flex h-[340px] items-center justify-center text-sm'>
            {t('No data available')}
          </div>
        ) : (
          <VChart
            key={[metric, chartType, series.length, resolvedTheme].join('-')}
            spec={{
              ...spec,
              theme: resolvedTheme === 'dark' ? 'dark' : 'light',
              background: 'transparent',
            }}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </div>
  )
}
