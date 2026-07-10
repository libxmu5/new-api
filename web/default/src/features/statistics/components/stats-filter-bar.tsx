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
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserModels } from '@/lib/api'
import { getRollingDateRange } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { MultiSelect, type Option } from '@/components/multi-select'
import { searchChannels } from '@/features/channels/api'
import { getApiKeys } from '@/features/keys/api'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { searchUsers } from '@/features/users/api'
import { TIME_RANGE_PRESETS } from '@/features/dashboard/constants'
import type { StatisticsFilters } from '../types'

export function buildDefaultStatisticsFilters(): StatisticsFilters {
  const { start, end } = getRollingDateRange(7)
  return {
    userIds: [],
    tokenIds: [],
    channelIds: [],
    models: [],
    start,
    end,
  }
}

interface StatsFilterBarProps {
  isAdmin: boolean
  extraTokenOptions?: Option[]
  onApply: (filters: StatisticsFilters) => void
}

export function StatsFilterBar({
  isAdmin,
  extraTokenOptions,
  onApply,
}: StatsFilterBarProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<StatisticsFilters>(() =>
    buildDefaultStatisticsFilters()
  )
  const [selectedRange, setSelectedRange] = useState<number | null>(7)

  const usersQuery = useQuery({
    queryKey: ['statistics-user-options'],
    queryFn: () => searchUsers({ keyword: '', p: 1, page_size: 100 }),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  })

  const tokensQuery = useQuery({
    queryKey: ['statistics-token-options'],
    queryFn: () => getApiKeys({ p: 1, size: 100 }),
    staleTime: 5 * 60 * 1000,
  })

  const channelsQuery = useQuery({
    queryKey: ['statistics-channel-options'],
    queryFn: () => searchChannels({ keyword: '', p: 1, page_size: 100 }),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  })

  const modelsQuery = useQuery({
    queryKey: ['statistics-model-options'],
    queryFn: getUserModels,
    staleTime: 5 * 60 * 1000,
  })

  const userOptions = useMemo<Option[]>(
    () =>
      (usersQuery.data?.data?.items ?? []).map((user) => ({
        label: user.display_name
          ? `${user.username} (${user.display_name})`
          : user.username,
        value: String(user.id),
      })),
    [usersQuery.data]
  )

  const tokenOptions = useMemo<Option[]>(() => {
    const own = (tokensQuery.data?.data?.items ?? []).map((token) => ({
      label: token.name || `#${token.id}`,
      value: String(token.id),
    }))
    const merged = new Map<string, Option>()
    for (const option of [...own, ...(extraTokenOptions ?? [])]) {
      if (!merged.has(option.value)) merged.set(option.value, option)
    }
    return Array.from(merged.values())
  }, [tokensQuery.data, extraTokenOptions])

  const channelOptions = useMemo<Option[]>(
    () =>
      (channelsQuery.data?.data?.items ?? []).map((channel) => ({
        label: `${channel.name} (#${channel.id})`,
        value: String(channel.id),
      })),
    [channelsQuery.data]
  )

  const modelOptions = useMemo<Option[]>(
    () =>
      (modelsQuery.data?.data ?? []).map((model) => ({
        label: model,
        value: model,
      })),
    [modelsQuery.data]
  )

  const handleQuickRange = (days: number) => {
    const { start, end } = getRollingDateRange(days)
    setSelectedRange(days)
    const next = { ...draft, start, end }
    setDraft(next)
    onApply(next)
  }

  const handleRangeChange = (range: { start?: Date; end?: Date }) => {
    setSelectedRange(null)
    setDraft((prev) => ({ ...prev, start: range.start, end: range.end }))
  }

  const handleReset = () => {
    const next = buildDefaultStatisticsFilters()
    setDraft(next)
    setSelectedRange(7)
    onApply(next)
  }

  return (
    <Card>
      <CardContent className='space-y-3 p-4'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {isAdmin && (
            <div className='space-y-1.5'>
              <Label className='text-muted-foreground text-xs'>
                {t('User')}
              </Label>
              <MultiSelect
                options={userOptions}
                selected={draft.userIds}
                onChange={(values) =>
                  setDraft((prev) => ({ ...prev, userIds: values }))
                }
                placeholder={t('All users')}
                maxVisibleChips={2}
              />
            </div>
          )}
          <div className='space-y-1.5'>
            <Label className='text-muted-foreground text-xs'>
              {t('API Key')}
            </Label>
            <MultiSelect
              options={tokenOptions}
              selected={draft.tokenIds}
              onChange={(values) =>
                setDraft((prev) => ({ ...prev, tokenIds: values }))
              }
              placeholder={t('All keys')}
              maxVisibleChips={2}
            />
          </div>
          {isAdmin && (
            <div className='space-y-1.5'>
              <Label className='text-muted-foreground text-xs'>
                {t('Channel')}
              </Label>
              <MultiSelect
                options={channelOptions}
                selected={draft.channelIds}
                onChange={(values) =>
                  setDraft((prev) => ({ ...prev, channelIds: values }))
                }
                placeholder={t('All channels')}
                maxVisibleChips={2}
              />
            </div>
          )}
          <div className='space-y-1.5'>
            <Label className='text-muted-foreground text-xs'>
              {t('Model')}
            </Label>
            <MultiSelect
              options={modelOptions}
              selected={draft.models}
              onChange={(values) =>
                setDraft((prev) => ({ ...prev, models: values }))
              }
              placeholder={t('All models')}
              maxVisibleChips={2}
            />
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <CompactDateTimeRangePicker
            start={draft.start}
            end={draft.end}
            onChange={handleRangeChange}
          />
          <div className='flex items-center gap-1'>
            {TIME_RANGE_PRESETS.map((range) => (
              <Button
                key={range.days}
                type='button'
                size='sm'
                variant={selectedRange === range.days ? 'default' : 'outline'}
                className={cn('h-8 px-2.5 text-xs')}
                onClick={() => handleQuickRange(range.days)}
              >
                {t(range.label)}
              </Button>
            ))}
          </div>
          <div className='ml-auto flex items-center gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={handleReset}
            >
              <RotateCcw className='size-3.5' />
              {t('Reset')}
            </Button>
            <Button type='button' size='sm' onClick={() => onApply(draft)}>
              <Search className='size-3.5' />
              {t('Query')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
