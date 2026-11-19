# KubeLog Workbench 集群对接手册

本文档介绍如何将 **KubeLog Workbench** 接入真实 Kubernetes 集群，涵盖最小只读 RBAC 权限配置、四种常见对接方式（页面解析 kubeconfig、手动配置 Token/mTLS、Docker 挂载宿主机配置、集群内 In-Cluster 部署）、主流 K8s 发行版注意事项及常见故障排查。

---

## 一、工作原理与前置条件

### 1. 网络与代理架构
```text
浏览器前端  ──(HTTP /api/k8s/*)──▶  KubeLog 服务端 (Node/Express)  ──(HTTPS/mTLS)──▶  Kubernetes API Server
```

- 所有发往 Kubernetes API Server 的请求均由 **KubeLog 后端服务** 代理转发，避免了浏览器跨域（CORS）和自签名证书拦截问题。
- 因此，**运行 KubeLog 服务的宿主机或容器必须能够网络直达目标集群的 API Server（通常为 `6443` 端口）**。
- 在页面勾选 **「记住连接配置」** 后，集群连接信息会保存在当前浏览器本地存储（`localStorage`）中，刷新页面自动恢复，最多支持保存 10 个集群快速切换。

### 2. 最小 RBAC 权限要求
KubeLog 仅执行只读查询，不会对集群做任何变更操作，所需最小权限如下：

| API Group | Resource | Verbs | 用途 |
| --- | --- | --- | --- |
| `""` (core) | `namespaces` | `get`, `list` | 列出可选命名空间（若无此权限，仍可查看有权限的 Pod） |
| `""` (core) | `pods` | `get`, `list` | 获取 Pod 列表、容器状态、节点名（`spec.nodeName`）及重启次数 |
| `""` (core) | `pods/log` | `get` | 拉取实时日志、历史崩溃日志（`--previous`）与多容器聚合日志 |

---

## 二、准备只读 ServiceAccount 与 Token（推荐）

生产环境强烈建议为 KubeLog 创建独立的**只读 ServiceAccount**，避免直接使用集群管理员（`cluster-admin`）证书。

### 场景 A：授权查看全集群命名空间与 Pod 日志

