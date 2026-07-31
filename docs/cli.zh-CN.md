# 运行服务

[English](cli.md) | **简体中文**

`bun run start` 无需任何参数。下列参数用于改变监听位置和启动时的行为。

---

## 命令行参数

```bash
bun run server.ts --port=8080 --no-browser
```

| 参数 | 说明 |
|------|------|
| `--port=N` | 监听端口 N（默认 `5757`） |
| `--host=H` | 绑定地址（默认 `127.0.0.1`）—— 配置 API 可以写文件，因此默认只监听回环地址，除非你主动改成 `0.0.0.0`。[原因](architecture.zh-CN.md#网络绑定) |
| `--no-browser` | 不自动打开浏览器 |
| `--static-only` | 跳过文件监听（以及浏览器）—— 启动扫描仍会执行，但之后的变更需重启才读取 |
| `--no-provision` | 不安装技能、也不向 AI 工具注册 MCP 服务器。`/mcp` 端点仍然提供服务 —— [详见](mcp.zh-CN.md#关闭自动装配) |

环境变量 `PORT` 和 `HOST` 效果相同，且优先级高于参数。

## 脚本命令

| 命令 | 作用 |
|---|---|
| `bun run start` | 启动服务 + MCP 端点（等价于 `bun run server.ts`） |
| `bun run dev` | `--watch` 热重载 |
| `bun run mcp` | 以 stdio 运行 MCP 服务器，供无法使用 HTTP 的客户端 |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | 单元测试 |
| `bun run build` | 编译当前平台的独立可执行文件 |
| `bun run build:mcp` | 把 stdio MCP 服务器编译为独立可执行文件 |

## 独立可执行文件

```bash
bun run build   # → dist/ai-insights（Windows 为 .exe），约 60MB，无需安装 Bun
```

- 分发时把 `static/` 与 `assets/` 一并附上 —— 它们和 `data/` 缓存都相对可执行文件定位，因此可在任意工作目录启动。
- 缺少 `assets/` 时其余功能照常，只是无法安装内置技能。
- 交叉编译加目标平台：`bun build --compile --target=bun-<windows|darwin|linux>-x64 server.ts --outfile dist/ai-insights`（Apple Silicon 用 `bun-darwin-arm64`）。
