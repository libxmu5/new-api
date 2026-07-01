package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type DetailedLog struct {
	Log                `gorm:"embedded"`
	OriginalPrompt     string `json:"original_prompt" gorm:"type:text"`
	RequestPrompt      string `json:"request_prompt" gorm:"type:text"`
	ModelResponse      string `json:"model_response" gorm:"type:text"`
	OriginalPromptFile string `json:"original_prompt_file" gorm:"type:varchar(512);default:''"`
	RequestPromptFile  string `json:"request_prompt_file" gorm:"type:varchar(512);default:''"`
	ModelResponseFile  string `json:"model_response_file" gorm:"type:varchar(512);default:''"`
}

type DetailedLogMedia struct {
	Data   []byte
	Prefix string
}

type RecordDetailedLogParams struct {
	RecordConsumeLogParams
	OriginalPrompt         string
	RequestPrompt          string
	ModelResponse          string
	OriginalPromptMedia    *DetailedLogMedia
	RequestPromptMedia     *DetailedLogMedia
	ModelResponseMedia     *DetailedLogMedia
	OriginalPromptFilePath string
	RequestPromptFilePath  string
	ModelResponseFilePath  string
}

func truncateDetailedLogText(text string) string {
	if !common.DetailedLogTextEnabled || text == "" {
		return ""
	}
	maxLength := common.DetailedLogMaxTextLength
	if maxLength <= 0 || len(text) <= maxLength {
		return text
	}
	marker := "...(truncated)"
	if maxLength <= len(marker) {
		return text[:maxLength]
	}
	return text[:maxLength-len(marker)] + marker
}

func saveDetailedLogMedia(media *DetailedLogMedia) string {
	if !common.DetailedLogMediaEnabled || media == nil || len(media.Data) == 0 {
		return ""
	}
	baseDir := common.DetailedLogStoragePath
	if baseDir == "" {
		baseDir = os.TempDir()
	}
	dateDir := time.Now().Format("2006-01-02")
	fullDir := filepath.Join(baseDir, "detailed_logs", dateDir)
	if err := os.MkdirAll(fullDir, 0755); err != nil {
		common.SysError("failed to create detailed log media directory: " + err.Error())
		return ""
	}
	prefix := strings.TrimSpace(media.Prefix)
	if prefix == "" {
		prefix = "media"
	}
	fileName := fmt.Sprintf("%s-%s.bin", prefix, uuid.New().String())
	fullPath := filepath.Join(fullDir, fileName)
	if err := os.WriteFile(fullPath, media.Data, 0644); err != nil {
		common.SysError("failed to save detailed log media: " + err.Error())
		return ""
	}
	return fullPath
}

func RecordDetailedLog(c *gin.Context, userId int, params RecordDetailedLogParams) {
	if !common.DetailedLogEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record detailed log: userId=%d, params=%s", userId, common.GetJsonString(params.RecordConsumeLogParams)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	otherStr := common.MapToJsonStr(params.Other)
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		needRecordIp = settingMap.RecordIpLog
	}

	originalPromptFile := params.OriginalPromptFilePath
	if originalPromptFile == "" {
		originalPromptFile = saveDetailedLogMedia(params.OriginalPromptMedia)
	}
	requestPromptFile := params.RequestPromptFilePath
	if requestPromptFile == "" {
		requestPromptFile = saveDetailedLogMedia(params.RequestPromptMedia)
	}
	modelResponseFile := params.ModelResponseFilePath
	if modelResponseFile == "" {
		modelResponseFile = saveDetailedLogMedia(params.ModelResponseMedia)
	}

	log := &DetailedLog{
		Log: Log{
			UserId:           userId,
			Username:         username,
			CreatedAt:        common.GetTimestamp(),
			Type:             LogTypeConsume,
			Content:          params.Content,
			PromptTokens:     params.PromptTokens,
			CompletionTokens: params.CompletionTokens,
			TokenName:        params.TokenName,
			ModelName:        params.ModelName,
			Quota:            params.Quota,
			ChannelId:        params.ChannelId,
			TokenId:          params.TokenId,
			UseTime:          params.UseTimeSeconds,
			IsStream:         params.IsStream,
			Group:            params.Group,
			Ip: func() string {
				if needRecordIp {
					return c.ClientIP()
				}
				return ""
			}(),
			RequestId:         requestId,
			UpstreamRequestId: upstreamRequestId,
			Other:             otherStr,
		},
		OriginalPrompt:     truncateDetailedLogText(params.OriginalPrompt),
		RequestPrompt:      truncateDetailedLogText(params.RequestPrompt),
		ModelResponse:      truncateDetailedLogText(params.ModelResponse),
		OriginalPromptFile: originalPromptFile,
		RequestPromptFile:  requestPromptFile,
		ModelResponseFile:  modelResponseFile,
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		logger.LogError(c, "failed to record detailed log: "+err.Error())
	}
}
