import type { ClusterConfig, PodInfo } from '../types/k8s';

function toBase64(val?: string): string | undefined {
  if (!val) return undefined;
  try {
    return btoa(unescape(encodeURIComponent(val)));
  } catch {
    return undefined;
  }
}

function buildClusterHeaders(cluster: ClusterConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cluster.apiServer) headers['x-k8s-server'] = cluster.apiServer;
  if (cluster.token) headers['x-k8s-token'] = cluster.token;
  if (cluster.insecureTls) headers['x-k8s-insecure'] = 'true';
  const caB64 = toBase64(cluster.caCert);
  if (caB64) headers['x-k8s-ca-b64'] = caB64;
  const certB64 = toBase64(cluster.clientCert);
  if (certB64) headers['x-k8s-cert-b64'] = certB64;
  const keyB64 = toBase64(cluster.clientKey);
  if (keyB64) headers['x-k8s-key-b64'] = keyB64;
  return headers;
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
    body: JSON.stringify({
      apiServer: config.apiServer,
      token: config.token,
      caCert: config.caCert,
      clientCert: config.clientCert,
      clientKey: config.clientKey,
      insecureTls: config.insecureTls,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return data;
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
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '解析 kubeconfig 失败');
  }
  return data;
}

export async function getLocalKubeconfigStatus(): Promise<{
  hasLocalKubeconfig: boolean;
  kubeconfigPath: string | null;
  hasInCluster: boolean;
}> {
  const res = await fetch('/api/k8s/local-status');
  if (!res.ok) {
    return { hasLocalKubeconfig: false, kubeconfigPath: null, hasInCluster: false };
  }
  return res.json();
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
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '加载本地 kubeconfig 失败');
  }
  return data;
}

export async function fetchNamespaces(cluster: ClusterConfig): Promise<string[]> {
  const res = await fetch('/api/k8s/namespaces', {
    headers: buildClusterHeaders(cluster),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `获取命名空间失败 (${res.status})`);
  }
  return data.namespaces || [];
}

export async function fetchPods(cluster: ClusterConfig, namespace: string): Promise<PodInfo[]> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  const res = await fetch(`/api/k8s/pods?${params.toString()}`, {
    headers: buildClusterHeaders(cluster),
  });
  const data = await res.json();
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
  }
): Promise<string> {
  const qs = new URLSearchParams({
    namespace: params.namespace,
    pod: params.pod,
    container: params.container,
    tailLines: String(params.tailLines || 500),
    previous: String(params.previous),
  });
  if (params.sinceSeconds) {
    qs.set('sinceSeconds', String(params.sinceSeconds));
  }
  const res = await fetch(`/api/k8s/logs?${qs.toString()}`, {
    headers: buildClusterHeaders(cluster),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `获取日志失败 (${res.status})`);
  }
  return data.raw || '';
}
