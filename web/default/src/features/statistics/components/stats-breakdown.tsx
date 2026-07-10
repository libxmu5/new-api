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
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { buildDistributionSpec } from '../lib/charts'
import type { DistributionRow, StatsDimension, StatsMetric } from '../types'

const DIMENSION_TABS: Array<{ value: StatsDimension; labelKey: string }> = [
  { value: 'user', labelKey: 'User' },
  { value: 'token', labelKey: 'API Key' },
  { value: 'channel', labelKey: 'Channel' },
  { value: 'model', labelKey: 'Model' },
]

const METRIC_TABS: Array<{ value: StatsMetric; labelKey: string }> = [
  { value: 'cost', labelKey: 'Cost' },
  { value: 'tokens', labelKey: 'Tokens' },
  { value: 'calls', labelKey: 'Calls' },
]

const VARIANT_TABS = [
  { value: 'pie', labelKey: 'Pie Chart' },
  { value: 'bar', labelKey: 'Bar Chart' },
] as const

interface StatsBreakdownProps {
  distributions: Partial<Record<StatsDimension, DistributionRow[]>>
  loading: boolean
  isAdmin: boolean
}

export function StatsBreakdown({
  distributions,
  loading,
  isAdmin,
}: StatsBreakdownProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const visibleDimensions = useMemo(
    () =>
      DIMENSION_TABS.filter(
        (tab) => isAdmin || (tab.value !== 'user' && tab.value !== 'channel')
      ),
    [isAdmin]
  )
  const [dimension, setDimension] = useState<StatsDimension>(
    isAdmin ? 'user' : 'token'
  )
  const [metric, setMetric] = useState<StatsMetric>('cost')
  const [variant, setVariant] = useState<'pie' | 'bar'>('pie')
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

  const rows = useMemo(
    () => distributions[dimension] ?? [],
    [distributions, dimension]
  )

  const spec = useMemo(() => {
    if (rows.length === 0) return null
    return buildDistributionSpec({ rows, metric, variant, t })
  }, [rows, metric, variant, t])

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 className='text-sm font-semibold'>{t('Usage Breakdown')}</h3>
          <Tabs
            value={dimension}
            onValueChange={(value) => setDimension(value as StatsDimension)}
          >
            <TabsList className='h-8'>
              {visibleDimensions.map((tab) => (
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
            value={variant}
            onValueChange={(value) => setVariant(value as 'pie' | 'bar')}
          >
            <TabsList className='h-8'>
              {VARIANT_TABS.map((tab) => (
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
      <div className='grid grid-cols-1 lg:grid-cols-2'>
        <div className='min-h-[340px] p-2'>
          {loading || !themeReady ? (
            <Skeleton className='h-[340px] w-full' />
          ) : spec == null ? (
            <div className='text-muted-foreground flex h-[340px] items-center justify-center text-sm'>
              {t('No data available')}
            </div>
          ) : (
            <VChart
              key={[dimension, metric, variant, rows.length, resolvedTheme].join(
                '-'
              )}
              spec={{
                ...spec,
                theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                background: 'transparent',
              }}
              option={VCHART_OPTION}
            />
          )}
        </div>
        <div className='border-t lg:border-t-0 lg:border-l'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>#</TableHead>
                <TableHead>{t(getDimensionLabelKey(dimension))}</TableHead>
                <TableHead className='text-right'>{t('Cost')}</TableHead>
                <TableHead className='text-right'>{t('Tokens')}</TableHead>
                <TableHead className='text-right'>{t('Calls')}</TableHead>
                <TableHead className='text-right'>{t('Success')}</TableHead>
                <TableHead className='text-right'>{t('Failure')}</TableHead>
                <TableHead className='text-right'>
                  {t('Success Rate')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={8}>
                      <Skeleton className='h-5 w-full' />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-muted-foreground h-24 text-center'
                  >
                    {t('No data available')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => {
                  const successRate =
                    row.total_count > 0
                      ? (row.success_count / row.total_count) * 100
                      : 0
                  return (
                    <TableRow key={`${row.key}-${index}`}>
                      <TableCell className='text-muted-foreground'>
                        {index + 1}
                      </TableCell>
                      <TableCell
                        className='max-w-40 truncate font-medium'
                        title={row.label}
                      >
                        {row.label}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatQuota(row.quota)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatTokens(
                          row.prompt_tokens + row.completion_tokens
                        )}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.total_count)}
                      </TableCell>
                      <TableCell className='text-success text-right tabular-nums'>
                        {formatNumber(row.success_count)}
                      </TableCell>
                      <TableCell className='text-destructive text-right tabular-nums'>
                        {formatNumber(row.failure_count)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {row.total_count > 0
                          ? `${successRate.toFixed(1)}%`
                          : '--'}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function getDimensionLabelKey(dimension: StatsDimension): string {
  switch (dimension) {
    case 'user':
      return 'User'
    case 'token':
      return 'API Key'
    case 'channel':
      return 'Channel'
    case 'model':
      return 'Model'
  }
}
