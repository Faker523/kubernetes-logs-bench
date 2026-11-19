import type { ClusterConfig, PodInfo } from '../types/k8s';

interface K8sProxyConfig {
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
}

function buildClusterConfig(cluster: Partial<ClusterConfig>): K8sProxyConfig {
  return {
    apiServer: cluster.apiServer?.trim() || undefined,
    token: cluster.token?.trim() || undefined,
    caCert: cluster.caCert?.trim() || undefined,
    clientCert: cluster.clientCert?.trim() || undefined,
    clientKey: cluster.clientKey?.trim() || undefined,
    insecureTls: Boolean(cluster.insecureTls),
  };
}

async function safeReadJson<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: `服务端返回非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`,
    } as T;
  }
}

export async function testK8sConnection(config: Partial<ClusterConfig>): Promise<{
  ok: boolean;
  gitVersion?: string;
  platform?: string;
  error?: string;
}> {
  const res = await fetch('/api/k8s/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildClusterConfig(config)),
  });
  const data = await safeReadJson<{
    ok?: boolean;
    gitVersion?: string;
    platform?: string;
    error?: string;
  }>(res);
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    ok: Boolean(data.ok),
    gitVersion: data.gitVersion,
    platform: data.platform,
    error: data.error,
  };
}

export async function parseKubeconfigText(kubeconfig: string): Promise<{
  name?: string;
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
  error?: string;
}> {
  const res = await fetch('/api/k8s/kubeconfig/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kubeconfig }),
  });
  const data = await safeReadJson<{
    name?: string;
    apiServer?: string;
    token?: string;
    caCert?: string;
    clientCert?: string;
    clientKey?: string;
    insecureTls?: boolean;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error || '解析 kubeconfig 失败');
  }
  return data;
}

export async function getLocalKubeconfigStatus(): Promise<{
  hasLocalKubeconfig: boolean;
  kubeconfigReadable: boolean;
  kubeconfigPath: string | null;
  hasInCluster: boolean;
}> {
  const res = await fetch('/api/k8s/local-status');
  if (!res.ok) {
    return { hasLocalKubeconfig: false, kubeconfigReadable: false, kubeconfigPath: null, hasInCluster: false };
  }
  const data = await safeReadJson<{
    hasLocalKubeconfig?: boolean;
    kubeconfigReadable?: boolean;
    kubeconfigPath?: string | null;
    hasInCluster?: boolean;
    error?: string;
  }>(res);
  return {
    hasLocalKubeconfig: Boolean(data.hasLocalKubeconfig),
    kubeconfigReadable: Boolean(data.kubeconfigReadable),
    kubeconfigPath: data.kubeconfigPath ?? null,
    hasInCluster: Boolean(data.hasInCluster),
  };
}

export async function loadLocalKubeconfig(): Promise<{
  name?: string;
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  insecureTls?: boolean;
}> {
  const res = await fetch('/api/k8s/local-load', { method: 'POST' });
  const data = await safeReadJson<{
    name?: string;
    apiServer?: string;
    token?: string;
    caCert?: string;
    clientCert?: string;
    clientKey?: string;
    insecureTls?: boolean;
    error?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error || '加载本地 kubeconfig 失败');
  }
  return data;
}

export async function fetchNamespaces(
  cluster: ClusterConfig,
  signal?: AbortSignal
): Promise<string[]> {
  const res = await fetch('/api/k8s/namespaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: buildClusterConfig(cluster) }),
    signal,
  });
  const data = await safeReadJson<{ namespaces?: string[]; error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || `获取命名空间失败 (${res.status})`);
  }
  return data.namespaces || [];
}

export async function fetchPods(
  cluster: ClusterConfig,
  namespace: string,
  signal?: AbortSignal
): Promise<PodInfo[]> {
  const res = await fetch('/api/k8s/pods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: buildClusterConfig(cluster),
      namespace,
    }),
    signal,
  });
  const data = await safeReadJson<{ pods?: PodInfo[]; error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || `获取 Pod 列表失败 (${res.status})`);
  }
  return data.pods || [];
}

export async function fetchPodLogs(
  cluster: ClusterConfig,
  params: {
    namespace: string;
    pod: string;
    container: string;
    tailLines: number;
    previous: boolean;
    sinceSeconds?: number;
  },
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('/api/k8s/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: buildClusterConfig(cluster),
      namespace: params.namespace,
      pod: params.pod,
      container: params.container,
      tailLines: params.tailLines || 500,
      previous: params.previous,
      sinceSeconds: params.sinceSeconds,
    }),
    signal,
  });
  const data = await safeReadJson<{ raw?: string; error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || `获取日志失败 (${res.status})`);
  }
  return data.raw || '';
}
