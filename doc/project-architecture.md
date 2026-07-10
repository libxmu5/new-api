# 项目整体架构说明

## 1. 架构概览

本项目是一个多供应商 AI API 网关，整体采用“管理平台 + API 转发网关 + 计费结算系统 + 前端控制台”的组合架构。

```text
                         ┌────────────────────┐
                         │   Web Console       │
                         │ React / Rsbuild     │
                         └─────────┬──────────┘
                                   │ /api
                                   ▼
┌─────────────┐          ┌────────────────────┐          ┌────────────────────┐
│ API Client  │──/v1────▶│ Gin HTTP Server     │──SQL────▶│ Main DB             │
│ OpenAI SDK  │          │ router/middleware   │          │ User/Token/Channel  │
│ Claude SDK  │          └─────────┬──────────┘          └────────────────────┘
│ Gemini SDK  │                    │
└─────────────┘                    │ relay
                                   ▼
                         ┌────────────────────┐          ┌────────────────────┐
                         │ Relay Core          │──log────▶│ Log DB              │
                         │ format conversion   │          │ logs/detailed_logs  │
                         └─────────┬──────────┘          └────────────────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Channel Adaptors    │
                         │ OpenAI/Claude/etc.  │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ Upstream Providers  │
                         │ 30+ AI services     │
                         └────────────────────┘
```

核心架构特征：

- 单进程内同时承载管理 API、Relay API 和 Web 静态资源。
- 通过中间件完成认证、限流、渠道分发、请求体管理。
- Relay 层统一请求生命周期，Adaptor 层封装供应商差异。
- 计费与日志在响应处理后统一结算。
- 前端以 REST API 调用后端管理能力。

## 2. 运行时启动架构

