package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// StatsFilter holds the multi-value filter conditions for the statistics endpoint.
type StatsFilter struct {
	UserIDs    []int
	TokenIDs   []int
	ChannelIDs []int
	ModelNames []string
	Groups     []string
	StartUnix  int64
	EndUnix    int64
}

// StatsBucket is one row of the time-series aggregation.
type StatsBucket struct {
	Bucket           string `json:"bucket"`
	BucketUnix       int64  `json:"bucket_unix"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalCount       int64  `json:"total_count"`
	SuccessCount     int64  `json:"success_count"`
	FailureCount     int64  `json:"failure_count"`
}

// DistributionRow is one row of the dimension breakdown (user/token/channel/model).
type DistributionRow struct {
	Label            string `json:"label"`
	Key              string `json:"key" gorm:"column:dim_key"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalCount       int64  `json:"total_count"`
	SuccessCount     int64  `json:"success_count"`
	FailureCount     int64  `json:"failure_count"`
}

// StatsTotals aggregates the sum across the entire selected range.
type StatsTotals struct {
	Quota            int64 `json:"quota"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalCount       int64 `json:"total_count"`
	SuccessCount     int64 `json:"success_count"`
	FailureCount     int64 `json:"failure_count"`
}

// StatisticsResult is the full payload returned by the statistics endpoint.
type StatisticsResult struct {
	Totals        StatsTotals                  `json:"totals"`
	TimeSeries    []StatsBucket                `json:"time_series"`
	Distributions map[string][]DistributionRow `json:"distributions"`
	Granularity   string                       `json:"granularity"`
}

// AutoGranularity picks a reasonable bucket size given the time range:
// <1 day => hour, <60 days => day, otherwise => week.
func AutoGranularity(start, end int64) string {
	if start <= 0 || end <= 0 || end <= start {
		return "day"
	}
	span := end - start
	switch {
	case span <= 24*3600:
		return "hour"
	case span <= 60*24*3600:
		return "day"
	default:
		return "week"
	}
}

func normalizeGranularity(g string, start, end int64) string {
	switch g {
	case "hour", "day", "week":
		return g
	default:
		return AutoGranularity(start, end)
	}
}

// applyStatsFilter applies the multi-value filters and time range to a gorm query.
// It restricts rows to consume + error log types.
func applyStatsFilter(tx *gorm.DB, f StatsFilter) *gorm.DB {
	tx = tx.Where("type IN ?", []int{LogTypeConsume, LogTypeError})
	if len(f.UserIDs) > 0 {
		tx = tx.Where("user_id IN ?", f.UserIDs)
	}
	if len(f.TokenIDs) > 0 {
		tx = tx.Where("token_id IN ?", f.TokenIDs)
	}
	if len(f.ChannelIDs) > 0 {
		tx = tx.Where("channel_id IN ?", f.ChannelIDs)
	}
	if len(f.ModelNames) > 0 {
		tx = tx.Where("model_name IN ?", f.ModelNames)
	}
	if len(f.Groups) > 0 {
		tx = tx.Where(logGroupCol+" IN ?", f.Groups)
	}
	if f.StartUnix > 0 {
		tx = tx.Where("created_at >= ?", f.StartUnix)
	}
	if f.EndUnix > 0 {
		tx = tx.Where("created_at <= ?", f.EndUnix)
	}
	return tx
}

// castToText renders a DB-specific cast of a column to a string type.
func castToText(col string) string {
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
		return col + "::text"
	case common.UsingMainDatabase(common.DatabaseTypeMySQL):
		return "CAST(" + col + " AS CHAR)"
	default: // SQLite
		return "CAST(" + col + " AS TEXT)"
	}
}

// bucketExpressions returns (bucketLabelExpr, bucketUnixExpr) for the given granularity.
// Week buckets are labeled with the date of their Monday.
func bucketExpressions(granularity string) (string, string, error) {
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
		switch granularity {
		case "hour":
			return `to_char(date_trunc('hour', to_timestamp(created_at)), 'YYYY-MM-DD HH24:00')`,
				`extract(epoch from date_trunc('hour', to_timestamp(created_at)))::bigint`, nil
		case "day":
			return `to_char(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD')`,
				`extract(epoch from date_trunc('day', to_timestamp(created_at)))::bigint`, nil
		case "week":
			return `to_char(date_trunc('week', to_timestamp(created_at)), 'YYYY-MM-DD')`,
				`extract(epoch from date_trunc('week', to_timestamp(created_at)))::bigint`, nil
		}
	case common.UsingMainDatabase(common.DatabaseTypeMySQL):
		switch granularity {
		case "hour":
			return `DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d %H:00')`,
				`UNIX_TIMESTAMP(DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d %H:00:00'))`, nil
		case "day":
			return `DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d')`,
				`UNIX_TIMESTAMP(DATE(FROM_UNIXTIME(created_at)))`, nil
		case "week":
			return `DATE_FORMAT(DATE(FROM_UNIXTIME(created_at)) - INTERVAL WEEKDAY(FROM_UNIXTIME(created_at)) DAY, '%Y-%m-%d')`,
				`UNIX_TIMESTAMP(DATE(FROM_UNIXTIME(created_at)) - INTERVAL WEEKDAY(FROM_UNIXTIME(created_at)) DAY)`, nil
		}
	default: // SQLite
		switch granularity {
		case "hour":
			return `strftime('%Y-%m-%d %H:00', datetime(created_at, 'unixepoch'))`,
				`CAST(strftime('%s', strftime('%Y-%m-%d %H:00:00', datetime(created_at, 'unixepoch'))) AS INTEGER)`, nil
		case "day":
			return `strftime('%Y-%m-%d', datetime(created_at, 'unixepoch'))`,
				`CAST(strftime('%s', date(created_at, 'unixepoch')) AS INTEGER)`, nil
		case "week":
			return `date(created_at, 'unixepoch', 'weekday 0', '-6 days')`,
				`CAST(strftime('%s', date(created_at, 'unixepoch', 'weekday 0', '-6 days')) AS INTEGER)`, nil
		}
	}
	return "", "", fmt.Errorf("unsupported granularity: %s", granularity)
}