将以下内容保存为 `kubelog-readonly-rbac.yaml` 并执行 `kubectl apply -f kubelog-readonly-rbac.yaml`：

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kubelog-reader
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kubelog-reader-role
rules:
  - apiGroups: [""]
    resources: ["namespaces", "pods", "pods/log"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubelog-reader-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kubelog-reader-role
subjects:
  - kind: ServiceAccount
    name: kubelog-reader
    namespace: kube-system
---
# 适用于 Kubernetes 1.24+：显式创建长期有效的 ServiceAccount Token Secret
apiVersion: v1
kind: Secret
metadata:
  name: kubelog-reader-token
  namespace: kube-system
  annotations:
    kubernetes.io/service-account.name: kubelog-reader
type: kubernetes.io/service-account-token
```

### 场景 B：仅授权查看指定单个命名空间（如 `prod-ecommerce`）

如果只需要让运维/开发查看特定业务命名空间的日志，可使用 `Role + RoleBinding` 替代全集群授权：

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kubelog-ns-reader
  namespace: prod-ecommerce
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: kubelog-ns-reader-role
  namespace: prod-ecommerce
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: kubelog-ns-reader-binding
  namespace: prod-ecommerce
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: kubelog-ns-reader-role
subjects:
  - kind: ServiceAccount
    name: kubelog-ns-reader
    namespace: prod-ecommerce
---
apiVersion: v1
kind: Secret
metadata:
  name: kubelog-ns-reader-token
  namespace: prod-ecommerce
  annotations:
    kubernetes.io/service-account.name: kubelog-ns-reader
type: kubernetes.io/service-account-token
```

### 提取对接所需的 API Server 与 Token

```bash
# 1. 获取当前集群 API Server 地址
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}{"\n"}'

# 2. 获取长期 Bearer Token（对应上方 Secret）
kubectl get secret kubelog-reader-token -n kube-system -o jsonpath='{.data.token}' | base64 -d && echo

# （可选）如果不创建 Secret，也可签发短期 Token（如有效期 24 小时，K8s 1.24+ 支持）
kubectl create token kubelog-reader -n kube-system --duration=24h

# 3. （可选）如需开启严格 TLS 校验，提取集群 CA 证书（PEM 格式）
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d
```

---

## 三、四种集群对接方式

点击页面左上角集群名称或右上角连接入口，打开 **「配置数据源与集群连接」** 弹窗，切换到 **「连接实时 K8s 集群」** 标签页。

### 方式一：粘贴或上传 kubeconfig 快速解析（最快捷）

1. 在本地终端生成包含内联证书的扁平化 kubeconfig（避免证书只写了本机文件路径）：
   ```bash
   kubectl config view --raw --flatten --minify
   ```
2. 在弹窗的 **「快速解析 kubeconfig (可选)」** 区域，点击 **「选择 kubeconfig 文件」** 上传，或直接将 YAML/JSON 内容粘贴到输入框并点击 **「解析填充」**。
3. 系统会自动提取当前 `current-context` 对应的：
   - 集群名称与 `API Server` 地址
   - `Bearer Token` 或 `mTLS 客户端证书`（`client-certificate-data` / `client-key-data`）
   - `CA 证书`（`certificate-authority-data`）及 `insecure-skip-tls-verify` 配置
4. 确认解析提示成功后，点击 **「测试并连接」** 完成对接。

> **注意**：若 kubeconfig 使用了 `exec:` 或 `auth-provider:` 动态插件（常见于 AWS EKS、GKE、OIDC 登录），浏览器上传无法执行本地外部 CLI 命令，请改用 **方式二** 获取并填写临时或只读 ServiceAccount Bearer Token。

---

### 方式二：手动填写 API Server + Bearer Token / mTLS 证书

1. **集群名称**：自定义标识名称（如 `prod-cn-east`）。
2. **API Server 地址**：填写完整协议、地址与端口，例如 `https://10.0.0.10:6443`（无需末尾斜杠）。
3. **鉴权方式（二选一）**：
   - **Bearer Token**：将第二节提取的 ServiceAccount Token 粘贴到 `Bearer Token` 输入框。
   - **mTLS 客户端证书**：点击 **「配置 CA / mTLS 客户端证书」** 展开高级区，填入 PEM 格式的 `Client Cert`（`-----BEGIN CERTIFICATE-----`）与 `Client Key`（`-----BEGIN RSA PRIVATE KEY-----`）。
4. **TLS 证书校验**：
   - 内网自签名证书环境，可勾选 **「跳过 TLS 证书校验 (insecure-skip-tls-verify)」**。
   - 如需严格校验证书链，取消勾选并在高级区填入 PEM 格式的 **CA 证书**。
5. 勾选 **「记住连接配置」**，点击 **「测试并连接」**。

---

### 方式三：Docker 部署时挂载宿主机 `~/.kube/config` 一键载入

通过 Docker 运行 KubeLog 时，可将宿主机的 `~/.kube/config` 只读挂载进容器，启动后在连接弹窗顶部会出现 **「检测到本地 kubeconfig → 一键载入」** 提示。

```bash
docker run -d \
  --name kubelog-workbench \
  --restart unless-stopped \
  -p 3000:3000 \
  --user "$(id -u):$(id -g)" \
  -v "$HOME/.kube/config:/tmp/kubeconfig:ro" \
  -e KUBECONFIG=/tmp/kubeconfig \
  <你的镜像名>:<标签>
```

> **重要提示**：
> 1. 宿主机 `~/.kube/config` 权限通常为 `0600`（仅属主可读），而镜像默认以非 root 用户（`uid=1000`）运行。**务必加上 `--user "$(id -u):$(id -g)"`**，否则页面会提示 `容器当前用户 (uid=1000) 无读取权限`。
> 2. 若 kubeconfig 内使用 `certificate-authority` / `client-certificate` 文件路径引用宿主机证书（非 `*-data` Base64 内联），请先用 `kubectl config view --raw --flatten > /tmp/flat-kubeconfig` 扁平化后再挂载。

---

### 方式四：部署在 Kubernetes 集群内部（In-Cluster 模式）

将 KubeLog 直接以 Pod 形式部署到目标集群内并绑定只读 `ServiceAccount`，即可通过集群内服务发现自动接入，无需手动维护外部证书或暴露公网 6443 端口。

参考部署清单（假设已应用第二节的 `kubelog-reader` RBAC）：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubelog-workbench
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kubelog-workbench
  template:
    metadata:
      labels:
        app: kubelog-workbench
    spec:
      serviceAccountName: kubelog-reader
      containers:
        - name: kubelog
          image: <你的镜像名>:<标签>
          ports:
            - containerPort: 3000
          env:
            # （可选）如需启用 AI 根因诊断与问答功能，通过 Secret 注入密钥
            - name: GEMINI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: kubelog-ai-secret
                  key: GEMINI_API_KEY
                  optional: true
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: kubelog-workbench
  namespace: kube-system
spec:
  type: NodePort # 或改为 ClusterIP + Ingress
  selector:
    app: kubelog-workbench
  ports:
    - port: 3000
      targetPort: 3000
```

部署完成后访问 KubeLog 页面：
1. 打开 **「配置数据源与集群连接」** 弹窗；
2. 顶部将自动提示 **「检测到当前运行环境存在 In-Cluster ServiceAccount 凭据」**；
3. 点击 **「一键载入」**（自动填充 `https://kubernetes.default.svc:443`、Pod 内 Token 与 CA 证书），再点击 **「测试并连接」** 即可。

---

## 四、常见 Kubernetes 发行版与云厂商对接提示

### 1. kubeadm / K3s / Rancher / 自建机房集群
- **K3s**：默认 `/etc/rancher/k3s/k3s.yaml` 中的 `server` 为 `https://127.0.0.1:6443`。如果 KubeLog 运行在 Docker 容器中，请将 `127.0.0.1` 替换为 K3s 节点的实际内网 IP（如 `https://192.168.1.10:6443`），或启动容器时使用 `--network host`。
- **Rancher 下游集群**：直接从 Rancher 控制台下载的 kubeconfig 包含 Bearer Token 与 API 代理地址，直接粘贴到「快速解析」即可使用。

### 2. Kind / Minikube / Docker Desktop 本地集群
- 本地集群的 kubeconfig 常指向 `https://127.0.0.1:<随机端口>`。
- 若 KubeLog 以 Docker 容器运行：
  - Linux 可使用 `--network host`；
  - macOS / Windows 可将 `127.0.0.1` 替换为 `host.docker.internal` 并勾选 **跳过 TLS 证书校验**。

### 3. 公有云托管集群（ACK / TKE / CCE / EKS / GKE / AKS）
- **阿里云 ACK / 腾讯云 TKE / 华为云 CCE**：在控制台下载的静态 kubeconfig（含 `client-certificate-data` 与 `client-key-data`）可直接上传或粘贴解析；若选择内网连接地址，需确保 KubeLog 部署在同一 VPC 内。
- **AWS EKS / GKE / AKS**：本地默认 kubeconfig 通常依赖 `exec` 插件（`aws eks get-token` / `gke-gcloud-auth-plugin`）。建议按 **第二节** 创建只读 ServiceAccount 并获取 Token 对接，或以 **方式四** 部署至集群内部。

---

## 五、可选：启用 AI 日志诊断功能

若需使用右侧 **「AI 诊断」**（根因分析、单条日志与堆栈解读、上下文多轮问答，发送前自动脱敏 Token/密钥/IP），只需在服务端注入 `GEMINI_API_KEY` 环境变量即可（前端无需填写任何密钥）：

```bash
# Docker 启动示例
docker run -d \
  --name kubelog-workbench \
  -p 3000:3000 \
  -e GEMINI_API_KEY="你的密钥" \
  <你的镜像名>:<标签>
```

---

## 六、离线日志导入与演示模式

如果暂时无法直连生产集群 API Server，也可以在连接弹窗中切换其他数据源：
- **导入日志文件 / 文本**：支持上传最大 `25MB` 的 `.log / .txt / .json` 文件（如通过 `kubectl logs --timestamps <pod> > app.log` 导出的日志），或直接粘贴原始文本，支持完整的搜索、JSON 展开、模式聚合与 AI 分析。
- **内置演示集群**：随时可切换回内置 `prod-us-east-1` 沙箱集群体验多容器、崩溃堆栈与实时日志流。

---

## 七、常见报错与排查清单

| 报错现象 / 提示 | 常见原因 | 解决方案 |
| --- | --- | --- |
| `认证未生效，当前以匿名用户 (system:anonymous) 访问被集群拒绝` | 未填 Token，或粘贴的 kubeconfig 缺少 `token` / `client-certificate-data` | 检查是否粘贴了完整 kubeconfig；若使用 `exec` 插件请改用 ServiceAccount Bearer Token |
| `HTTP 403 Forbidden: pods is forbidden` | 当前凭据缺少 `pods` 或 `pods/log` 的 RBAC 权限 | 按第二节为 ServiceAccount 绑定 `namespaces / pods / pods/log` 的 `get, list` 权限 |
| `检测到本地 kubeconfig，但容器当前用户 (uid=1000) 无读取权限` | 宿主机 `~/.kube/config` 权限为 `0600` | 启动容器时添加 `--user "$(id -u):$(id -g)"`，或直接在页面粘贴 kubeconfig 内容 |
| `目标地址返回的不是有效的 Kubernetes API JSON 响应` | 填错了端口或填成了 Web 控制台/Ingress 登录页地址 | 确认填写的是 Kubernetes API Server 地址（如 `https://<host>:6443`）而非 Dashboard 地址 |
| `unable to verify the first certificate` / `self-signed certificate` | 集群使用自签名 CA，且未提供 CA 证书或未跳过校验 | 勾选 **跳过 TLS 证书校验**，或在高级选项中填入集群 PEM 格式 CA 证书 |
| `ECONNREFUSED 127.0.0.1:6443` 或请求超时 | 容器内把 `127.0.0.1` 解析为容器自身，或防火墙/安全组未放通 `6443` | 改用宿主机/控制面实际内网 IP，或使用 `--network host`，并确认容器内 `curl -k https://<API_SERVER>/version` 可通 |
| 查看某个 Pod 日志返回 `400 Bad Request` / `404 Not Found` | Pod 处于 `Pending / ImagePullBackOff` 尚未启动容器，或 Pod 已被滚动重建 | 点击左侧 Pod 列表顶部刷新按钮获取最新 Pod，或检查容器状态后再查看 |
| 查看历史日志（`--previous`）提示找不到 | 该容器重启次数为 `0`，不存在上一次退出容器的日志 | 取消勾选 `--previous` 查看当前运行容器日志 |
