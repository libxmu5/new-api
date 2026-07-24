package model

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const statsTestDay = int64(86400)

func seedTrendLog(t *testing.T, log *Log) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(log).Error)
}

func findTrendRow(rows []StatsTrendBucket, bucketUnix int64, key string) *StatsTrendBucket {
	for i := range rows {
		if rows[i].BucketUnix == bucketUnix && rows[i].Key == key {
			return &rows[i]
		}
	}
	return nil
}

func TestGetStatisticsTrendSeriesByUserTopNAndOthers(t *testing.T) {
	// Isolated time window: 2000-01-02 and 2000-01-03 (UTC day buckets).
	day1 := int64(946771200)
	day2 := day1 + statsTestDay
	filter := StatsFilter{StartUnix: day1, EndUnix: day2 + statsTestDay - 1}

	// 10 users; quotas descending so users 1..8 are top-8 by quota, 9-10 fold into Others.
	for i := 1; i <= 10; i++ {
		seedTrendLog(t, &Log{
			UserId: i, Username: fmt.Sprintf("user%d", i), Type: LogTypeConsume,
			CreatedAt: day1 + int64(i), Quota: (11 - i) * 100,
			PromptTokens: 10 * i, CompletionTokens: i,
		})
		seedTrendLog(t, &Log{
			UserId: i, Username: fmt.Sprintf("user%d", i), Type: LogTypeConsume,
			CreatedAt: day2 + int64(i), Quota: (11 - i) * 10,
		})
	}
	// One error log for user1 on day1.
	seedTrendLog(t, &Log{
		UserId: 1, Username: "user1", Type: LogTypeError, CreatedAt: day1 + 100,
	})

	rows, err := GetStatisticsTrendSeries(filter, "day", "user")
	require.NoError(t, err)
	require.NotEmpty(t, rows)

	keys := make(map[string]bool)
	for i, row := range rows {
		assert.Equal(t, "user", row.Dimension)
		keys[row.Key] = true
		if i > 0 {
			assert.GreaterOrEqual(t, row.BucketUnix, rows[i-1].BucketUnix, "rows must be ordered by bucket")
		}
	}
	// 8 top users + Others per bucket.
	assert.Len(t, keys, 9)
	assert.False(t, keys["9"], "user 9 must be folded into Others")
	assert.False(t, keys["10"], "user 10 must be folded into Others")

	user1Day1 := findTrendRow(rows, day1, "1")
	require.NotNil(t, user1Day1)
	assert.Equal(t, "user1", user1Day1.Label)
	assert.Equal(t, int64(1000), user1Day1.Quota)
	assert.Equal(t, int64(10), user1Day1.PromptTokens)
	assert.Equal(t, int64(1), user1Day1.CompletionTokens)
	assert.Equal(t, int64(1), user1Day1.SuccessCount)
	assert.Equal(t, int64(1), user1Day1.FailureCount)
	assert.Equal(t, int64(2), user1Day1.TotalCount)

	othersDay1 := findTrendRow(rows, day1, TrendOthersKey)
	require.NotNil(t, othersDay1)
	assert.Equal(t, "Others", othersDay1.Label)
	assert.Equal(t, int64(300), othersDay1.Quota)
	assert.Equal(t, int64(190), othersDay1.PromptTokens)
	assert.Equal(t, int64(2), othersDay1.SuccessCount)
	assert.Equal(t, int64(0), othersDay1.FailureCount)
	assert.Equal(t, int64(2), othersDay1.TotalCount)

	othersDay2 := findTrendRow(rows, day2, TrendOthersKey)
	require.NotNil(t, othersDay2)
	assert.Equal(t, int64(30), othersDay2.Quota)
}

func TestGetStatisticsTrendSeriesUnknownDimensionFallsBackToTotal(t *testing.T) {
	// Isolated time window: 2000-02-01 and 2000-02-02.
	day1 := int64(949363200)
	day2 := day1 + statsTestDay
	filter := StatsFilter{StartUnix: day1, EndUnix: day2 + statsTestDay - 1}

	seedTrendLog(t, &Log{UserId: 1, Username: "user1", Type: LogTypeConsume, CreatedAt: day1 + 1, Quota: 100})
	seedTrendLog(t, &Log{UserId: 2, Username: "user2", Type: LogTypeConsume, CreatedAt: day1 + 2, Quota: 200})
	seedTrendLog(t, &Log{UserId: 1, Username: "user1", Type: LogTypeConsume, CreatedAt: day2 + 1, Quota: 50})

	rows, err := GetStatisticsTrendSeries(filter, "day", "bogus")
	require.NoError(t, err)
	require.Len(t, rows, 2)
	for _, row := range rows {
		assert.Equal(t, "total", row.Dimension)
		assert.Equal(t, "total", row.Key)
		assert.Equal(t, "Total", row.Label)
	}
	assert.Equal(t, int64(300), rows[0].Quota)
	assert.Equal(t, int64(50), rows[1].Quota)

	timeSeries, err := GetStatisticsTimeSeries(filter, "day")
	require.NoError(t, err)
	require.Len(t, timeSeries, 2)
	assert.Equal(t, timeSeries[0].Quota, rows[0].Quota)
	assert.Equal(t, timeSeries[1].Quota, rows[1].Quota)
}

func TestGetStatisticsTrendSeriesByChannelResolvesNames(t *testing.T) {
	// Isolated time window: 2000-03-01.
	day1 := int64(951868800)
	filter := StatsFilter{StartUnix: day1, EndUnix: day1 + statsTestDay - 1}

	require.NoError(t, DB.Create(&Channel{Id: 9001, Name: "trend-channel-a", Key: "k1"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 9002, Name: "trend-channel-b", Key: "k2"}).Error)
	seedTrendLog(t, &Log{UserId: 1, Username: "user1", ChannelId: 9001, Type: LogTypeConsume, CreatedAt: day1 + 1, Quota: 100})
	seedTrendLog(t, &Log{UserId: 1, Username: "user1", ChannelId: 9002, Type: LogTypeConsume, CreatedAt: day1 + 2, Quota: 200})

	rows, err := GetStatisticsTrendSeries(filter, "day", "channel")
	require.NoError(t, err)
	require.Len(t, rows, 2)

	labels := map[string]string{}
	for _, row := range rows {
		labels[row.Key] = row.Label
	}
	assert.Equal(t, "trend-channel-a", labels["9001"])
	assert.Equal(t, "trend-channel-b", labels["9002"])
}

func TestGetStatisticsIncludesTrendSeries(t *testing.T) {
	// Isolated time window: 2000-04-01.
	day1 := int64(954547200)
	filter := StatsFilter{StartUnix: day1, EndUnix: day1 + statsTestDay - 1}

	seedTrendLog(t, &Log{UserId: 1, Username: "user1", ModelName: "gpt-x", Type: LogTypeConsume, CreatedAt: day1 + 1, Quota: 100})
	seedTrendLog(t, &Log{UserId: 2, Username: "user2", ModelName: "gpt-y", Type: LogTypeConsume, CreatedAt: day1 + 2, Quota: 200})

	result, err := GetStatistics(filter, "day", "model")
	require.NoError(t, err)
	assert.Equal(t, "model", result.TrendDimension)
	require.Len(t, result.TrendSeries, 2)
	labels := map[string]int64{}
	for _, row := range result.TrendSeries {
		labels[row.Label] = row.Quota
	}
	assert.Equal(t, int64(100), labels["gpt-x"])
	assert.Equal(t, int64(200), labels["gpt-y"])
}
