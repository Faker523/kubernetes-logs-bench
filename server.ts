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

const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const httpsAgentCache = new Map<string, https.Agent>();

function getHttpsAgent(config: K8sRequestConfig): https.Agent {
  const key = `${Boolean(config.insecureTls)}|${config.caCert?.trim() || ''}|${config.clientCert?.trim() || ''}|${config.clientKey?.trim() || ''}`;
  const existing = httpsAgentCache.get(key);
  if (existing) return existing;

  if (httpsAgentCache.size >= 20) {
    const oldestKey = httpsAgentCache.keys().next().value;
    if (oldestKey !== undefined) {
      httpsAgentCache.get(oldestKey)?.destroy();
      httpsAgentCache.delete(oldestKey);
    }
  }

  const agentOptions: https.AgentOptions = {
    keepAlive: true,
    maxSockets: 16,
    rejectUnauthorized: !config.insecureTls,
  };
  if (config.caCert?.trim()) {
    agentOptions.ca = config.caCert.trim();
  }
  if (config.clientCert?.trim() && config.clientKey?.trim()) {
    agentOptions.cert = config.clientCert.trim();
    agentOptions.key = config.clientKey.trim();
  }
  const agent = new https.Agent(agentOptions);
  httpsAgentCache.set(key, agent);
  return agent;
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
      hostname: targetUrl.hostname.replace(/^\[|\]$/g, ''),
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      headers,
      timeout: 30000,
      agent: isHttps ? getHttpsAgent(config) : keepAliveHttpAgent,
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

    const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
    const transport = isHttps ? https : http;
    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let abortedForSize = false;

      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          abortedForSize = true;
          req.destroy(new Error('Kubernetes API 响应体积超过 25MB 限制，请调小拉取行数 (tailLines)'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (abortedForSize) return;
        resolve({
          status: res.statusCode ?? 500,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('连接 Kubernetes API Server 超时 (30s)'));
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

function extractConfigFromRequest(req: express.Request): K8sRequestConfig | null {
  const bodyConfig = (req.body as { config?: K8sRequestConfig } | undefined)?.config;
  if (bodyConfig?.apiServer?.trim()) {
    return {
      apiServer: bodyConfig.apiServer.trim(),
      token: bodyConfig.token?.trim() || undefined,
      insecureTls: Boolean(bodyConfig.insecureTls),
      caCert: bodyConfig.caCert?.trim() || undefined,
      clientCert: bodyConfig.clientCert?.trim() || undefined,
      clientKey: bodyConfig.clientKey?.trim() || undefined,
    };
  }
  return extractConfigFromHeaders(req);
}

function formatK8sError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { kind?: string; message?: string; reason?: string };
    if (parsed?.kind === 'Status' && parsed.message) {
      return `HTTP ${status} (${parsed.reason || 'Error'}): ${parsed.message}`;
    }
  } catch {
    // Not JSON Status
  }
  return body.slice(0, 600);
}

function splitYamlListItems(sectionText: string): Array<{ name?: string; body: string }> {
  const lines = sectionText.split(/\r?\n/);
  const items: Array<{ name?: string; body: string }> = [];
  let currentLines: string[] = [];
  let baseIndent = -1;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      if (currentLines.length > 0) currentLines.push(line);
      continue;
    }
    const itemMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (itemMatch && (baseIndent === -1 || itemMatch[1].length <= baseIndent)) {
      if (currentLines.length > 0) {
        const body = currentLines.join('\n');
        const nameMatch = body.match(/(?:^|\n)\s*-?\s*name:\s*["']?([^"'\r\n#]+)["']?/);
        items.push({ name: nameMatch?.[1]?.trim(), body });
      }
      baseIndent = itemMatch[1].length;
      currentLines = [line];
    } else if (currentLines.length > 0) {
      currentLines.push(line);
    }
  }
  if (currentLines.length > 0) {
    const body = currentLines.join('\n');
    const nameMatch = body.match(/(?:^|\n)\s*-?\s*name:\s*["']?([^"'\r\n#]+)["']?/);
    items.push({ name: nameMatch?.[1]?.trim(), body });
  }
  return items;
}

function extractYamlSection(raw: string, sectionName: string): string {
  const re = new RegExp(`^${sectionName}:\\s*\\r?\\n([\\s\\S]*?)(?=^[a-zA-Z][a-zA-Z0-9_-]*:|(?![\\s\\S]))`, 'm');
  const m = raw.match(re);
  return m?.[1] || '';
}

