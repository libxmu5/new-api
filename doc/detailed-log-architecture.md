# 详细日志功能架构说明

## 1. 总体架构

详细日志功能以“旁路采集、结算写入、独立存储”为核心架构。

它不替换原有日志系统，而是在现有转发链路上增加一条旁路数据流：

```text
客户端请求
   │
   ▼
controller.Relay
   │ 采集 OriginalPrompt
   ▼
relay helper / adaptor
   │ 采集 RequestPrompt
   ▼
上游模型服务
   │
   ▼
channel response handler
   │ 采集 ModelResponse / ModelResponseMedia
   ▼
service.PostTextConsumeQuota / PostAudioConsumeQuota
   │
   ├─ 写入原 logs 表
   │
   └─ 写入 detailed_logs 表
```

该架构的关键点是：

- 采集发生在请求转发链路中。
- 写入发生在计费结算阶段。
- 存储使用独立 `detailed_logs` 表。
- 原 `logs` 表和原消费日志逻辑保持不变。

## 2. 分层职责

### 2.1 common 层

涉及文件：

- [common/constants.go](../common/constants.go#L115-L120)
- [common/init.go](../common/init.go#L81-L88)

职责：

- 定义详细日志功能开关。
- 从环境变量初始化配置。
- 提供全局开关给 controller、relay、service、model 层判断。

该层不参与具体采集和写入，只提供配置状态。

### 2.2 controller 层

涉及文件：

- [controller/relay.go](../controller/relay.go#L120-L138)

职责：

- 创建 `RelayInfo` 后，从 `BodyStorage` 读取客户端原始请求体。
- 将原始请求体保存到 `RelayInfo.OriginalPrompt` 或 `RelayInfo.OriginalPromptMedia`。
- 重置 BodyStorage 读取位置，保证后续逻辑仍可读取请求体。

该阶段采集的是“用户真正发来的内容”。

### 2.3 relay 层

涉及文件：

- [relay/common/relay_info.go](../relay/common/relay_info.go#L164-L175)
- [relay/compatible_handler.go](../relay/compatible_handler.go#L97-L199)
- [relay/claude_handler.go](../relay/claude_handler.go#L149-L204)
- [relay/gemini_handler.go](../relay/gemini_handler.go#L139-L189)
- [relay/image_handler.go](../relay/image_handler.go#L49-L103)

职责：

- 使用 `RelayInfo` 作为一次请求内的详细日志上下文。
- 在透传路径采集透传 BodyStorage。
- 在转换路径采集转换后、参数覆盖后的上游请求 JSON。
- 将采集内容暂存在 `RelayInfo.RequestPrompt` 或 `RelayInfo.RequestPromptMedia`。

该阶段采集的是“实际发给上游的内容”。

### 2.4 channel adapter 层

涉及文件：

- [relay/channel/openai/relay-openai.go](../relay/channel/openai/relay-openai.go)
- [relay/channel/openai/audio.go](../relay/channel/openai/audio.go)
- [relay/channel/claude/relay-claude.go](../relay/channel/claude/relay-claude.go)
- [relay/channel/gemini/relay-gemini.go](../relay/channel/gemini/relay-gemini.go)
- [relay/channel/gemini/relay-gemini-native.go](../relay/channel/gemini/relay-gemini-native.go)

职责：

- 在响应解析阶段采集模型返回。
- 非流式请求保存完整响应体文本。
- 流式请求保存已累积的模型文本输出。
- 音频 TTS 响应保存二进制响应内容到 `RelayInfo.ModelResponseMedia`。

该阶段采集的是“上游模型返回的内容”。

### 2.5 service 层

涉及文件：

- [service/text_quota.go](../service/text_quota.go#L462-L499)
- [service/quota.go](../service/quota.go#L363-L400)

职责：

- 完成原有消费结算逻辑。
- 先调用 `RecordConsumeLog` 写原消费日志。
- 再根据总开关调用 `RecordDetailedLog` 写详细日志。
- 使用同一份 `RecordConsumeLogParams` 保证基础日志字段一致。

service 层是详细日志的“统一落库入口”。

### 2.6 model 层

涉及文件：

- [model/detailed_log.go](../model/detailed_log.go)
- [model/main.go](../model/main.go#L258-L377)

职责：

- 定义 `DetailedLog` 表模型。
- 执行 `detailed_logs` 表迁移。
- 控制文本截断。
- 保存多媒体文件并返回路径。
- 写入 `LOG_DB`。

model 层负责持久化，不理解请求转发细节。

## 3. 数据流架构

### 3.1 OriginalPrompt 数据流

```text
HTTP Body
   │
   ▼
common.BodyStorage
   │
   ▼
controller.Relay
   │
   ▼
RelayInfo.OriginalPrompt / OriginalPromptMedia
   │
   ▼
service.PostTextConsumeQuota / PostAudioConsumeQuota
   │
   ▼
model.RecordDetailedLog
   │
   ▼
detailed_logs.original_prompt / original_prompt_file
```

特点：

- 采集最早发生在 controller 层。
- 代表客户端提交的原始请求。
- 不包含渠道转换、系统提示词插入、参数覆盖后的变化。

### 3.2 RequestPrompt 数据流

```text
Relay helper
   │
   ├─ pass-through：BodyStorage
   │
   └─ convert：convertedRequest -> Marshal -> RemoveDisabledFields -> ApplyParamOverride
   │
   ▼
RelayInfo.RequestPrompt / RequestPromptMedia
   │
   ▼
model.RecordDetailedLog
   │
   ▼
detailed_logs.request_prompt / request_prompt_file
```

特点：

- 代表真实上游请求。
- 能体现模型映射、渠道格式转换、系统提示词、参数覆盖等结果。
- 比 `OriginalPrompt` 更适合排查上游返回异常。

### 3.3 ModelResponse 数据流

```text
Upstream HTTP Response
   │
   ├─ non-stream：io.ReadAll(resp.Body)
   │
   ├─ stream：response text builder
   │
   └─ media：binary body bytes
   │
   ▼
RelayInfo.ModelResponse / ModelResponseMedia
   │
   ▼
model.RecordDetailedLog
   │
   ▼
detailed_logs.model_response / model_response_file
```

特点：

- 非流式保存完整响应文本。
- 流式保存模型文本内容，不保存所有 SSE 原始帧。
- 二进制响应通过文件保存路径关联。

## 4. 表结构架构

### 4.1 logs 与 detailed_logs 的关系

```text
logs
 ├─ 原消费日志表
 ├─ 由 RecordConsumeLog 写入
 └─ 保持原有逻辑不变

 detailed_logs
 ├─ 新增详细日志表
 ├─ 由 RecordDetailedLog 写入
 ├─ 包含 logs 的基础字段
 └─ 额外包含 prompt/response/file 字段
```

`detailed_logs` 不是 `logs` 的外键扩展表，而是一张独立冗余表。这样设计的好处是：

- 查询详细日志时不需要 join。
- 原有日志系统无需迁移数据。
- 原有日志写入失败/成功语义不受影响。
- 可以单独控制详细日志的保留策略和访问权限。

### 4.2 迁移策略

迁移位置：[model/main.go](../model/main.go#L258-L377)。

- 主库迁移：`migrateDB()` 和 `migrateDBFast()` 均包含 `DetailedLog`。
- 独立日志库迁移：`migrateLOGDB()` 先迁移 `Log`，再迁移 `DetailedLog`。

当前实现依赖 GORM `AutoMigrate`，适配 SQLite、MySQL、PostgreSQL。

## 5. 开关控制架构

```text
DETAILED_LOG_ENABLED=false
   └─ 不采集、不写入

DETAILED_LOG_ENABLED=true
   ├─ DETAILED_LOG_TEXT_ENABLED=true
   │    └─ 保存文本字段到数据库
   │
   └─ DETAILED_LOG_MEDIA_ENABLED=true
        └─ 保存二进制内容到本地文件，并在数据库保存路径
```

开关在多个层级生效：

- controller/relay/channel 层根据开关决定是否采集。
- model 层根据开关决定是否写文本、是否保存文件。
- service 层根据总开关决定是否调用详细日志写入。

这种多层判断避免在未启用功能时产生不必要的字符串拷贝、文件写入和数据库写入。

## 6. 与原请求转发架构的关系

原转发链路：

```text
router -> middleware -> controller -> relay helper -> adaptor -> upstream -> response handler -> quota/log
```

详细日志只在以下点插入旁路逻辑：

1. `controller`：读取 BodyStorage，采集原始请求。
2. `relay helper`：在发起上游请求前采集上游请求体。
3. `channel response handler`：在响应处理时采集模型返回。
4. `quota service`：消费日志写入后追加详细日志写入。
5. `model`：独立表持久化。

没有改变：

- 路由规则。
- 渠道选择逻辑。
- 适配器接口。
- 扣费逻辑。
- 原消费日志逻辑。
- 客户端响应格式。

## 7. 关键实现细节

### 7.1 BodyStorage 复用

项目中请求体通过 `common.BodyStorage` 支持多次读取。详细日志读取后必须重置 seek 位置，否则后续 relay helper 可能读取不到请求体。

对应代码：[controller/relay.go:136](../controller/relay.go#L136)。

### 7.2 上游请求体采集在参数覆盖之后

转换路径中，采集发生在：

1. `common.Marshal(convertedRequest)` 之后。
2. `RemoveDisabledFields` 之后。
3. `ApplyParamOverrideWithRelayInfo` 之后。
4. `NewOutboundJSONBody` 之前。

因此 `RequestPrompt` 是最终发送给上游的 JSON，而不是中间对象。

### 7.3 流式响应采集模型文本而非 SSE 帧

OpenAI、Claude、Gemini 的流式处理都已有文本累积逻辑用于 token 估算或最终响应处理。详细日志复用这些 builder，而不是额外缓存完整 SSE 数据。

优点：

- 避免保存大量协议帧。
- 更符合“模型返回内容”的业务语义。
- 降低内存和存储压力。

限制：

- 无法用于还原完整 SSE 协议交互。
- 工具调用、usage chunk 等非文本事件不会完整保留。

### 7.4 多媒体保存与文本保存解耦

文本字段写入数据库，多媒体写入本地文件。`DetailedLog` 同时保留文本字段和文件路径字段，便于不同类型内容独立启用。

## 8. 错误处理架构

详细日志采用弱依赖策略：

```text
详细日志失败
   ├─ 不影响原消费日志
   ├─ 不影响扣费
   ├─ 不影响上游响应返回
   └─ 仅记录服务端错误日志
```

原因：

- 详细日志是观测和审计增强功能，不是主业务路径。
- 如果因为详细日志失败导致请求失败，会扩大故障影响面。
- 原消费日志仍然是计费和用户侧日志的主数据来源。

## 9. 安全与合规注意事项

该功能会保存用户输入和模型输出，可能包含敏感数据。建议部署时遵循：

1. 默认保持关闭。
2. 只在明确需要时开启。
3. 对 `detailed_logs` 表单独限制访问权限。
4. 对 `DETAILED_LOG_STORAGE_PATH` 设置严格目录权限。
5. 配合数据保留策略定期清理详细日志和本地文件。
6. 在生产环境启用前明确告知使用者数据保存范围。

## 10. 后续可扩展方向

当前实现聚焦后端采集和落库。后续可以扩展：

- 管理端详细日志查询页面。
- 按用户、模型、渠道、request_id 查询详细日志。
- 多媒体文件清理任务。
- 详细日志保留天数配置。
- 对文本内容做脱敏后再入库。
- 支持 ClickHouse 专用建表语句与 TTL 策略。
- 流式 SSE 原始帧可选保存。