入口：[main.go](../main.go#L50)。

启动流程：

```text
main
 │
 ├─ InitResources
 │   ├─ 加载 .env / 环境变量
 │   ├─ 初始化数据库
 │   ├─ 初始化日志数据库
 │   ├─ 初始化 Redis / 缓存
 │   ├─ 初始化配置 OptionMap
 │   ├─ 初始化 OAuth / i18n / ratio
 │   └─ 初始化其他运行资源
 │
 ├─ 启动后台任务
 │   ├─ 渠道缓存同步
 │   ├─ Options 热更新
 │   ├─ QuotaData 数据看板更新
 │   ├─ 渠道自动测试
 │   ├─ Codex 凭据刷新
 │   ├─ 订阅额度重置
 │   ├─ 异步任务轮询
 │   └─ 性能监控 / pprof / Pyroscope
 │
 ├─ 初始化 Gin Server
 │   ├─ Recovery
 │   ├─ RequestId
 │   ├─ PoweredBy
 │   ├─ I18n
 │   ├─ Logger
 │   └─ Session
 │
 ├─ router.SetRouter
 │   ├─ /api
 │   ├─ /v1 / /v1beta relay
 │   ├─ /dashboard
 │   ├─ video routes
 │   └─ web routes
 │
 └─ ListenAndServe
```

## 3. HTTP 路由架构

路由由 [router/main.go](../router/main.go#L15-L34) 聚合。

```text
Gin Engine
 ├─ /api                  管理端和用户端 REST API
 ├─ /v1                   OpenAI/Claude/Responses/Audio/Image/Embedding/Rerank API
 ├─ /v1beta               Gemini API
 ├─ /mj                   Midjourney 兼容任务 API
 ├─ /suno                 Suno 任务 API
 ├─ /dashboard            OpenAI dashboard 兼容接口
 ├─ /video                视频相关 API
 └─ web fallback          前端 SPA
```

### 3.1 管理 API

管理 API 在 [router/api-router.go](../router/api-router.go) 注册。

主要能力：

- setup/status。
- 用户注册、登录、OAuth、Passkey、2FA。
- 用户自服务：令牌、充值、订阅、设置。
- 管理员：用户、渠道、令牌、模型、日志、倍率、配置。
- 支付回调：Stripe、Creem、EPay、Waffo。
- 性能监控和系统配置。

### 3.2 Relay API

Relay API 在 [router/relay-router.go](../router/relay-router.go) 注册。

主要协议：

- OpenAI Chat Completions。
- OpenAI Responses。
- Claude Messages。
- Gemini native / compatible。
- Image generations / edits。
- Audio speech / transcription / translation。
- Embeddings。
- Rerank。
- Realtime WebSocket。
- Midjourney / Suno / task API。

Relay 路由统一使用：

- `TokenAuth`
- `SystemPerformanceCheck`
- `ModelRequestRateLimit`
- `Distribute`

## 4. 请求处理架构

### 4.1 管理 API 请求链路

```text
Frontend / Admin Client
   │
   ▼
/api route
   │
   ▼
middleware
   ├─ gzip
   ├─ rate limit
   ├─ auth
   └─ body cleanup
   │
   ▼
controller
   │
   ▼
service / model
   │
   ▼
DB / Redis / external payment provider
```

管理 API 以传统 CRUD 和业务服务为主，controller 负责 HTTP 语义，service/model 负责业务与数据。

### 4.2 Relay 请求链路

```text
API Client
   │
   ▼
/v1 route
   │
   ▼
TokenAuth
   │
   ▼
ModelRequestRateLimit
   │
   ▼
Distribute
   │
   ├─ 解析模型
   │   ├─ 校验用户/Token 限制
   │   ├─ 选择可用渠道
   │   ├─ 注入 channel context
   │   └─ 设置重试策略
   │
   ▼
controller.Relay
   │
   ├─ GetAndValidateRequest
   ├─ GenRelayInfo
   ├─ sensitive check
   ├─ token estimate
   ├─ price helper
   ├─ pre-consume billing
   └─ relayHandler
        │
        ├─ TextHelper
        ├─ ClaudeHelper
        ├─ GeminiHelper
        ├─ ResponsesHelper
        ├─ ImageHelper
        ├─ AudioHelper
        ├─ EmbeddingHelper
        └─ RerankHelper
              │
              ▼
        channel adaptor
              │
              ▼
        upstream provider
              │
              ▼
        response handler
              │
              ▼
        Post*ConsumeQuota
              │
              ├─ settle billing
              ├─ record consume log
              ├─ record detailed log
              └─ record performance sample
```

## 5. Relay 子系统架构

Relay 是项目最核心的子系统，负责把不同客户端协议和不同上游协议组合起来。

### 5.1 RelayFormat 与 RelayMode

系统用两类概念描述请求：

- `RelayFormat`：客户端请求格式，如 OpenAI、Claude、Gemini、Responses。
- `RelayMode`：具体能力类型，如 chat、image、audio、embedding、rerank、realtime。

这种分离使得：

- 同一能力可以有多种客户端协议入口。
- 同一客户端协议可以映射到不同能力处理器。
- 请求转换链路可以被记录和追踪。

### 5.2 RelayInfo 上下文

`RelayInfo` 是 relay 链路中的核心上下文，定义在 [relay/common/relay_info.go](../relay/common/relay_info.go)。

它贯穿：

```text
controller -> helper -> adaptor -> response handler -> service
```

保存内容包括：

- 用户、Token、分组、额度。
- 渠道类型、渠道 ID、Base URL、Key、Header/Param override。
- 原模型、上游模型、模型映射状态。
- 是否流式、是否 playground、是否 channel test。
- 价格数据和计费会话。
- 请求转换链路。
- 重试状态和最后错误。
- 详细日志采集字段。

### 5.3 Adaptor 插件化架构

适配器接口：[relay/channel/adapter.go](../relay/channel/adapter.go#L15)。

```text
Relay Core
   │
   ├─ GetAdaptor(apiType)
   │
   ▼
Adaptor
   ├─ Init
   ├─ GetRequestURL
   ├─ SetupRequestHeader
   ├─ Convert*Request
   ├─ DoRequest
   ├─ DoResponse
   └─ GetModelList / GetChannelName
```

Provider 差异被隔离在 adaptor 内，relay 主流程只依赖统一接口。

当前适配器覆盖：

- OpenAI / Azure OpenAI。
- Claude / AWS Bedrock。
- Gemini / Vertex AI。
- DeepSeek、Moonshot、xAI、Mistral、Cohere。
- Ollama、本地或兼容服务。
- 图片、视频、任务类平台。

### 5.4 请求转换架构

请求可能经过多次转换：

```text
Client Request Format
   │
   ├─ OpenAI Chat
   ├─ Claude Messages
   ├─ Gemini Native
   └─ Responses
   │
   ▼
Internal DTO
   │
   ▼
Adaptor Convert*Request
   │
   ▼
Upstream Request Format
```

转换结果会经过：

- 模型映射。
- 系统提示词插入或覆盖。
- 禁用字段删除。
- 参数覆盖。
- Header 覆盖。

### 5.5 响应转换架构

响应转换支持：

- 上游 OpenAI -> 下游 OpenAI。
- 上游 Claude -> 下游 OpenAI。
- 上游 Gemini -> 下游 OpenAI。
- OpenAI/Claude/Gemini 之间部分互转。
- 流式 SSE 输出。
- usage chunk 输出。
- 错误响应映射。

响应处理还承担 token usage 解析和补偿估算。

## 6. 渠道分发架构

渠道分发由 [middleware/distributor.go](../middleware/distributor.go#L32) 驱动。

```text
Request model
   │
   ▼
TokenAuth context
   │
   ▼
Distribute
   ├─ 检查 token 模型限制
   ├─ 解析目标模型
   ├─ 按分组筛选渠道
   ├─ 按模型筛选渠道
   ├─ 按权重/优先级/亲和性选择渠道
   ├─ 多 Key 选择
   ├─ 写入 channel context
   └─ 支持自动重试和跨组重试
```

渠道分发与 adaptor 解耦：分发只选择“哪个渠道”，具体请求怎么发由 adaptor 决定。

## 7. 计费架构

### 7.1 计费生命周期

```text
请求进入
   │
   ▼
EstimateRequestToken
   │
   ▼
ModelPriceHelper
   │
   ▼
PreConsumeBilling
   │
   ▼
Relay upstream request
   │
   ▼
Usage parse / local estimate
   │
   ▼
PostTextConsumeQuota / PostAudioConsumeQuota
   │
   ▼
SettleBilling
   │
   ├─ 用户额度扣减/退回
   ├─ Token 额度扣减/退回
   ├─ 订阅额度结算
   └─ 日志记录
```

### 7.2 计费来源

支持两类计费来源：

- Wallet：用户余额额度。
- Subscription：用户订阅额度。

RelayInfo 中通过 `BillingSource`、`Billing`、`SubscriptionId` 等字段描述当前请求的计费上下文。

### 7.3 计费模式

支持：

- 模型倍率。
- 分组倍率。
- 补全倍率。
- 音频倍率。
- 缓存读写倍率。
- 固定模型价格。
- tiered expression 计费。

## 8. 数据库架构

### 8.1 主库

主库保存核心业务数据：

```text
users
 tokens
 channels
 options
 logs
 detailed_logs
 quota_data
 tasks
 models
 vendors
 topups
 subscriptions
 oauth bindings
 passkeys
 perf_metrics
```

迁移入口：[model/main.go](../model/main.go#L250-L377)。

### 8.2 日志库

如果配置 `LOG_SQL_DSN`，日志可写入独立数据库。否则复用主库。

日志相关表：

- `logs`：消费、错误、管理、充值等日志。
- `detailed_logs`：请求/响应详细内容。
- `quota_data`：聚合统计数据。
- `perf_metrics`：性能样本。

### 8.3 跨数据库兼容

项目要求兼容：

- SQLite。
- MySQL。
- PostgreSQL。

因此数据库逻辑遵循：

- 优先使用 GORM API。
- 避免数据库私有 SQL。
- reserved column 使用封装变量。
- SQLite 特殊迁移单独处理。

## 9. 缓存架构

缓存分为：

### 9.1 内存缓存

用于：

- 渠道缓存。
- OptionMap。
- 模型/倍率等配置。
- 批量更新。

### 9.2 Redis 缓存

用于：

- 多节点缓存共享。
- 限流。
- 部分分布式状态。

### 9.3 BodyStorage / 磁盘缓存

大请求体通过 BodyStorage 管理，支持：

- 内存存储。
- 磁盘存储。
- 多次读取。
- 请求结束清理。

这对 relay 请求尤其重要，因为请求体可能需要被校验、转换、透传、日志采集多次读取。

## 10. 前端架构

### 10.1 默认前端

```text
web/default/src
 ├─ routes           TanStack Router 页面
 ├─ components       UI 组件
 ├─ hooks            复用 hooks
 ├─ lib              API client、格式化、工具函数
 ├─ stores           Zustand 状态
 ├─ i18n             国际化
 ├─ context          主题、布局、方向等上下文
 └─ styles           Tailwind 和主题样式
```

前端主要通过 [web/default/src/lib/api.ts](../web/default/src/lib/api.ts) 访问后端 `/api`。

### 10.2 经典前端

```text
web/classic/src
 ├─ App.jsx
 ├─ constants
 ├─ helpers
 ├─ contexts
 ├─ i18n
 └─ services
```

经典前端保留旧版交互和兼容能力。

### 10.3 构建与嵌入

前端构建产物通过 Go embed 嵌入后端二进制：[main.go](../main.go#L38-L48)。

架构上支持两种部署：

1. 后端直接托管前端静态资源。
2. `FRONTEND_BASE_URL` 指向外部前端，后端只提供 API。

## 11. 配置架构

配置分为四类：

```text
环境变量
 ├─ 启动端口、数据库、Redis、密钥
 ├─ 开关类配置
 └─ 性能和调试配置

数据库 options
 ├─ 系统配置
 ├─ 运营配置
 ├─ 支付配置
 ├─ 模型配置
 └─ 前端控制台配置

渠道配置
 ├─ base_url / key
 ├─ model mapping
 ├─ param override
 ├─ header override
 └─ channel settings

用户配置
 ├─ 通知方式
 ├─ IP 日志
 └─ 订阅偏好
```

setting 包按领域拆分配置读取逻辑：

- [setting/operation_setting](../setting/operation_setting/)
- [setting/model_setting](../setting/model_setting/)
- [setting/ratio_setting](../setting/ratio_setting/)
- [setting/billing_setting](../setting/billing_setting/)
- [setting/performance_setting](../setting/performance_setting/)

## 12. 安全架构

### 12.1 认证授权

```text
Password / OAuth / Passkey / 2FA
   │
   ▼
User session / JWT
   │
   ▼
UserAuth / AdminAuth / RootAuth
```

Relay API 使用 TokenAuth：

```text
API Key
   │
   ▼
TokenAuth
   ├─ token exists
   ├─ token enabled
   ├─ quota valid
   ├─ user valid
   ├─ ip allow list
   └─ model limits
```

### 12.2 请求安全

- 请求体大小限制。
- 解压后大小控制。
- SSRF 防护。
- URL 白名单/校验。
- 关键接口限流。
- 全局 API 限流。
- Turnstile 防自动化。
- 敏感词检查。

### 12.3 支付安全

支付回调由对应 controller 校验签名、环境、订单状态和幂等性。

### 12.4 日志安全

日志默认不保存详细 prompt/response。详细日志功能必须显式启用，并应配合权限和保留策略。

## 13. 可观测性架构

```text
RequestId
   │
   ├─ access log
   ├─ consume log
   ├─ error log
   ├─ detailed log
   ├─ upstream request id
   └─ frontend/API troubleshooting
```

观测模块：

- 请求日志。
- 系统日志。
- 消费日志。
- 错误日志。
- 详细日志。
- perf metrics。
- quota data。
- pprof。
- Pyroscope。
- 渠道自动测试。

## 14. 异步任务架构

异步任务适用于 Midjourney、视频、音乐等耗时任务。

```text
submit task
   │
   ▼
pre-consume / lock quota
   │
   ▼
create task record
   │
   ▼
background polling
   │
   ▼
update task status
   │
   ├─ success -> settle
   └─ fail/timeout -> refund
```

任务平台通过 task adaptor 与 service 层解耦。

## 15. 部署架构

常见部署方式：

### 15.1 单节点

```text
new-api binary/container
   ├─ SQLite/MySQL/PostgreSQL
   ├─ optional Redis
   └─ embedded frontend
```

适合小规模部署。

### 15.2 多节点

```text
Load Balancer
   │
   ├─ new-api node 1
   ├─ new-api node 2
   └─ new-api node N
          │
          ├─ shared SQL DB
          ├─ shared Redis
          └─ optional shared file storage
```

多节点建议：

- 使用 MySQL 或 PostgreSQL。
- 启用 Redis。
- 区分 master/slave 节点。
- 只有 master 执行迁移和后台任务。
- 日志库可单独拆分。

### 15.3 前后端分离

```text
Frontend hosting/CDN
   │
   ▼
Backend API /api /v1
```

通过 `FRONTEND_BASE_URL` 控制后端是否托管前端。

## 16. 扩展架构

### 16.1 新增上游渠道

新增渠道通常需要：

1. 在 `constant` 中定义渠道类型。
2. 在 `relay/channel/{provider}` 中实现 adaptor。
3. 在 `relay/relay_adaptor.go` 注册 adaptor。
4. 补充模型列表、默认 Base URL、价格倍率。
5. 确认是否支持 StreamOptions。
6. 增加测试。

### 16.2 新增 API 能力

新增能力通常需要：

1. 新增 DTO。
2. 新增 RelayMode 或 RelayFormat。
3. 注册路由。
4. 实现 helper。
5. 扩展 adaptor 接口或使用现有接口。
6. 增加计费和日志逻辑。

### 16.3 新增管理功能

新增管理功能通常需要：

1. model 定义或复用现有模型。
2. controller 增加 REST API。
3. router 注册 API。
4. 前端新增 route/component/hooks。
5. i18n 同步。
6. 权限和限流校验。

## 17. 架构原则总结

1. **统一入口，分层处理**：HTTP 请求统一进入 Gin，再按 router/middleware/controller/service/model 分层。
2. **Relay 主流程稳定，供应商差异下沉**：provider 差异只在 adaptor 中处理。
3. **计费集中化**：预扣费和结算集中在 service，避免分散到渠道实现。
4. **日志旁路化**：日志不影响主流程，详细日志独立开关和独立表。
5. **跨数据库兼容**：模型和迁移必须兼容 SQLite、MySQL、PostgreSQL。
6. **前端双主题兼容**：默认前端面向新架构，classic 保留历史兼容。
7. **配置可热更新**：大量运行时配置来自 options 和 setting 包。
8. **多节点可部署**：通过 Redis、共享数据库、master/slave 角色支持横向扩展。
