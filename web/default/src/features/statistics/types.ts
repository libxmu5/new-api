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

export type StatsGranularity = 'hour' | 'day' | 'week'

export type StatsMetric = 'cost' | 'tokens' | 'calls'

export type StatsDimension = 'user' | 'token' | 'channel' | 'model'

export type StatsTrendDimension = 'total' | StatsDimension

export interface StatsTotals {
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_count: number
  success_count: number
  failure_count: number
}

export interface StatsBucket {
  bucket: string
  bucket_unix: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_count: number
  success_count: number
  failure_count: number
}

export interface StatsTrendBucket extends StatsBucket {
  dimension: string
  key: string
  label: string
}

export interface DistributionRow {
  label: string
  key: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_count: number
  success_count: number
  failure_count: number
}

export interface StatisticsData {
  totals: StatsTotals
  time_series: StatsBucket[]
  trend_series: StatsTrendBucket[]
  trend_dimension: StatsTrendDimension
  distributions: Partial<Record<StatsDimension, DistributionRow[]>>
  granularity: StatsGranularity
}

export interface StatisticsResponse {
  success: boolean
  message?: string
  data?: StatisticsData
}

export interface StatisticsFilters {
  userIds: string[]
  tokenIds: string[]
  channelIds: string[]
  models: string[]
  start?: Date
  end?: Date
}
