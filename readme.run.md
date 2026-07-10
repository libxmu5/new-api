# 本地运行说明

## 1. 环境要求

后端：

- Go 1.25.1+

前端：

- Bun
- Node.js 环境

如果提示 `bash: bun: command not found`，需要先安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

如果你的 shell 是 zsh：

```bash
source ~/.zshrc
```

项目默认支持本地 SQLite，因此最小运行不需要额外安装 MySQL、PostgreSQL 或 Redis。

## 2. 启动后端

因为 [main.go](main.go) 使用 `go:embed` 同时嵌入 `web/default/dist` 和 `web/classic/dist`，首次本地运行前需要先构建两个前端，确保这两个目录存在。

```bash
cd web/default
bun install
bun run build

cd ../classic
bun install
bun run build

cd ../..
go run .
```

默认监听端口：

```text
3000
```

启动后访问：

```text
http://localhost:3000
```

如果需要指定端口：

```bash
go run . --port 3001
```

默认会使用 SQLite，本地数据库文件为：

```text
one-api.db
```

首次启动会自动建表，并创建默认 root 用户：

```text
username: root
password: 123456
```

## 3. 启动默认前端开发服务

进入默认前端目录：

```bash
cd web/default
bun install
bun run dev
```

前端开发服务由 Rsbuild 启动。

如果需要让前端请求本地后端，请确认前端代理或环境配置指向：

```text
http://localhost:3000
```

## 4. 使用后端内嵌前端

如果不想单独启动前端开发服务，可以先构建前端，然后由 Go 后端托管静态资源。

注意：后端编译时需要同时存在默认前端和经典前端的 `dist` 目录，否则会报错：

```text
pattern web/classic/dist: no matching files found
```

构建两个前端：

```bash
cd web/default
bun install
bun run build

cd ../classic
bun install
bun run build
```

回到项目根目录启动后端：

```bash
cd ../..
go run .
```

访问：

```text
http://localhost:3000
```

## 5. 可选环境变量

本地最小配置可以不创建 `.env`，默认使用 SQLite。

如果需要自定义配置，可以在项目根目录创建 `.env`：

```env
SQL_DSN=local
SESSION_SECRET=your-random-secret
CRYPTO_SECRET=your-random-secret
```

使用 MySQL：

```env
SQL_DSN=root:password@tcp(localhost:3306)/new_api
```

使用 PostgreSQL：

```env
SQL_DSN=postgres://user:password@localhost:5432/new_api
```

## 6. 验证运行状态

后端启动后，可以访问：

```text
http://localhost:3000/api/status
```

也可以运行后端测试：

```bash
go test ./model ./service ./relay ./relay/channel/openai ./relay/channel/claude ./relay/channel/gemini
```

## 7. 常见问题

### 7.1 Go 版本不匹配

如果出现类似错误：

```text
go.mod requires go >= 1.25.1
```

请安装 Go 1.25.1 或更高版本后重试。

### 7.2 前端依赖安装失败

优先使用 Bun：

```bash
cd web/default
bun install
```

不要优先使用 npm、yarn 或 pnpm，除非明确需要排查 Bun 相关问题。

### 7.3 端口被占用

如果 `3000` 端口已被占用，可以指定其他端口：

```bash
go run . --port 3001
```