const statsMetricsSelect = `
	COALESCE(SUM(quota), 0) AS quota,
	COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
	COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
	COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS success_count,
	COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) AS failure_count`

// GetStatisticsTimeSeries returns the per-bucket aggregation for the given filter and granularity.
func GetStatisticsTimeSeries(filter StatsFilter, granularity string) ([]StatsBucket, error) {
	g := normalizeGranularity(granularity, filter.StartUnix, filter.EndUnix)
	labelExpr, unixExpr, err := bucketExpressions(g)
	if err != nil {
		return nil, err
	}

	selectClause := fmt.Sprintf("%s AS bucket, %s AS bucket_unix,%s", labelExpr, unixExpr, statsMetricsSelect)
	tx := LOG_DB.Table("logs").Select(selectClause, LogTypeConsume, LogTypeError)
	tx = applyStatsFilter(tx, filter)
	tx = tx.Group(fmt.Sprintf("%s, %s", labelExpr, unixExpr)).Order("bucket_unix asc")

	var rows []StatsBucket
	if err := tx.Scan(&rows).Error; err != nil {
		common.SysError("failed to query statistics time series: " + err.Error())
		return nil, errors.New("查询时序统计失败")
	}
	for i := range rows {
		rows[i].TotalCount = rows[i].SuccessCount + rows[i].FailureCount
	}
	return rows, nil
}

// GetStatisticsTotals returns the single-row sum across the entire filtered range.
func GetStatisticsTotals(filter StatsFilter) (StatsTotals, error) {
	tx := LOG_DB.Table("logs").Select(statsMetricsSelect, LogTypeConsume, LogTypeError)
	tx = applyStatsFilter(tx, filter)

	var totals StatsTotals
	if err := tx.Scan(&totals).Error; err != nil {
		common.SysError("failed to query statistics totals: " + err.Error())
		return totals, errors.New("查询汇总统计失败")
	}
	totals.TotalCount = totals.SuccessCount + totals.FailureCount
	return totals, nil
}

