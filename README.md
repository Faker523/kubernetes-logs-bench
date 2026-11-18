# KubeLog Workbench

一个轻量、高效的 Kubernetes 日志查看与结构化分析工作台，基于 **React 19 + TypeScript + Tailwind CSS v4 + Express** 构建。

## 项目概述

- **三种数据源模式**：
  - **实时 K8s 集群**：通过 Express 后端代理连接 Kubernetes API Server，支持粘贴/上传 `kubeconfig` 自动解析、Token/mTLS 认证以及宿主机 `~/.kube/config` 自动检测。
  - **本地日志导入**：支持上传 `.log` / `.txt` / `.json` 文件或直接粘贴 `kubectl logs` 输出进行离线分析。
  - **内置演示集群**：自带多命名空间与多容器 Pod 样本数据，支持模拟实时日志流，开箱即用。
- **核心分析能力**：
  - **多 Pod 聚合追踪**：支持按 Namespace、Pod、Container 浏览（含 `--previous` 重启前日志）及多容器合并时间线查看。
  - **高效检索与过滤**：支持关键词、正则表达式（`.*`）、排除词（`-v`）、级别过滤、匹配上下文（±3 行）以及 JSON 结构化字段提取与一键过滤。
  - **直方图趋势分析**：点击顶部时间分布直方图任意区间，自动计算该时段各日志级别占比变化，并与全量基线对比给出突变提醒。
  - **日志模式检测**：利用正则聚合器自动将相似日志归类为模板，支持一键屏蔽干扰日志或聚焦单类模式。
  - **实时追踪与导出**：支持 Live Tail 自动滚屏、深浅色主题切换，以及导出为 `.log` 或 `.json` 文件。

## 本地开发与构建

环境要求：**Node.js >= 20**（推荐 Node 22），默认监听端口 **`3000`**（可通过 `PORT` 环境变量修改）。

```bash
# 安装依赖
npm install

# 启动开发环境（tsx 运行 Express + Vite 中间件）
npm run dev

# TypeScript 类型检查
npm run lint

# 构建前端静态产物（输出至 dist/）
npm run build

# 生产环境启动（需先执行 npm run build）
NODE_ENV=production npm start
```

> 若本地 Node 版本低于 22，生产环境可使用 `NODE_ENV=production npx tsx server.ts` 启动。

## 容器镜像构建（Docker）

项目根目录已提供多阶段构建的 `Dockerfile` 与 `.dockerignore`：

```bash
# 构建镜像
docker build -t kubelog-workbench:latest .

# 启动容器
docker run -d --name kubelog -p 3000:3000 kubelog-workbench:latest

# 可选：挂载宿主机 kubeconfig（只读）
docker run -d --name kubelog -p 3000:3000 \
  -v ~/.kube/config:/home/node/.kube/config:ro \
  -e KUBECONFIG=/home/node/.kube/config \
  kubelog-workbench:latest
```

## 更多文档

- 架构说明与本地开发交接详情请参见 [`doc/local-agent-handoff.md`](./doc/local-agent-handoff.md)。
