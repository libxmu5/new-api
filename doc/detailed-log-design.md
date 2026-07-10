# 详细日志功能代码设计说明

## 1. 功能目标

详细日志功能用于在不改变原有消费日志逻辑的前提下，额外记录一次请求转发过程中的关键内容，便于后续排查、审计和复盘。

该功能新增独立表 `detailed_logs`，保留原 `logs` 表和 `RecordConsumeLog` 写入流程不变。详细日志与消费日志共享同一组基础字段，并额外保存：

- 原始提示词：客户端提交的原始请求体。
- 请求提示词：转换、覆盖参数、清理字段后实际发往上游的请求体。
- 模型返回：上游模型返回内容。
- 多媒体文件路径：当启用多媒体保存时，原始请求、上游请求或模型返回中的二进制内容保存到本地文件，数据库只保存路径。

## 2. 配置开关设计

配置定义在 [common/constants.go](../common/constants.go#L115-L120)，初始化在 [common/init.go](../common/init.go#L81-L88)。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DETAILED_LOG_ENABLED` | `false` | 总开关，关闭时不记录详细日志 |
| `DETAILED_LOG_TEXT_ENABLED` | `false` | 文本开关，控制文本内容是否写入数据库 |
| `DETAILED_LOG_MEDIA_ENABLED` | `false` | 多媒体开关，控制二进制内容是否保存为本地文件 |
| `DETAILED_LOG_MAX_TEXT_LENGTH` | `65535` | 文本入库最大长度，超出后截断 |
| `DETAILED_LOG_STORAGE_PATH` | 空字符串 | 多媒体文件保存根目录，空值时使用系统临时目录 |

设计原则：

1. 默认关闭，避免无意保存敏感请求或响应内容。
2. 文本与多媒体分别控制，便于按数据敏感度独立启用。
3. 长文本截断，避免数据库单行过大。
4. 多媒体不直接入库，避免数据库膨胀。

## 3. 数据模型设计

新增模型位于 [model/detailed_log.go](../model/detailed_log.go)。

### 3.1 DetailedLog

`DetailedLog` 通过嵌入 `Log` 复用现有消费日志字段：

```go
Log `gorm:"embedded"`
```

因此 `detailed_logs` 表会包含原 `logs` 表的主要字段，例如：

- `user_id`
- `created_at`
- `type`
- `content`
- `username`
- `token_name`
- `model_name`
- `quota`
- `prompt_tokens`
- `completion_tokens`
- `use_time`
- `is_stream`
- `channel_id`
- `token_id`
- `group`
- `ip`
- `request_id`
- `upstream_request_id`
- `other`

并新增以下字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `original_prompt` | `text` | 客户端原始请求体文本 |
| `request_prompt` | `text` | 发往上游的请求体文本 |
| `model_response` | `text` | 模型响应文本 |
| `original_prompt_file` | `varchar(512)` | 原始请求多媒体文件路径 |
| `request_prompt_file` | `varchar(512)` | 上游请求多媒体文件路径 |
| `model_response_file` | `varchar(512)` | 模型响应多媒体文件路径 |

### 3.2 RecordDetailedLogParams

`RecordDetailedLogParams` 嵌入 `RecordConsumeLogParams`，复用原消费日志的参数结构，并追加详细内容字段。

这种设计保证：

- 原消费日志字段只有一份来源，避免字段组装逻辑分叉。
- 详细日志写入可以紧跟消费日志写入，保持两者业务语义一致。
- 后续扩展详细字段时，不需要修改原 `RecordConsumeLog`。

## 4. 写入逻辑设计

详细日志入口为 [model/detailed_log.go:87](../model/detailed_log.go#L87)：

```go
func RecordDetailedLog(c *gin.Context, userId int, params RecordDetailedLogParams)
```

处理流程：

1. 检查 `DetailedLogEnabled`，未启用直接返回。
2. 从 Gin 上下文读取：
   - `username`
   - `request_id`
   - `upstream_request_id`
3. 复用用户设置判断是否记录 IP。
4. 根据多媒体开关保存媒体内容到本地文件。
5. 根据文本开关和最大长度截断文本字段。
6. 组装 `DetailedLog` 并写入 `LOG_DB`。

### 4.1 文本截断

文本截断逻辑位于 [model/detailed_log.go:45](../model/detailed_log.go#L45)。

规则：

- `DETAILED_LOG_TEXT_ENABLED=false` 时返回空字符串，不写入文本。
- `DETAILED_LOG_MAX_TEXT_LENGTH<=0` 时不截断。
- 超长时保留前缀并追加 `...(truncated)` 标记。

### 4.2 多媒体保存

多媒体保存逻辑位于 [model/detailed_log.go:60](../model/detailed_log.go#L60)。

路径格式：

```text
{DETAILED_LOG_STORAGE_PATH 或 os.TempDir()}/detailed_logs/YYYY-MM-DD/{prefix}-{uuid}.bin
```

失败处理：

- 创建目录失败或写文件失败时只记录系统错误日志。
- 不阻断主请求流程。
- 不阻断详细日志其他字段写入。

## 5. 数据采集点设计

详细日志字段由转发链路不同阶段填充到 `RelayInfo`，最后在结算阶段统一写入。

### 5.1 中转字段

中转字段定义在 [relay/common/relay_info.go:164](../relay/common/relay_info.go#L164-L175)：

- `OriginalPrompt`
- `RequestPrompt`
- `ModelResponse`
- `OriginalPromptFile`
- `RequestPromptFile`
- `ModelResponseFile`
- `OriginalPromptMedia`
- `RequestPromptMedia`
- `ModelResponseMedia`
- `OriginalPromptMediaTag`
- `RequestPromptMediaTag`
- `ModelResponseMediaTag`

`RelayInfo` 是一次请求在转发链路中的上下文载体，因此适合承载这些临时采集结果。

### 5.2 原始请求采集

原始请求采集位于 [controller/relay.go:120](../controller/relay.go#L120-L138)。

采集时机：

1. `helper.GetAndValidateRequest` 已完成请求解析。
2. `relaycommon.GenRelayInfo` 已创建 `RelayInfo`。
3. 从 `common.GetBodyStorage(c)` 读取原始 BodyStorage。
4. 读取后调用 `Seek(0, io.SeekStart)` 重置读取位置，避免影响后续转发。

采集结果：

- 文本开关启用时写入 `relayInfo.OriginalPrompt`。
- 多媒体开关启用时写入 `relayInfo.OriginalPromptMedia`。

### 5.3 上游请求采集

上游请求采集分为两种情况。

#### 5.3.1 透传请求

当全局或渠道开启透传时，请求体直接从 `BodyStorage` 发送到上游。此时采集点在：

- OpenAI 兼容文本：[relay/compatible_handler.go:97](../relay/compatible_handler.go#L97-L118)
- Claude：[relay/claude_handler.go:149](../relay/claude_handler.go#L149-L166)
- Gemini：[relay/gemini_handler.go:139](../relay/gemini_handler.go#L139-L156)
- Image：[relay/image_handler.go:49](../relay/image_handler.go#L49-L66)

采集内容是透传给上游的原始请求字节。

#### 5.3.2 转换请求

非透传路径会先调用适配器转换请求，再执行字段清理和参数覆盖，最后 marshal 为 JSON。此时采集点在：

- OpenAI 兼容文本：[relay/compatible_handler.go:168](../relay/compatible_handler.go#L168-L199)
- Claude：[relay/claude_handler.go:156](../relay/claude_handler.go#L156-L204)
- Gemini：[relay/gemini_handler.go:147](../relay/gemini_handler.go#L147-L189)
- Image：[relay/image_handler.go:56](../relay/image_handler.go#L56-L103)

采集内容是最终要发往上游的 JSON 字节，而不是用户原始请求。

### 5.4 模型响应采集

响应采集在各渠道 `DoResponse` 处理阶段完成。

| 渠道 | 非流式采集 | 流式采集 |
| --- | --- | --- |
| OpenAI | [relay/channel/openai/relay-openai.go:195](../relay/channel/openai/relay-openai.go#L195-L206) | [relay/channel/openai/relay-openai.go:180](../relay/channel/openai/relay-openai.go#L180-L190) |
| Claude | [relay/channel/claude/relay-claude.go:945](../relay/channel/claude/relay-claude.go#L945-L958) | [relay/channel/claude/relay-claude.go:906](../relay/channel/claude/relay-claude.go#L906-L929) |
| Gemini | [relay/channel/gemini/relay-gemini.go:1504](../relay/channel/gemini/relay-gemini.go#L1504-L1518) | [relay/channel/gemini/relay-gemini.go:1389](../relay/channel/gemini/relay-gemini.go#L1389-L1400) |
| Gemini Native | [relay/channel/gemini/relay-gemini-native.go:20](../relay/channel/gemini/relay-gemini-native.go#L20-L35) | 复用 Gemini stream handler |
| OpenAI TTS/STT | [relay/channel/openai/audio.go:60](../relay/channel/openai/audio.go#L60-L72)、[relay/channel/openai/audio.go:120](../relay/channel/openai/audio.go#L120-L131) | TTS 流式当前仅透传，不采集完整二进制流 |

流式响应不会保存完整 SSE 原始帧，而是保存已累积的模型文本输出，例如 OpenAI 的 `responseTextBuilder`、Claude 的 `claudeInfo.ResponseText`、Gemini 的 `responseText`。

## 6. 结算阶段写入

详细日志写入发生在消费日志写入之后。

### 6.1 文本结算

位置：[service/text_quota.go:462](../service/text_quota.go#L462-L499)。

流程：

1. 先组装 `logParams`。
2. 调用 `model.RecordConsumeLog` 写原消费日志。
3. 若 `DetailedLogEnabled=true`，用同一份 `logParams` 调用 `model.RecordDetailedLog`。

### 6.2 音频结算

位置：[service/quota.go:363](../service/quota.go#L363-L400)。

流程与文本结算一致，只是 token、倍率、日志内容来自音频结算逻辑。

## 7. 数据一致性与边界行为

### 7.1 不影响原日志

原 `RecordConsumeLog` 未被修改。详细日志写入是在原消费日志写入之后追加调用，因此即使详细日志写入失败，也不会影响原消费日志。

### 7.2 不影响请求转发

采集请求体后会重置 BodyStorage 读取位置。响应采集使用已经读出的响应体或已有的流式文本累积器，不额外改变响应输出路径。

### 7.3 失败隔离

详细日志相关失败包括：

- 多媒体目录创建失败
- 多媒体文件写入失败
- 详细日志数据库写入失败

这些失败只记录错误，不向客户端返回错误，也不影响扣费、响应或原日志。

### 7.4 数据安全

该功能会保存请求与响应内容，默认关闭。建议仅在调试、审计或受控环境中启用，并结合：

- 最小化保存时长
- 限制 `DETAILED_LOG_STORAGE_PATH` 目录权限
- 控制数据库访问权限
- 使用 `DETAILED_LOG_MAX_TEXT_LENGTH` 限制保存体积

## 8. 当前测试结果

已执行并通过：

```bash
go test ./model ./service ./relay ./relay/channel/openai ./relay/channel/claude ./relay/channel/gemini
```

同时修复了 Claude 文件内容转换测试，确保：

- 不支持的文件附件会被忽略。
- PDF 文件会转换为 Claude `document` 内容。
- 文本文件会解码为 Claude `text` 内容。
