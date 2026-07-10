# 项目整体代码设计说明

## 1. 项目定位

本项目是一个统一 AI API 网关与管理平台，核心目标是把多个上游 AI 服务商能力统一封装为兼容 OpenAI、Claude、Gemini 等格式的 API，同时提供用户、令牌、渠道、计费、日志、管理后台和前端控制台。

系统主要解决以下问题：

- 多供应商 API 接入与格式转换。
- 用户与令牌权限管理。
- 渠道分组、模型映射、负载分发和失败重试。
- 请求计费、额度扣减、订阅套餐和充值支付。
- 消费日志、错误日志、性能指标和审计能力。
- 管理端配置、渠道维护、价格倍率、数据看板。
- Web 前端控制台和旧版兼容前端。

## 2. 技术栈设计

### 2.1 后端

后端使用 Go 1.25.1，主要依赖：

- Gin：HTTP 路由和中间件框架。
- GORM：数据库 ORM，支持 SQLite、MySQL、PostgreSQL。
- go-redis：Redis 缓存与分布式状态。
- go-i18n：后端国际化。
- gorilla/websocket：Realtime API 和 WebSocket 转发。
- decimal：计费和额度计算中的精度处理。

入口文件是 [main.go](../main.go#L50)。

### 2.2 前端

项目包含两个前端：

- 默认前端：[web/default](../web/default/)，React 19、TypeScript、Rsbuild、Base UI、Tailwind CSS、TanStack Router/Query。
- 经典前端：[web/classic](../web/classic/)，React 18、Vite、Semi Design 风格的历史界面。

默认前端脚本定义在 [web/default/package.json](../web/default/package.json#L6-L19)，推荐使用 Bun 运行：

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run i18n:sync
```

### 2.3 存储与缓存

- 主数据库：SQLite、MySQL、PostgreSQL 三选一。
- 日志数据库：默认复用主数据库，也可通过 `LOG_SQL_DSN` 单独配置。
- Redis：可选，用于缓存、速率限制和多节点场景。
- 本地磁盘缓存：用于大请求体、文件和部分性能优化场景。

数据库初始化在 [model/main.go](../model/main.go#L177-L247)，迁移在 [model/main.go](../model/main.go#L250-L377)。

## 3. 分层设计

项目采用典型分层架构：

```text
router -> middleware -> controller -> service -> model
                       │
                       └-> relay -> channel adaptor -> upstream provider
```

### 3.1 router 层

目录：[router/](../router/)

职责：

- 注册 API 路由。
- 注册 Relay 路由。
- 注册 Dashboard 兼容路由。
- 注册视频任务路由。
- 注册 Web 静态资源或前端反向跳转逻辑。

主入口：[router/main.go](../router/main.go#L15-L34)。

核心路由组：

| 路由组 | 文件 | 说明 |
| --- | --- | --- |
| `/api` | [router/api-router.go](../router/api-router.go) | 管理端、用户端、支付、配置、统计等 REST API |
| `/v1`、`/v1beta` | [router/relay-router.go](../router/relay-router.go) | AI API 转发入口 |
| `/dashboard` | [router/dashboard.go](../router/dashboard.go) | 兼容 OpenAI dashboard 风格接口 |
| Web | [router/web-router.go](../router/web-router.go) | 前端静态资源和 SPA fallback |

### 3.2 middleware 层

目录：[middleware/](../middleware/)

职责：

- 请求 ID、日志、CORS、gzip、i18n。
- 用户认证、令牌认证、管理员认证、Root 权限认证。
- 全局 API 限流、模型级限流、关键接口限流。
- 渠道分发和请求上下文注入。
- 请求体解压、BodyStorage 清理、性能保护。

关键中间件：

- 渠道分发：[middleware/distributor.go](../middleware/distributor.go#L32)
- Token 鉴权：[middleware/auth.go](../middleware/auth.go)
- 请求 ID：[middleware/request-id.go](../middleware/request-id.go)
- 请求体清理：[middleware/body_cleanup.go](../middleware/body_cleanup.go)

### 3.3 controller 层

目录：[controller/](../controller/)

职责：

- 处理 HTTP 请求和响应。
- 参数解析、权限后的业务入口。
- 调用 service/model 完成业务操作。
- Relay 控制器负责统一接入 AI 请求。

典型模块：

- 用户：[controller/user.go](../controller/user.go)
- 令牌：[controller/token.go](../controller/token.go)
- 渠道：[controller/channel.go](../controller/channel.go)
- 日志：[controller/log.go](../controller/log.go)
- 支付：[controller/topup.go](../controller/topup.go)、[controller/subscription.go](../controller/subscription.go)
- Relay：[controller/relay.go](../controller/relay.go#L68)

### 3.4 service 层

目录：[service/](../service/)

职责：

- 封装核心业务流程。
- 计费、扣费、退款、订阅额度重置。
- token 估算、模型响应 token 计算。
- 上游错误处理和响应复制。
- 通知、支付、安全验证、任务轮询。

典型模块：

- 文本扣费：[service/text_quota.go](../service/text_quota.go)
- 音频扣费：[service/quota.go](../service/quota.go)
- 预扣费：[service/pre_consume_quota.go](../service/pre_consume_quota.go)
- 计费表达式：[pkg/billingexpr](../pkg/billingexpr/)
- OpenAI/Responses 互转：[service/openaicompat](../service/openaicompat/)

### 3.5 model 层

目录：[model/](../model/)

职责：

- GORM 模型定义。
- 数据库迁移。
- CRUD 和查询逻辑。
- 缓存同步和批量更新。
- 日志、额度、渠道、用户、订阅、任务等持久化。

核心模型：

| 模型 | 文件 | 说明 |
| --- | --- | --- |
| User | [model/user.go](../model/user.go) | 用户、角色、状态、额度 |
| Token | [model/token.go](../model/token.go#L14-L32) | API Key、额度、模型限制、IP 限制 |
| Channel | [model/channel.go](../model/channel.go#L23-L60) | 上游渠道、模型列表、分组、权重、多 Key |
| Log | [model/log.go](../model/log.go) | 消费日志、错误日志、管理日志 |
| DetailedLog | [model/detailed_log.go](../model/detailed_log.go) | 详细请求/响应日志 |
| Task | [model/task.go](../model/task.go) | 异步任务记录 |
| Subscription | [model/subscription.go](../model/subscription.go) | 订阅套餐和用户订阅 |

### 3.6 relay 层

目录：[relay/](../relay/)

职责：

- AI API 请求转发。
- 请求格式验证和转换。
- 上游请求构建。
- 响应转换和流式处理。
- usage 解析与结算触发。

核心文件：

- 统一文本转发：[relay/compatible_handler.go](../relay/compatible_handler.go#L25)
- Claude 转发：[relay/claude_handler.go](../relay/claude_handler.go)
- Gemini 转发：[relay/gemini_handler.go](../relay/gemini_handler.go)
- Responses 转发：[relay/responses_handler.go](../relay/responses_handler.go)
- 图片转发：[relay/image_handler.go](../relay/image_handler.go)
- 音频转发：[relay/audio_handler.go](../relay/audio_handler.go)
- Embedding 转发：[relay/embedding_handler.go](../relay/embedding_handler.go)
- Rerank 转发：[relay/rerank_handler.go](../relay/rerank_handler.go)

### 3.7 channel adaptor 层

目录：[relay/channel/](../relay/channel/)

职责：

- 封装具体供应商差异。
- 生成上游 URL。
- 设置请求头。
- 转换 OpenAI、Claude、Gemini、Image、Audio、Embedding 等请求。
- 执行 HTTP 请求。
- 解析响应并转换为统一下游格式。

适配器接口定义在 [relay/channel/adapter.go](../relay/channel/adapter.go#L15)。

当前项目包含 30+ 个 provider adaptor，例如 OpenAI、Claude、Gemini、Azure、AWS Bedrock、Vertex、Ollama、Moonshot、DeepSeek、Volcengine、xAI、Mistral、Cohere 等。

## 4. 核心业务设计

### 4.1 用户与权限

用户体系支持：

- 普通用户、管理员、Root 用户。
- 密码登录。
- OAuth 登录与绑定。
- Passkey/WebAuthn。
- 2FA。
- 邮箱验证。
- Turnstile 校验。

权限主要通过 middleware 控制：

- `UserAuth`
- `AdminAuth`
- `RootAuth`
- `TokenAuth`

### 4.2 Token 与额度

Token 是用户调用 Relay API 的凭证，模型定义见 [model/token.go](../model/token.go#L14-L32)。

Token 支持：

- 独立剩余额度。
- 无限额度。
- 模型限制。
- IP 白名单。
- 所属分组。
- auto 分组跨组重试。

调用链中 Token 认证后，middleware 会把用户、Token、分组、模型等上下文写入 Gin Context，供后续分发和计费使用。

### 4.3 渠道管理

Channel 是上游服务商配置，模型定义见 [model/channel.go](../model/channel.go#L23-L60)。

Channel 支持：

- 渠道类型。
- API Key 或多 Key。
- Base URL。
- 模型列表。
- 模型映射。
- 分组。
- 权重和优先级。
- 状态码映射。
- 参数覆盖和请求头覆盖。
- 渠道特定设置。

渠道分发逻辑由 [middleware/distributor.go](../middleware/distributor.go#L32) 负责。

### 4.4 模型与倍率

计费支持两类模式：

1. 按 token 倍率计费。
2. 按模型固定价格计费。

相关配置在 [setting/ratio_setting](../setting/ratio_setting/) 和 [setting/billing_setting](../setting/billing_setting/)。

计费表达式系统位于 [pkg/billingexpr](../pkg/billingexpr/)，用于 tiered/dynamic billing。修改该系统前必须阅读 [pkg/billingexpr/expr.md](../pkg/billingexpr/expr.md)。

### 4.5 预扣费与结算

请求转发前：

- 估算 prompt token。
- 计算预扣额度。
- 对用户或订阅额度执行预扣。

请求完成后：

- 根据上游 usage 或本地估算得到实际 token。
- 计算实际费用。
- 多退少补。
- 写入消费日志。
- 记录性能样本。

主要代码：

- 预扣费：[service/pre_consume_quota.go](../service/pre_consume_quota.go)
- 文本结算：[service/text_quota.go](../service/text_quota.go)
- 音频结算：[service/quota.go](../service/quota.go)

### 4.6 日志系统

日志模型在 [model/log.go](../model/log.go)。

日志类型包括：

- topup
- consume
- manage
- system
- error
- refund

消费日志由 [model/log.go:222](../model/log.go#L222) 的 `RecordConsumeLog` 写入。

本分支新增详细日志 [model/detailed_log.go](../model/detailed_log.go)，用于保存原始请求、上游请求和模型响应，不影响原消费日志。

### 4.7 异步任务

项目支持 Midjourney、Suno、视频、图片等异步任务。任务一般分为：

1. 提交任务。
2. 记录任务 ID 和初始状态。
3. 定时轮询上游。
4. 更新任务状态。
5. 结算或退款。

相关文件：

- [model/task.go](../model/task.go)
- [controller/task.go](../controller/task.go)
- [service/task_polling.go](../service/task_polling.go)
- [relay/relay_task.go](../relay/relay_task.go)

### 4.8 支付与订阅

项目支持充值和订阅：

- 余额充值。
- Stripe。
- Creem。
- EPay。
- Waffo / Waffo Pancake。
- 订阅套餐、订阅额度、周期重置。

相关模块：

- [controller/topup.go](../controller/topup.go)
- [controller/subscription.go](../controller/subscription.go)
- [model/topup.go](../model/topup.go)
- [model/subscription.go](../model/subscription.go)
- [service/subscription.go](../service/subscription.go)

## 5. 请求转发设计

### 5.1 标准 Relay 流程

```text
HTTP Request
   │
   ▼
router/relay-router.go
   │
   ▼
middleware.TokenAuth
   │
   ▼
middleware.Distribute
   │
   ▼
controller.Relay
   │
   ▼
relay helper
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
service.Post*ConsumeQuota
   │
   ▼
model.RecordConsumeLog
```

### 5.2 controller.Relay 职责

[controller/relay.go](../controller/relay.go#L68) 统一处理不同格式请求。

主要步骤：

1. 读取并校验请求。
2. 生成 `RelayInfo`。
3. 敏感词检查。
4. token 估算。
5. 模型价格和预扣费计算。
6. 执行重试循环。
7. 根据 RelayMode 进入对应 helper。
8. 错误时退款或收取违规费用。

### 5.3 RelayInfo 设计

`RelayInfo` 位于 [relay/common/relay_info.go](../relay/common/relay_info.go)。

它是一次转发请求的上下文对象，保存：

- 用户和 Token 信息。
- 渠道元数据。
- 原始模型和上游模型。
- relay mode 与 relay format。
- 是否流式。
- 计费快照。
- 上游请求体大小。
- 转换链路。
- 运行时错误和重试状态。

### 5.4 适配器设计

适配器接口位于 [relay/channel/adapter.go](../relay/channel/adapter.go#L15)。

每个渠道只需要实现统一接口：

- 初始化渠道上下文。
- 生成请求 URL。
- 设置请求头。
- 转换不同请求格式。
- 执行上游请求。
- 处理上游响应。
- 返回模型列表和渠道名称。

这种设计让 relay 主流程不需要关心供应商细节。

## 6. 前端设计

### 6.1 默认前端

目录：[web/default](../web/default/)

特点：

- React 19。
- TypeScript。
- Rsbuild。
- Base UI。
- Tailwind CSS。
- TanStack Router。
- TanStack Query。
- i18next。
- Zustand。

主要目录：

| 目录 | 说明 |
| --- | --- |
| `src/routes` | 页面路由 |
| `src/components` | 通用组件 |
| `src/hooks` | 业务和 UI hooks |
| `src/lib` | API、格式化、工具函数 |
| `src/stores` | Zustand 状态管理 |
| `src/i18n` | 前端国际化 |
| `src/styles` | 全局样式和主题 |

### 6.2 经典前端

目录：[web/classic](../web/classic/)

经典前端用于兼容旧界面和已有用户习惯，主要使用 JSX、helper、constants、context 等结构。

### 6.3 前后端集成

后端通过 Go embed 打包前端构建产物，见 [main.go](../main.go#L38-L48)。

运行时：

- 如果 `FRONTEND_BASE_URL` 为空，则后端直接提供 Web 静态资源。
- 如果配置了外部前端地址，则后端将未知路由重定向到外部前端。

## 7. 配置设计

项目配置来源包括：

- 环境变量。
- 数据库 options 表。
- setting 包中的模块化配置。
- 渠道级配置字段。
- 用户级设置。

初始化流程：

1. `common.InitEnv()` 读取环境变量。
2. `model.InitDB()` 初始化主库。
3. `model.InitLogDB()` 初始化日志库。
4. `model.InitOptionMap()` 加载系统配置。
5. setting 包从 option/cache 中读取运行时配置。

## 8. 国际化设计

### 8.1 后端国际化

目录：[i18n](../i18n/)

使用 `go-i18n`，语言文件在 [i18n/locales](../i18n/locales/)。

### 8.2 前端国际化

目录：[web/default/src/i18n](../web/default/src/i18n/)

使用 `i18next` 和 `react-i18next`，支持多语言 JSON 文件。

同步命令：

```bash
cd web/default
bun run i18n:sync
```

## 9. 可观测性设计

项目包含多种观测能力：

- 请求日志中间件。
- request id。
- 消费日志和错误日志。
- quota data 统计。
- perf metrics。
- pprof。
- Pyroscope。
- 渠道自动测试和响应时间统计。
- 详细日志功能。

相关模块：

- [logger](../logger/)
- [middleware/logger.go](../middleware/logger.go)
- [pkg/perf_metrics](../pkg/perf_metrics/)
- [controller/performance.go](../controller/performance.go)

## 10. 安全设计

主要安全机制：

- Token 鉴权和用户鉴权。
- 管理员 / Root 权限隔离。
- Turnstile 校验。
- 关键接口限流。
- 密码哈希。
- JWT。
- Passkey / WebAuthn。
- 2FA。
- SSRF 防护和 URL 校验。
- 请求体大小限制和 BodyStorage。
- CORS 控制。
- 支付回调校验。
- 敏感词检查。

重要文件：

- [middleware/auth.go](../middleware/auth.go)
- [common/ssrf_protection.go](../common/ssrf_protection.go)
- [common/url_validator.go](../common/url_validator.go)
- [middleware/secure_verification.go](../middleware/secure_verification.go)
- [controller/secure_verification.go](../controller/secure_verification.go)

## 11. 测试与验证

后端测试使用 Go test。当前针对核心修改执行过：

```bash
go test ./model ./service ./relay ./relay/channel/openai ./relay/channel/claude ./relay/channel/gemini
```

前端推荐验证：

```bash
cd web/default
bun run typecheck
bun run build
```

## 12. 设计边界

项目的核心边界如下：

- controller 不直接操作复杂数据库事务，复杂业务交给 service/model。
- relay 主流程不写供应商细节，供应商差异封装在 adaptor。
- model 层保持跨 SQLite/MySQL/PostgreSQL 兼容。
- JSON 编解码通过 [common/json.go](../common/json.go) 包装函数完成。
- 计费逻辑尽量集中在 service 和 billingexpr，避免散落在 adaptor 中。
- 前端通过 REST API 与后端交互，不直接访问数据库或内部配置。
