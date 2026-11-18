import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface K8sRequestConfig {
  apiServer: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
}

interface K8sHttpResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function k8sRequest(config: K8sRequestConfig, apiPath: string): Promise<K8sHttpResponse> {
  return new Promise((resolve, reject) => {
    let targetUrl: URL;
    try {
      const base = config.apiServer.replace(/\/+$/, '');
      targetUrl = new URL(`${base}${apiPath}`);
    } catch {
      reject(new Error('无效的 Kubernetes API Server URL'));
      return;
    }

    const isHttps = targetUrl.protocol === 'https:';
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    };
    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token.trim()}`;
    }

    const reqOptions: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers,
      timeout: 15000,
    };

    if (isHttps) {
      reqOptions.rejectUnauthorized = !config.insecureTls;
      if (config.caCert?.trim()) {
        reqOptions.ca = config.caCert.trim();
      }
      if (config.clientCert?.trim() && config.clientKey?.trim()) {
        reqOptions.cert = config.clientCert.trim();
        reqOptions.key = config.clientKey.trim();
      }
    }

    const transport = isHttps ? https : http;
    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 500,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('连接 Kubernetes API Server 超时 (15s)'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function extractConfigFromHeaders(req: express.Request): K8sRequestConfig | null {
  const apiServer = req.header('x-k8s-server');
  if (!apiServer) return null;
  const decodeOpt = (val?: string) => {
    if (!val) return undefined;
    try {
      return Buffer.from(val, 'base64').toString('utf8');
    } catch {
      return val;
    }
  };
  return {
    apiServer,
    token: req.header('x-k8s-token'),
    insecureTls: req.header('x-k8s-insecure') === 'true',
    caCert: decodeOpt(req.header('x-k8s-ca-b64')),
    clientCert: decodeOpt(req.header('x-k8s-cert-b64')),
    clientKey: decodeOpt(req.header('x-k8s-key-b64')),
  };
}

function parseSimpleKubeconfig(raw: string): {
  name?: string;
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
} {
  const result: {
    name?: string;
    apiServer?: string;
    token?: string;
    caCert?: string;
    clientCert?: string;
    clientKey?: string;
    insecureTls?: boolean;
  } = {};

  // Handle JSON kubeconfig cleanly
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const currentCtxName = parsed['current-context'];
      const ctxEntry = (parsed.contexts || []).find((c: { name: string }) => c.name === currentCtxName) || parsed.contexts?.[0];
      const clusterName = ctxEntry?.context?.cluster;
      const userName = ctxEntry?.context?.user;
      const cluster = (parsed.clusters || []).find((c: { name: string }) => c.name === clusterName) || parsed.clusters?.[0];
      const user = (parsed.users || []).find((u: { name: string }) => u.name === userName) || parsed.users?.[0];

      result.name = currentCtxName || cluster?.name;
      result.apiServer = cluster?.cluster?.server;
      result.insecureTls = Boolean(cluster?.cluster?.['insecure-skip-tls-verify']);
      if (cluster?.cluster?.['certificate-authority-data']) {
        result.caCert = Buffer.from(cluster.cluster['certificate-authority-data'], 'base64').toString('utf8');
      }
      if (user?.user?.token) {
        result.token = user.user.token;
      }
      if (user?.user?.['client-certificate-data']) {
        result.clientCert = Buffer.from(user.user['client-certificate-data'], 'base64').toString('utf8');
      }
      if (user?.user?.['client-key-data']) {
        result.clientKey = Buffer.from(user.user['client-key-data'], 'base64').toString('utf8');
      }
      return result;
    } catch {
      // Fall through to YAML line extraction
    }
  }

  const getFirstMatch = (regex: RegExp) => {
    const m = raw.match(regex);
    return m?.[1]?.trim().replace(/^["']|["']$/g, '');
  };

  const ctxName = getFirstMatch(/current-context:\s*([^\r\n]+)/);
  if (ctxName) result.name = ctxName;

  const server = getFirstMatch(/server:\s*(https?:\/\/[^\s\r\n"']+)/);
  if (server) result.apiServer = server;

  const insecure = getFirstMatch(/insecure-skip-tls-verify:\s*(true|false)/i);
  if (insecure) result.insecureTls = insecure.toLowerCase() === 'true';

  const token = getFirstMatch(/^\s*token:\s*([^\r\n#]+)/m);
  if (token) result.token = token;

  const caB64 = getFirstMatch(/certificate-authority-data:\s*([A-Za-z0-9+/=]+)/);
  if (caB64) result.caCert = Buffer.from(caB64, 'base64').toString('utf8');

  const certB64 = getFirstMatch(/client-certificate-data:\s*([A-Za-z0-9+/=]+)/);
  if (certB64) result.clientCert = Buffer.from(certB64, 'base64').toString('utf8');

  const keyB64 = getFirstMatch(/client-key-data:\s*([A-Za-z0-9+/=]+)/);
  if (keyB64) result.clientKey = Buffer.from(keyB64, 'base64').toString('utf8');

  return result;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Check if host has local kubeconfig or in-cluster SA token
  app.get('/api/k8s/local-status', (_req, res) => {
    const kubeconfigPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
    const inClusterToken = '/var/run/secrets/kubernetes.io/serviceaccount/token';
    const hasLocalKubeconfig = fs.existsSync(kubeconfigPath);
    const hasInCluster = fs.existsSync(inClusterToken);
    res.json({
      hasLocalKubeconfig,
      kubeconfigPath: hasLocalKubeconfig ? kubeconfigPath : null,
      hasInCluster,
    });
  });

  // Read local ~/.kube/config or in-cluster config if explicitly requested by user
  app.post('/api/k8s/local-load', (_req, res) => {
    try {
      const kubeconfigPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
      if (fs.existsSync(kubeconfigPath)) {
        const raw = fs.readFileSync(kubeconfigPath, 'utf8');
        const parsed = parseSimpleKubeconfig(raw);
        if (!parsed.apiServer) {
          res.status(400).json({ error: '未能从本地 kubeconfig 解析到有效的 server 地址' });
          return;
        }
        res.json(parsed);
        return;
      }

      const inClusterTokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
      const inClusterCaPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
      if (fs.existsSync(inClusterTokenPath)) {
        const token = fs.readFileSync(inClusterTokenPath, 'utf8').trim();
        const caCert = fs.existsSync(inClusterCaPath) ? fs.readFileSync(inClusterCaPath, 'utf8') : undefined;
        res.json({
          name: 'in-cluster',
          apiServer: `https://${process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc'}:${process.env.KUBERNETES_SERVICE_PORT || '443'}`,
          token,
          caCert,
        });
        return;
      }

      res.status(404).json({ error: '未在当前运行环境中检测到 ~/.kube/config 或 In-Cluster 凭据' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取本地配置失败' });
    }
  });

  // Parse pasted or uploaded kubeconfig YAML
  app.post('/api/k8s/kubeconfig/parse', (req, res) => {
    const { kubeconfig } = req.body as { kubeconfig?: string };
    if (!kubeconfig?.trim()) {
      res.status(400).json({ error: 'kubeconfig 内容不能为空' });
      return;
    }
    const parsed = parseSimpleKubeconfig(kubeconfig);
    if (!parsed.apiServer) {
      res.status(400).json({ error: '未检测到 server 字段，请确认 kubeconfig 格式正确' });
      return;
    }
    res.json(parsed);
  });

  // Test K8s API connectivity
  app.post('/api/k8s/test', async (req, res) => {
    const config = req.body as K8sRequestConfig;
    if (!config?.apiServer) {
      res.status(400).json({ error: '请填写 API Server 地址' });
      return;
    }
    try {
      const versionResp = await k8sRequest(config, '/version');
      if (versionResp.status >= 400) {
        res.status(versionResp.status).json({
          error: `集群返回 HTTP ${versionResp.status}: ${versionResp.body.slice(0, 300)}`,
        });
        return;
      }
      let versionInfo: Record<string, string> = {};
      try {
        versionInfo = JSON.parse(versionResp.body);
      } catch {
        versionInfo = {};
      }
      res.json({
        ok: true,
        gitVersion: versionInfo.gitVersion || 'unknown',
        platform: versionInfo.platform || '',
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : '无法连接到 Kubernetes API Server',
      });
    }
  });

  // List Namespaces
  app.get('/api/k8s/namespaces', async (req, res) => {
    const config = extractConfigFromHeaders(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    try {
      const resp = await k8sRequest(config, '/api/v1/namespaces');
      if (resp.status >= 400) {
        res.status(resp.status).json({ error: resp.body.slice(0, 400) });
        return;
      }
      const data = JSON.parse(resp.body) as { items?: Array<{ metadata?: { name?: string } }> };
      const namespaces = (data.items || []).map((item) => item.metadata?.name).filter(Boolean);
      res.json({ namespaces });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '获取命名空间失败' });
    }
  });

  // List Pods
  app.get('/api/k8s/pods', async (req, res) => {
    const config = extractConfigFromHeaders(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    const namespace = typeof req.query.namespace === 'string' ? req.query.namespace : '';
    const apiPath = namespace && namespace !== '__all__'
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
      : '/api/v1/pods';

    try {
      const resp = await k8sRequest(config, apiPath);
      if (resp.status >= 400) {
        res.status(resp.status).json({ error: resp.body.slice(0, 400) });
        return;
      }
      const data = JSON.parse(resp.body) as {
        items?: Array<{
          metadata?: { name?: string; namespace?: string; creationTimestamp?: string; labels?: Record<string, string> };
          spec?: { nodeName?: string; containers?: Array<{ name: string; image?: string }>; initContainers?: Array<{ name: string; image?: string }> };
          status?: {
            phase?: string;
            podIP?: string;
            containerStatuses?: Array<{ name: string; ready?: boolean; restartCount?: number; state?: Record<string, { reason?: string }> }>;
            initContainerStatuses?: Array<{ name: string; ready?: boolean; restartCount?: number; state?: Record<string, { reason?: string }> }>;
          };
        }>;
      };

      const pods = (data.items || []).map((item) => {
        const statusMap = new Map<string, { ready: boolean; restarts: number; stateReason?: string }>();
        for (const cs of item.status?.containerStatuses || []) {
          const reason = cs.state?.waiting?.reason || cs.state?.terminated?.reason || (cs.state?.running ? 'Running' : undefined);
          statusMap.set(cs.name, {
            ready: Boolean(cs.ready),
            restarts: cs.restartCount ?? 0,
            stateReason: reason,
          });
        }
        for (const cs of item.status?.initContainerStatuses || []) {
          const reason = cs.state?.waiting?.reason || cs.state?.terminated?.reason || (cs.state?.running ? 'Running' : undefined);
          statusMap.set(cs.name, {
            ready: Boolean(cs.ready),
            restarts: cs.restartCount ?? 0,
            stateReason: reason,
          });
        }

        const containers = [
          ...(item.spec?.containers || []).map((c) => {
            const st = statusMap.get(c.name);
            return {
              name: c.name,
              image: c.image || '',
              isInit: false,
              ready: st?.ready ?? false,
              restarts: st?.restarts ?? 0,
              state: st?.stateReason || 'Unknown',
            };
          }),
          ...(item.spec?.initContainers || []).map((c) => {
            const st = statusMap.get(c.name);
            return {
              name: c.name,
              image: c.image || '',
              isInit: true,
              ready: st?.ready ?? false,
              restarts: st?.restarts ?? 0,
              state: st?.stateReason || 'Initialized',
            };
          }),
        ];

        const waitingReason = item.status?.containerStatuses?.find((c) => c.state?.waiting?.reason)?.state?.waiting?.reason;
        const totalRestarts = containers.reduce((acc, c) => acc + c.restarts, 0);

        return {
          name: item.metadata?.name || 'unknown',
          namespace: item.metadata?.namespace || 'default',
          nodeName: item.spec?.nodeName || '-',
          podIP: item.status?.podIP || '-',
          phase: waitingReason || item.status?.phase || 'Unknown',
          restarts: totalRestarts,
          createdAt: item.metadata?.creationTimestamp || '',
          labels: item.metadata?.labels || {},
          containers,
        };
      });

      res.json({ pods });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '获取 Pod 列表失败' });
    }
  });

  // Fetch Pod Container Logs
  app.get('/api/k8s/logs', async (req, res) => {
    const config = extractConfigFromHeaders(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    const namespace = String(req.query.namespace || 'default');
    const pod = String(req.query.pod || '');
    const container = String(req.query.container || '');
    const tailLines = String(req.query.tailLines || '500');
    const previous = req.query.previous === 'true';
    const sinceSeconds = req.query.sinceSeconds ? String(req.query.sinceSeconds) : '';

    if (!pod) {
      res.status(400).json({ error: '缺少 pod 参数' });
      return;
    }

    const params = new URLSearchParams({
      timestamps: 'true',
      tailLines,
    });
    if (container) params.set('container', container);
    if (previous) params.set('previous', 'true');
    if (sinceSeconds) params.set('sinceSeconds', sinceSeconds);

    const apiPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?${params.toString()}`;

    try {
      const resp = await k8sRequest(config, apiPath);
      if (resp.status >= 400) {
        res.status(resp.status).json({ error: resp.body.slice(0, 400) });
        return;
      }
      res.json({ raw: resp.body });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '拉取日志失败' });
    }
  });

  // Vite middleware for dev, static files for prod
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KubeLog Workbench server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
