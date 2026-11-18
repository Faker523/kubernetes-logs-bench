# 本地 Agent 接收文档 — KubeLog Workbench

> 本文档面向接手本仓库的本地开发 Agent（如 Claude Code、Cursor、Codex 等）或本地工程开发者，用于快速完成环境启动、架构理解、接口对接及二次开发。

---

## 1. 项目概述

**KubeLog Workbench** 是一个基于 **React 19 + TypeScript + Tailwind CSS v4 + Express** 的 Kubernetes 日志查看与结构化分析工作台，支持三种数据源模式：

1. **内置演示集群 (`sandbox`)**：开箱即用，包含 4 个命名空间、8 个多容器 Pod、异常堆栈及实时日志流模拟。
2. **实时 K8s 集群 (`k8s-api`)**：通过后端 Express 代理直接访问 Kubernetes API Server，支持：
   - 粘贴 / 上传 `kubeconfig`（YAML / JSON）自动解析凭据
   - 自动检测本地宿主机 `~/.kube/config`（或环境变量 `KUBECONFIG`）及集群内 `ServiceAccount` 凭据
   - API Server + Bearer Token、跳过 TLS 校验、自定义 CA 证书及 mTLS 客户端证书
3. **本地日志文件导入 (`imported-file`)**：支持上传 `.log` / `.txt` / `.json` 或粘贴 `kubectl logs --timestamps` 原文进行离线解析与检索。

---

## 2. 本地环境启动与验证

### 2.1 运行要求
- Node.js >= 20（当前工程使用 `@types/node` ^22.14.0）
- 监听端口固定为 **`3000`**（见 `server.ts`）

### 2.2 常用命令

```bash
# 1. 安装依赖
npm install

# 2. 启动开发环境（tsx 运行 server.ts 并挂载 Vite 中间件）
npm run dev

# 3. TypeScript 类型检查
npm run lint

# 4. 构建前端静态产物（输出至 dist/）
npm run build

# 5. 生产环境启动（需先执行 npm run build）
NODE_ENV=production npm start
```

> **注意**：`package.json` 中的 `"start": "node server.ts"` 在 Node 22+ 支持原生 TS 类型剥离时可直接运行；若本地 Node 版本低于 22，可使用 `NODE_ENV=production npx tsx server.ts` 启动。

### 2.3 环境变量
参考 `.env.example`（本项目当前未调用外部 LLM 接口，本地运行 K8s 日志查看功能无需强制配置密钥）：
- `KUBECONFIG`（可选）：自定义本地 kubeconfig 路径；未设置时默认读取 `~/.kube/config`。
- `NODE_ENV`：`development` 下启用 Vite Middleware，`production` 下托管 `dist/` 静态资源。

---

## 3. 目录结构与模块职责

```text
.
├── server.ts                         # Express 后端入口 + K8s API 代理 + Vite 中间件
├── index.html                        # HTML 入口（字体加载、默认暗色主题 class="dark"）
├── metadata.json                     # 应用元信息
├── package.json                      # 依赖与脚本配置
├── vite.config.ts                    # Vite + Tailwind v4 构建配置
├── doc/
│   └── local-agent-handoff.md        # 本文档（本地 Agent 接收指南）
└── src/
    ├── main.tsx                      # React 挂载入口
    ├── index.css                     # Tailwind v4 (@custom-variant dark) 与滚动条样式
    ├── App.tsx                       # 核心工作台状态编排（数据源、过滤、Live Tail、主题）
    ├── types/
    │   └── k8s.ts                    # ClusterConfig、PodInfo、LogEntry、FilterState 等类型
    ├── data/
    │   └── sandboxCluster.ts         # 内置演示集群数据与实时日志生成器
    ├── utils/
    │   ├── logParser.ts              # 日志解析器（RFC3339/CRI/JSON/klog/堆栈分组/导出）
    │   └── k8sClient.ts              # 前端调用 /api/k8s/* 的封装
    └── components/
        ├── TopBar.tsx                # 顶部导航（面包屑路径、主题切换、导出、连接入口）
        ├── Sidebar.tsx               # 左侧资源树（集群、Namespace、Pod/Container、多 Pod 聚合）
        ├── LogToolbar.tsx            # 查询栏（关键词、正则、排除 -v、级别分段、显示开关、Live Tail）
        ├── LogHistogram.tsx          # 顶部时间分布直方图（按桶统计并支持点击下钻）
        ├── LogViewport.tsx           # 等宽日志主视口（高亮、堆栈折叠、智能自动滚动）
        ├── LogDetailDrawer.tsx       # 右侧日志详情抽屉（JSON 字段提取与一键过滤/排除）
        └── ClusterConnectModal.tsx   # 集群连接 / kubeconfig 解析 / 文件导入弹窗
```

---

## 4. 后端接口契约 (`/api/k8s/*`)

所有接口定义在 `server.ts` 中。为避免在服务端持久化敏感凭据，集群连接参数由前端按请求通过 HTTP Header 传入后端代理转发至 K8s API Server。

### 4.1 公共请求头（用于 `/namespaces`、`/pods`、`/logs`）
| Header | 必填 | 说明 |
| --- | --- | --- |
| `x-k8s-server` | 是 | Kubernetes API Server 地址（如 `https://10.0.0.10:6443`） |
| `x-k8s-token` | 否 | Bearer Token |
| `x-k8s-insecure` | 否 | `"true"` 时跳过 TLS 证书校验（`rejectUnauthorized = false`） |
| `x-k8s-ca-b64` | 否 | Base64 编码的 PEM CA 证书 |
| `x-k8s-cert-b64` | 否 | Base64 编码的 mTLS Client Certificate |
| `x-k8s-key-b64` | 否 | Base64 编码的 mTLS Client Key |