function parseSimpleKubeconfig(raw: string, resolveLocalFiles = false): {
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

  const readFileIfAllowed = (filePath?: string): string | undefined => {
    if (!resolveLocalFiles || !filePath) return undefined;
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(path.dirname(process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config')), filePath);
    try {
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, 'utf8');
      }
    } catch {
      // Ignore unreadable file
    }
    return undefined;
  };

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
      } else if (cluster?.cluster?.['certificate-authority']) {
        result.caCert = readFileIfAllowed(cluster.cluster['certificate-authority']);
      }
      if (user?.user?.token) {
        result.token = user.user.token;
      } else if (user?.user?.tokenFile) {
        result.token = readFileIfAllowed(user.user.tokenFile)?.trim();
      }
      if (user?.user?.['client-certificate-data']) {
        result.clientCert = Buffer.from(user.user['client-certificate-data'], 'base64').toString('utf8');
      } else if (user?.user?.['client-certificate']) {
        result.clientCert = readFileIfAllowed(user.user['client-certificate']);
      }
      if (user?.user?.['client-key-data']) {
        result.clientKey = Buffer.from(user.user['client-key-data'], 'base64').toString('utf8');
      } else if (user?.user?.['client-key']) {
        result.clientKey = readFileIfAllowed(user.user['client-key']);
      }
      return result;
    } catch {
      // Fall through to YAML extraction
    }
  }

  const getField = (source: string, regex: RegExp) => {
    const m = source.match(regex);
    return m?.[1]?.trim().replace(/^["']|["']$/g, '');
  };

  const extractB64Field = (source: string, field: string): string | undefined => {
    const re = new RegExp(`${field}:\\s*["']?([A-Za-z0-9+/=_\\-\\s]+?)["']?(?:\\r?\\n|$)`, 'm');
    const m = source.match(re);
    if (!m?.[1]) return undefined;
    const cleaned = m[1].replace(/\s+/g, '');
    if (!cleaned) return undefined;
    try {
      return Buffer.from(cleaned, 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  };

  const currentCtxName = getField(raw, /^current-context:\s*([^\r\n#]+)/m);
  const contexts = splitYamlListItems(extractYamlSection(raw, 'contexts'));
  const clusters = splitYamlListItems(extractYamlSection(raw, 'clusters'));
  const users = splitYamlListItems(extractYamlSection(raw, 'users'));

  const activeCtx =
    (currentCtxName ? contexts.find((c) => c.name === currentCtxName) : undefined) || contexts[0];
  const targetClusterName = activeCtx ? getField(activeCtx.body, /^\s*cluster:\s*([^\r\n#]+)/m) : undefined;
  const targetUserName = activeCtx ? getField(activeCtx.body, /^\s*user:\s*([^\r\n#]+)/m) : undefined;

  const activeCluster =
    (targetClusterName ? clusters.find((c) => c.name === targetClusterName) : undefined) || clusters[0];
  const activeUser =
    (targetUserName ? users.find((u) => u.name === targetUserName) : undefined) || users[0];

  const clusterScope = activeCluster?.body || raw;
  const userScope = activeUser?.body || raw;

  if (currentCtxName) result.name = currentCtxName;
  else if (activeCluster?.name) result.name = activeCluster.name;

  const server = getField(clusterScope, /server:\s*["']?(https?:\/\/[^\s\r\n"']+)["']?/);
  if (server) result.apiServer = server;

  const insecure = getField(clusterScope, /insecure-skip-tls-verify:\s*["']?(true|false)["']?/i);
  if (insecure) result.insecureTls = insecure.toLowerCase() === 'true';

  const token = getField(userScope, /^\s*token:\s*([^\r\n#]+)/m);
  if (token) {
    result.token = token;
  } else {
    const tokenFile = getField(userScope, /^\s*tokenFile:\s*([^\r\n#]+)/m);
    const loadedToken = readFileIfAllowed(tokenFile)?.trim();
    if (loadedToken) result.token = loadedToken;
  }

  const caDecoded = extractB64Field(clusterScope, 'certificate-authority-data');
  if (caDecoded) {
    result.caCert = caDecoded;
  } else {
    const caPath = getField(clusterScope, /^\s*certificate-authority:\s*([^\r\n#]+)/m);
    const loadedCa = readFileIfAllowed(caPath);
    if (loadedCa) result.caCert = loadedCa;
  }

  const certDecoded = extractB64Field(userScope, 'client-certificate-data');
  if (certDecoded) {
    result.clientCert = certDecoded;
  } else {
    const certPath = getField(userScope, /^\s*client-certificate:\s*([^\r\n#]+)/m);
    const loadedCert = readFileIfAllowed(certPath);
    if (loadedCert) result.clientCert = loadedCert;
  }

  const keyDecoded = extractB64Field(userScope, 'client-key-data');
  if (keyDecoded) {
    result.clientKey = keyDecoded;
  } else {
    const keyPath = getField(userScope, /^\s*client-key:\s*([^\r\n#]+)/m);
    const loadedKey = readFileIfAllowed(keyPath);
    if (loadedKey) result.clientKey = loadedKey;
  }

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
    let kubeconfigReadable = false;
    if (hasLocalKubeconfig) {
      try {
        fs.accessSync(kubeconfigPath, fs.constants.R_OK);
        kubeconfigReadable = true;
      } catch {
        kubeconfigReadable = false;
      }
    }
    const hasInCluster = fs.existsSync(inClusterToken);
    res.json({
      hasLocalKubeconfig,
      kubeconfigReadable,
      kubeconfigPath: hasLocalKubeconfig ? kubeconfigPath : null,
      hasInCluster,
    });
  });

  // Read local ~/.kube/config or in-cluster config if explicitly requested by user
  app.post('/api/k8s/local-load', (_req, res) => {
    try {
      const kubeconfigPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
      if (fs.existsSync(kubeconfigPath)) {
        try {
          fs.accessSync(kubeconfigPath, fs.constants.R_OK);
        } catch {
          res.status(403).json({
            error: `无权读取 ${kubeconfigPath}（宿主机 kubeconfig 通常为 0600 权限，容器内 uid=1000 无法读取）。请直接将 kubeconfig 内容粘贴到下方“快速解析”框，或使用 --user $(id -u):$(id -g) 启动容器。`,
          });
          return;
        }
        const raw = fs.readFileSync(kubeconfigPath, 'utf8');
        const parsed = parseSimpleKubeconfig(raw, true);
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

  // Test K8s API connectivity and verify authentication
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

      // Verify authenticated API access (since /version often allows system:anonymous)
      const nsResp = await k8sRequest(config, '/api/v1/namespaces?limit=1');
      if (nsResp.status === 401 || (nsResp.status === 403 && nsResp.body.includes('system:anonymous'))) {
        const isAnon = nsResp.body.includes('system:anonymous');
        res.status(nsResp.status).json({
          error: isAnon
            ? '认证未生效，当前以匿名用户 (system:anonymous) 访问被集群拒绝。请确认已填写 Bearer Token，或已正确解析/配置 mTLS 客户端证书 (Client Cert & Key)。'
            : `集群鉴权失败: ${formatK8sError(nsResp.status, nsResp.body)}`,
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
  const handleListNamespaces: express.RequestHandler = async (req, res) => {
    const config = extractConfigFromRequest(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    try {
      const resp = await k8sRequest(config, '/api/v1/namespaces');
      if (resp.status >= 400) {
        res.status(resp.status).json({ error: formatK8sError(resp.status, resp.body) });
        return;
      }
      const data = JSON.parse(resp.body) as { items?: Array<{ metadata?: { name?: string } }> };
      const namespaces = (data.items || [])
        .map((item) => item.metadata?.name)
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b));
      res.json({ namespaces });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '获取命名空间失败' });
    }
  };
  app.get('/api/k8s/namespaces', handleListNamespaces);
  app.post('/api/k8s/namespaces', handleListNamespaces);

  // List Pods (with pagination & RBAC per-namespace fallback for __all__)
  const handleListPods: express.RequestHandler = async (req, res) => {
    const config = extractConfigFromRequest(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    const bodyNs = (req.body as { namespace?: string } | undefined)?.namespace;
    const namespace =
      typeof bodyNs === 'string'
        ? bodyNs
        : typeof req.query.namespace === 'string'
          ? req.query.namespace
          : '';
    const isAllNamespaces = !namespace || namespace === '__all__';
    const baseApiPath = isAllNamespaces
      ? '/api/v1/pods'
      : `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`;

    interface RawPodItem {
      metadata?: { name?: string; namespace?: string; creationTimestamp?: string; labels?: Record<string, string> };
      spec?: { nodeName?: string; containers?: Array<{ name: string; image?: string }>; initContainers?: Array<{ name: string; image?: string }> };
      status?: {
        phase?: string;
        podIP?: string;
        containerStatuses?: Array<{ name: string; ready?: boolean; restartCount?: number; state?: Record<string, { reason?: string }> }>;
        initContainerStatuses?: Array<{ name: string; ready?: boolean; restartCount?: number; state?: Record<string, { reason?: string }> }>;
      };
    }

    interface PodListPayload {
      metadata?: { continue?: string };
      items?: RawPodItem[];
    }

    const fetchPaginatedPods = async (
      apiPath: string
    ): Promise<{ ok: true; items: RawPodItem[] } | { ok: false; status: number; body: string }> => {
      const allItems: RawPodItem[] = [];
      let continueToken = '';
      let page = 0;

      while (page < 40) {
        page += 1;
        const qs = new URLSearchParams({ limit: '500' });
        if (continueToken) qs.set('continue', continueToken);
        const resp = await k8sRequest(config, `${apiPath}?${qs.toString()}`);

        if (resp.status === 410 && continueToken) {
          // Continue token expired mid-pagination; fall back to unpaginated single call
          const fallbackResp = await k8sRequest(config, apiPath);
          if (fallbackResp.status >= 400) {
            return { ok: false, status: fallbackResp.status, body: fallbackResp.body };
          }
          const fallbackData = JSON.parse(fallbackResp.body) as PodListPayload;
          return { ok: true, items: fallbackData.items || [] };
        }

        if (resp.status >= 400) {
          return { ok: false, status: resp.status, body: resp.body };
        }

        const data = JSON.parse(resp.body) as PodListPayload;
        if (Array.isArray(data.items)) {
          allItems.push(...data.items);
        }

        const nextContinue = data.metadata?.continue;
        if (!nextContinue) break;
        continueToken = nextContinue;
      }

      return { ok: true, items: allItems };
    };

    try {
      let result = await fetchPaginatedPods(baseApiPath);

      // If cluster-wide /api/v1/pods is forbidden by RBAC, try listing per-namespace
      if (!result.ok && result.status === 403 && isAllNamespaces) {
        const nsResp = await k8sRequest(config, '/api/v1/namespaces');
        if (nsResp.status < 400) {
          const nsData = JSON.parse(nsResp.body) as { items?: Array<{ metadata?: { name?: string } }> };
          const nsNames = (nsData.items || [])
            .map((item) => item.metadata?.name)
            .filter((name): name is string => Boolean(name));

          if (nsNames.length > 0) {
            const collected: RawPodItem[] = [];
            const concurrency = 8;
            for (let i = 0; i < nsNames.length; i += concurrency) {
              const batch = nsNames.slice(i, i + concurrency);
              const batchResults = await Promise.all(
                batch.map((nsName) =>
                  fetchPaginatedPods(`/api/v1/namespaces/${encodeURIComponent(nsName)}/pods`).catch(() => ({
                    ok: false as const,
                    status: 500,
                    body: '',
                  }))
                )
              );
              for (const r of batchResults) {
                if (r.ok) collected.push(...r.items);
              }
            }
            if (collected.length > 0) {
              result = { ok: true, items: collected };
            }
          }
        }
      }

      if (!result.ok) {
        res.status(result.status).json({ error: formatK8sError(result.status, result.body) });
        return;
      }

      const dedupedMap = new Map<string, RawPodItem>();
      for (const item of result.items) {
        const ns = item.metadata?.namespace || 'default';
        const name = item.metadata?.name || 'unknown';
        dedupedMap.set(`${ns}/${name}`, item);
      }

      const pods = Array.from(dedupedMap.values())
        .map((item) => {
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
        })
        .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));

      res.json({ pods });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '获取 Pod 列表失败' });
    }
  };
  app.get('/api/k8s/pods', handleListPods);
  app.post('/api/k8s/pods', handleListPods);

  // Fetch Pod Container Logs
  const handleFetchLogs: express.RequestHandler = async (req, res) => {
    const config = extractConfigFromRequest(req);
    if (!config) {
      res.status(400).json({ error: '缺少集群连接配置' });
      return;
    }
    const body = (req.body as {
      namespace?: string;
      pod?: string;
      container?: string;
      tailLines?: number | string;
      previous?: boolean | string;
      sinceSeconds?: number | string;
    } | undefined) || {};

    const namespace = String(body.namespace ?? req.query.namespace ?? 'default');
    const pod = String(body.pod ?? req.query.pod ?? '');
    const container = String(body.container ?? req.query.container ?? '');
    const tailLines = String(body.tailLines ?? req.query.tailLines ?? '500');
    const previous = body.previous === true || body.previous === 'true' || req.query.previous === 'true';
    const sinceVal = body.sinceSeconds ?? req.query.sinceSeconds;
    const sinceSeconds = sinceVal ? String(sinceVal) : '';

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
        res.status(resp.status).json({ error: formatK8sError(resp.status, resp.body) });
        return;
      }
      res.json({ raw: resp.body });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : '拉取日志失败' });
    }
  };
  app.get('/api/k8s/logs', handleFetchLogs);
  app.post('/api/k8s/logs', handleFetchLogs);

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
