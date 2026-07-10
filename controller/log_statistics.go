package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// parseIDsFromQuery parses repeated and/or comma-separated int IDs from the query string.
func parseIDsFromQuery(c *gin.Context, key string) []int {
	values := c.QueryArray(key)
	seen := make(map[int]bool, len(values)*2)
	out := make([]int, 0, len(values)*2)
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			id, err := strconv.Atoi(part)
			if err != nil || id <= 0 {
				continue
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// parseStringsFromQuery parses repeated and/or comma-separated string values, de-duplicating them.
func parseStringsFromQuery(c *gin.Context, key string) []string {
	values := c.QueryArray(key)
	seen := make(map[string]bool, len(values)*2)
	out := make([]string, 0, len(values)*2)
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "" || seen[part] {
				continue
			}
			seen[part] = true
			out = append(out, part)
		}
	}
	return out
}

func parseStatsFilter(c *gin.Context) model.StatsFilter {
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return model.StatsFilter{
		UserIDs:    parseIDsFromQuery(c, "user_ids"),
		TokenIDs:   parseIDsFromQuery(c, "token_ids"),
		ChannelIDs: parseIDsFromQuery(c, "channel_ids"),
		ModelNames: parseStringsFromQuery(c, "model_names"),
		Groups:     parseStringsFromQuery(c, "groups"),
		StartUnix:  start,
		EndUnix:    end,
	}
}

// GetLogStatistics returns aggregated statistics for administrators.
func GetLogStatistics(c *gin.Context) {
	filter := parseStatsFilter(c)
	granularity := c.DefaultQuery("granularity", "")
	result, err := model.GetStatistics(filter, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// GetLogSelfStatistics returns aggregated statistics scoped to the calling user.
func GetLogSelfStatistics(c *gin.Context) {
	userId := c.GetInt("id")
	filter := parseStatsFilter(c)
	if userId > 0 {
		filter.UserIDs = []int{userId}
	} else {
		filter.UserIDs = []int{-1}
	}
	granularity := c.DefaultQuery("granularity", "")
	result, err := model.GetStatistics(filter, granularity)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Regular users must not see channel information (consistent with log views).
	delete(result.Distributions, "channel")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}
