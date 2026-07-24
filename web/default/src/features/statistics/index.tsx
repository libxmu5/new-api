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
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useIsAdmin } from '@/hooks/use-admin'
import { SectionPageLayout } from '@/components/layout'
import type { Option } from '@/components/multi-select'
import { FadeIn } from '@/components/page-transition'
import { getStatistics } from './api'
import { StatsBreakdown } from './components/stats-breakdown'
import {
  StatsFilterBar,
  buildDefaultStatisticsFilters,
} from './components/stats-filter-bar'
import { StatsSummaryCards } from './components/stats-summary-cards'
import { StatsTrendChart } from './components/stats-trend-chart'
import type { StatisticsFilters, StatsTrendDimension } from './types'

export function Statistics() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [filters, setFilters] = useState<StatisticsFilters>(() =>
    buildDefaultStatisticsFilters()
  )
  const [trendDimension, setTrendDimension] =
    useState<StatsTrendDimension>('total')

  const statisticsQuery = useQuery({
    queryKey: [
      'statistics',
      isAdmin,
      filters.userIds,
      filters.tokenIds,
      filters.channelIds,
      filters.models,
      filters.start?.getTime(),
      filters.end?.getTime(),
      trendDimension,
    ],
    queryFn: () => getStatistics(filters, isAdmin, trendDimension),
    placeholderData: keepPreviousData,
  })

  const data = statisticsQuery.data?.data
  const loading = statisticsQuery.isPending
  const error = statisticsQuery.isError || statisticsQuery.data?.success === false

  const extraTokenOptions = useMemo<Option[]>(
    () =>
      (data?.distributions?.token ?? [])
        .filter((row) => row.key !== '' && row.key !== '0')
        .map((row) => ({
          label: row.label || `#${row.key}`,
          value: row.key,
        })),
    [data]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Usage Statistics')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          <FadeIn>
            <StatsFilterBar
              isAdmin={isAdmin}
              extraTokenOptions={extraTokenOptions}
              onApply={setFilters}
            />
          </FadeIn>
          <FadeIn delay={0.05}>
            <StatsSummaryCards
              totals={data?.totals}
              series={data?.time_series}
              loading={loading}
              error={Boolean(error)}
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <StatsTrendChart
              series={data?.time_series ?? []}
              trendSeries={data?.trend_series ?? []}
              dimension={trendDimension}
              onDimensionChange={setTrendDimension}
              isAdmin={isAdmin}
              loading={loading}
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <StatsBreakdown
              distributions={data?.distributions ?? {}}
              loading={loading}
              isAdmin={isAdmin}
            />
          </FadeIn>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