### 4.2 路由清单

1. **`GET /api/k8s/local-status`**
   - 检查运行环境是否存在 `$KUBECONFIG` / `~/.kube/config` 或 `/var/run/secrets/kubernetes.io/serviceaccount/token`。
   - 返回：`{ hasLocalKubeconfig, kubeconfigPath, hasInCluster }`

2. **`POST /api/k8s/local-load`**
   - 读取宿主机本地 kubeconfig 或 In-Cluster ServiceAccount 凭据并解析返回给前端表单填充。

3. **`POST /api/k8s/kubeconfig/parse`**
   - 请求体：`{ kubeconfig: string }`（支持 YAML 或 JSON 格式）
   - 解析出 `name`、`apiServer`、`token`、`caCert`、`clientCert`、`clientKey`、`insecureTls`。

4. **`POST /api/k8s/test`**
   - 请求体：`{ apiServer, token?, caCert?, clientCert?, clientKey?, insecureTls? }`
   - 请求目标集群 `/version` 验证连通性与鉴权，返回 `{ ok: true, gitVersion, platform }`。

5. **`GET /api/k8s/namespaces`**
   - 代理请求 `/api/v1/namespaces`，返回 `{ namespaces: string[] }`。

6. **`GET /api/k8s/pods?namespace=<ns>`**
   - `namespace` 为空或 `__all__` 时请求 `/api/v1/pods`，否则请求 `/api/v1/namespaces/:ns/pods`。
   - 聚合 `spec.containers`、`spec.initContainers` 与 `status.containerStatuses`，返回标准化的 `PodInfo[]`。

7. **`GET /api/k8s/logs?namespace=...&pod=...&container=...&tailLines=500&previous=false&sinceSeconds=...`**
   - 代理请求 `/api/v1/namespaces/:ns/pods/:pod/log?timestamps=true...`，返回 `{ raw: string }`。

---

## 5. 核心实现细节与约定

### 5.1 日志解析能力 (`src/utils/logParser.ts`)
- 自动剥离 K8s `RFC3339Nano` 时间戳前缀及 CRI `stdout/stderr F|P` 前缀。
- 自动识别并解析 JSON 结构化日志（兼容 Zap、Logrus、Pino、Envoy 访问日志），提取 `level`、`msg`、`ts`、`trace_id`/`request_id`。
- 兼容 `klog` 格式（`I1117` / `W1117` / `E1117` / `F1117`）及普通文本关键词级别推断。
- 自动将缩进堆栈（Java `at ...` / `Caused by:`、Go `goroutine ...` / `\t`、Python `Traceback`）折叠归并到上一条日志的 `stackLines` 中。

### 5.2 前端过滤与交互 (`src/App.tsx`)
- **多条件组合**：关键词（支持正则 `.*` 与大小写 `Aa`）+ 排除词 (`-v`) + 级别多选 + JSON 字段精确过滤（`=` / `!=`）+ 直方图时间窗口。
- **上下文模式 (`±3 行`)**：开启后以匹配命中的行索引为中心向前后各扩展 3 行，非直接命中的上下文行在 `LogViewport` 中自动降透明度展示。
- **Live Tail**：
  - `sandbox` 模式下每 `1.4s` 生成一条模拟实时日志。
  - `k8s-api` 模式下每 `2.5s` 轮询拉取最新日志（单容器模式且非 `--previous` 时可用）。
  - 视口向上滚动时自动暂停跟随，并在底部状态栏显示新增日志数与“回到底部”按钮。

### 5.3 UI 与样式规范（后续修改请保持一致）
- **Tailwind v4 暗色模式**：`src/index.css` 已声明 `@custom-variant dark (&:where(.dark, .dark *));`，所有新增组件的背景、边框、文字均需提供完整 `dark:*` 配对类。
- **无胶囊徽标与无粗左边框**：状态标签、重启次数、日志级别统一使用无圆角胶囊边框的纯文本/等宽对齐列；错误行高亮采用整行微弱背景着色，不使用 `border-l-4` 竖条。
- **等宽数字对齐**：行号、时间戳、统计计数均保持 `font-mono` (`tabular-nums`)。

---

## 6. 后续本地扩展建议

本地 Agent 接手后，可按实际生产需求优先推进以下增强项：

1. **K8s 流式 Watch (`follow=true` + SSE / WebSocket)**
   - 当前 `k8s-api` 的 Live Tail 采用 `2.5s` 轮询 `tailLines`；可在 `server.ts` 中新增 `GET /api/k8s/logs/stream`（Server-Sent Events），向上游请求 `?follow=true&timestamps=true` 并逐行 `res.write` 推送至前端 `EventSource`。
2. **完整 YAML 解析器（替换正则提取）**
   - `server.ts` 中的 `parseSimpleKubeconfig` 目前基于 JSON 解析与 YAML 关键字段正则提取；若需支持多 Context 切换或 Exec 插件（如 `aws eks get-token` / `gke-gcloud-auth-plugin`），建议引入 `js-yaml` 解析完整 `kubeconfig`。
3. **LogCollector / Agent 主动上报接收端（如需独立采集器推送）**
   - 若后续需要接收来自集群内 FluentBit / Vector / Filebeat 的日志推送，可在 `server.ts` 新增 `POST /api/ingest/logs` 写入环形内存缓冲区或时序存储，并在 `ClusterConfig['mode']` 中扩展 `'agent-push'` 模式。
4. **虚拟列表渲染 (`@tanstack/react-virtual`)**
   - 当前直接渲染过滤后的 `LogEntry[]`（Live Tail 上限截断为 3000 行）；若需单次流畅查看 50,000+ 行导入日志，建议在 `LogViewport.tsx` 引入虚拟滚动。