// GetStatisticsDistribution groups by the requested dimension and returns top-N rows ordered by quota desc.
// Supported dimensions: user, token, channel, model.
func GetStatisticsDistribution(filter StatsFilter, dimension string, limit int) ([]DistributionRow, error) {
	if limit <= 0 {
		limit = 10
	}

	var labelExpr, keyExpr, groupExpr string
	switch dimension {
	case "user":
		labelExpr, keyExpr, groupExpr = "username", castToText("user_id"), "user_id, username"
	case "token":
		labelExpr, keyExpr, groupExpr = "token_name", castToText("token_id"), "token_id, token_name"
	case "channel":
		labelExpr, keyExpr, groupExpr = castToText("channel_id"), castToText("channel_id"), "channel_id"
	case "model":
		labelExpr, keyExpr, groupExpr = "model_name", "model_name", "model_name"
	default:
		return nil, fmt.Errorf("unsupported dimension: %s", dimension)
	}

	selectClause := fmt.Sprintf("%s AS label, %s AS dim_key,%s", labelExpr, keyExpr, statsMetricsSelect)
	tx := LOG_DB.Table("logs").Select(selectClause, LogTypeConsume, LogTypeError)
	tx = applyStatsFilter(tx, filter)
	tx = tx.Group(groupExpr).Order("quota desc").Limit(limit)

	var rows []DistributionRow
	if err := tx.Scan(&rows).Error; err != nil {
		common.SysError("failed to query statistics distribution: " + err.Error())
		return nil, errors.New("查询分布统计失败")
	}

	var channelNames map[string]string
	if dimension == "channel" {
		channelNames = getChannelNamesByIdStrings(rows)
	}
	for i := range rows {
		rows[i].TotalCount = rows[i].SuccessCount + rows[i].FailureCount
		if dimension == "channel" {
			if name, ok := channelNames[rows[i].Key]; ok && name != "" {
				rows[i].Label = name
			}
		}
		if rows[i].Label == "" {
			rows[i].Label = "N/A"
		}
	}
	return rows, nil
}

func getChannelNamesByIdStrings(rows []DistributionRow) map[string]string {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Key != "" {
			ids = append(ids, r.Key)
		}
	}
	result := make(map[string]string, len(ids))
	if len(ids) == 0 {
		return result
	}
	var channels []struct {
		Id   int
		Name string
	}
	if err := DB.Table("channels").Select("id, name").Where("id IN ?", ids).Find(&channels).Error; err != nil {
		common.SysError("failed to query channel names for statistics: " + err.Error())
		return result
	}
	for _, ch := range channels {
		result[fmt.Sprintf("%d", ch.Id)] = ch.Name
	}
	return result
}

// GetStatistics returns the full statistics payload: totals + time series + four dimension distributions.
func GetStatistics(filter StatsFilter, granularity string) (StatisticsResult, error) {
	result := StatisticsResult{
		Distributions: map[string][]DistributionRow{},
		Granularity:   normalizeGranularity(granularity, filter.StartUnix, filter.EndUnix),
	}

	totals, err := GetStatisticsTotals(filter)
	if err != nil {
		return result, err
	}
	result.Totals = totals

	series, err := GetStatisticsTimeSeries(filter, result.Granularity)
	if err != nil {
		return result, err
	}
	result.TimeSeries = series

	for _, dim := range []string{"user", "token", "channel", "model"} {
		rows, derr := GetStatisticsDistribution(filter, dim, 10)
		if derr != nil {
			common.SysError("failed to query distribution for " + dim + ": " + derr.Error())
			result.Distributions[dim] = []DistributionRow{}
			continue
		}
		result.Distributions[dim] = rows
	}

	return result, nil
}
