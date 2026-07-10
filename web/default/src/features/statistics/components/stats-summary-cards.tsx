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
import { useMemo } from 'react'
import { Activity, CircleDollarSign, Coins, Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import type { StatsBucket, StatsTotals } from '../types'

interface StatsSummaryCardsProps {
  totals?: StatsTotals
  series?: StatsBucket[]
  loading: boolean
  error: boolean
}

export function StatsSummaryCards({
  totals,
  series,
  loading,
  error,
}: StatsSummaryCardsProps) {
  const { t } = useTranslation()

  const sparklines = useMemo(() => {
    const buckets = series ?? []
    return {
      quota: buckets.map((item) => item.quota),
      tokens: buckets.map((item) => item.prompt_tokens + item.completion_tokens),
      calls: buckets.map((item) => item.total_count),
      successRate: buckets.map((item) =>
        item.total_count > 0 ? (item.success_count / item.total_count) * 100 : 0
      ),
    }
  }, [series])

  const totalTokens = (totals?.prompt_tokens ?? 0) + (totals?.completion_tokens ?? 0)
  const totalCount = totals?.total_count ?? 0
  const successRate =
    totalCount > 0 ? ((totals?.success_count ?? 0) / totalCount) * 100 : 0

  const cards = [
    {
      title: t('Total Cost'),
      value: formatQuota(totals?.quota ?? 0),
      description: t('Consumption in selected range'),
      icon: CircleDollarSign,
      sparkline: sparklines.quota,
      tone: 'teal' as const,
    },
    {
      title: t('Token Usage'),
      value: formatTokens(totalTokens) === '-' ? '0' : formatTokens(totalTokens),
      description: `${t('Prompt')} ${formatTokens(totals?.prompt_tokens ?? 0)} / ${t('Completion')} ${formatTokens(totals?.completion_tokens ?? 0)}`,
      icon: Coins,
      sparkline: sparklines.tokens,
      tone: 'gray' as const,
    },
    {
      title: t('Total Calls'),
      value: formatNumber(totalCount),
      description: `${t('Success')} ${formatNumber(totals?.success_count ?? 0)} / ${t('Failure')} ${formatNumber(totals?.failure_count ?? 0)}`,
      icon: Activity,
      sparkline: sparklines.calls,
      tone: 'gray' as const,
    },
    {
      title: t('Success Rate'),
      value: totalCount > 0 ? `${successRate.toFixed(2)}%` : '--',
      description: t('Successful calls ratio in selected range'),
      icon: Gauge,
      sparkline: sparklines.successRate,
      sparklineVariant: 'line' as const,
      tone: 'rose' as const,
    },
  ]

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='divide-border/60 grid grid-cols-1 sm:grid-cols-2 sm:divide-x lg:grid-cols-4'>
        {cards.map((card) => (
          <div key={card.title} className='px-4 py-3.5 sm:px-5 sm:py-4'>
            <StatCard
              title={card.title}
              value={card.value}
              description={card.description}
              icon={card.icon}
              sparkline={card.sparkline}
              sparklineVariant={card.sparklineVariant}
              tone={card.tone}
              loading={loading}
              error={error}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
