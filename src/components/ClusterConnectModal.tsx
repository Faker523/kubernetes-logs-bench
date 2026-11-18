import { CheckCircle2, FileUp, HardDrive, Server, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClusterConfig } from '../types/k8s';
import {
  getLocalKubeconfigStatus,
  loadLocalKubeconfig,
  parseKubeconfigText,
  testK8sConnection,
} from '../utils/k8sClient';

interface ClusterConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCluster: ClusterConfig;
  savedClusters: ClusterConfig[];
  onConnectK8sCluster: (config: ClusterConfig, remember?: boolean) => void;
  onDeleteSavedCluster: (clusterId: string) => void;
  onImportLogs: (payload: { name: string; rawText: string; podName: string; namespace: string; container: string }) => void;
  onSwitchToSandbox: () => void;
}

export function ClusterConnectModal({
  isOpen,
  onClose,
  activeCluster,
  savedClusters,
  onConnectK8sCluster,
  onDeleteSavedCluster,
  onImportLogs,
  onSwitchToSandbox,
}: ClusterConnectModalProps) {
  const [tab, setTab] = useState<'k8s' | 'file' | 'sandbox'>('k8s');

  // K8s form state
  const [clusterName, setClusterName] = useState(activeCluster.mode === 'k8s-api' ? activeCluster.name : 'production-k8s');
  const [apiServer, setApiServer] = useState(activeCluster.apiServer || '');
  const [token, setToken] = useState(activeCluster.token || '');
  const [caCert, setCaCert] = useState(activeCluster.caCert || '');
  const [clientCert, setClientCert] = useState(activeCluster.clientCert || '');
  const [clientKey, setClientKey] = useState(activeCluster.clientKey || '');
  const [insecureTls, setInsecureTls] = useState(activeCluster.insecureTls ?? true);
  const [rememberConnection, setRememberConnection] = useState(true);
  const [kubeconfigText, setKubeconfigText] = useState('');
  const [kubeconfigDirty, setKubeconfigDirty] = useState(false);
  const [showAdvancedTls, setShowAdvancedTls] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<{
    hasLocalKubeconfig: boolean;
    kubeconfigReadable: boolean;
    kubeconfigPath: string | null;
    hasInCluster: boolean;
  } | null>(null);

  // Import file state
  const [importName, setImportName] = useState('imported-kubectl.log');
  const [importNamespace, setImportNamespace] = useState('default');
  const [importPod, setImportPod] = useState('app-pod-0');
  const [importContainer, setImportContainer] = useState('app');
  const [importRawText, setImportRawText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTestError(null);
    setTestSuccess(null);
    setImportError(null);
    setKubeconfigDirty(false);
    if (activeCluster.mode === 'k8s-api') {
      setClusterName(activeCluster.name);
      setApiServer(activeCluster.apiServer || '');
      setToken(activeCluster.token || '');
      setCaCert(activeCluster.caCert || '');
      setClientCert(activeCluster.clientCert || '');
      setClientKey(activeCluster.clientKey || '');
      setInsecureTls(activeCluster.insecureTls ?? true);
      setShowAdvancedTls(Boolean(activeCluster.caCert || activeCluster.clientCert || activeCluster.clientKey));
    }
    getLocalKubeconfigStatus()
      .then(setLocalStatus)
      .catch(() => setLocalStatus(null));
  }, [isOpen, activeCluster]);

  if (!isOpen) return null;

  const applyParsedConfig = (parsed: {
    name?: string;
    apiServer?: string;
    token?: string;
    caCert?: string;
    clientCert?: string;
    clientKey?: string;
    insecureTls?: boolean;
  }) => {
    if (parsed.name) setClusterName(parsed.name);
    if (parsed.apiServer) setApiServer(parsed.apiServer);
    setToken(parsed.token || '');
    setCaCert(parsed.caCert || '');
    setClientCert(parsed.clientCert || '');
    setClientKey(parsed.clientKey || '');
    if (parsed.insecureTls !== undefined) setInsecureTls(parsed.insecureTls);
    if (parsed.clientCert || parsed.clientKey) {
      setShowAdvancedTls(true);
    }
    setKubeconfigDirty(false);

    const authKinds: string[] = [];
    if (parsed.token) authKinds.push('Bearer Token');
    if (parsed.clientCert && parsed.clientKey) authKinds.push('mTLS 客户端证书');
    if (parsed.caCert) authKinds.push('CA 证书');

    if (authKinds.length > 0) {
      setTestSuccess(`已解析集群地址与凭据 (${authKinds.join(' + ')})，请点击“测试并连接”。`);
    } else {
      setTestError('已提取 API Server 地址，但未在 kubeconfig 中找到 token 或 client-certificate-data / client-key-data。');
    }
    return parsed;
  };

  const handleParseKubeconfig = async (raw: string) => {
    setTestError(null);
    setTestSuccess(null);
    try {
      const parsed = await parseKubeconfigText(raw);
      return applyParsedConfig(parsed);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '解析 kubeconfig 失败');
      return null;
    }
  };

  const handleLoadLocalConfig = async () => {
    setTestError(null);
    setTestSuccess(null);
    try {
      const parsed = await loadLocalKubeconfig();
      applyParsedConfig(parsed);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '读取本地配置失败');
    }
  };

  const handleConnectK8s = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestError(null);
    setTestSuccess(null);

    let effectiveServer = apiServer.trim();
    let effectiveToken = token.trim();
    let effectiveCa = caCert.trim();
    let effectiveCert = clientCert.trim();
    let effectiveKey = clientKey.trim();
    let effectiveInsecure = insecureTls;
    let effectiveName = clusterName.trim();

    // Auto-parse kubeconfig if user pasted/edited it without clicking "解析填充"
    if (
      kubeconfigText.trim() &&
      (kubeconfigDirty || (!effectiveToken && (!effectiveCert || !effectiveKey)))
    ) {
      try {
        const parsed = await parseKubeconfigText(kubeconfigText);
        if (parsed.name) {
          effectiveName = parsed.name;
          setClusterName(parsed.name);
        }
        if (parsed.apiServer && (kubeconfigDirty || !effectiveServer)) {
          effectiveServer = parsed.apiServer;
          setApiServer(parsed.apiServer);
        }
        if (parsed.token) {
          effectiveToken = parsed.token;
          setToken(parsed.token);
        }
        if (parsed.caCert) {
          effectiveCa = parsed.caCert;
          setCaCert(parsed.caCert);
        }
        if (parsed.clientCert) {
          effectiveCert = parsed.clientCert;
          setClientCert(parsed.clientCert);
          setShowAdvancedTls(true);
        }
        if (parsed.clientKey) {
          effectiveKey = parsed.clientKey;
          setClientKey(parsed.clientKey);
          setShowAdvancedTls(true);
        }
        if (parsed.insecureTls !== undefined) {
          effectiveInsecure = parsed.insecureTls;
          setInsecureTls(parsed.insecureTls);
        }
      } catch {
        // Proceed with manual fields if kubeconfig snippet is partial
      }
    }

    if (!effectiveServer) {
      setTestError('请填写 Kubernetes API Server 地址');
      return;
    }
    setTesting(true);
    try {
      const result = await testK8sConnection({
        apiServer: effectiveServer,
        token: effectiveToken || undefined,
        caCert: effectiveCa || undefined,
        clientCert: effectiveCert || undefined,
        clientKey: effectiveKey || undefined,
        insecureTls: effectiveInsecure,
      });

      if (!result.ok) {
        setTestError(result.error || '连接失败');
        setTesting(false);
        return;
      }

      onConnectK8sCluster(
        {
          id: `k8s-${Date.now()}`,
          name: effectiveName || 'k8s-cluster',
          mode: 'k8s-api',
          apiServer: effectiveServer,
          token: effectiveToken || undefined,
          caCert: effectiveCa || undefined,
          clientCert: effectiveCert || undefined,
          clientKey: effectiveKey || undefined,
          insecureTls: effectiveInsecure,
          gitVersion: result.gitVersion,
        },
        rememberConnection
      );
      onClose();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '请求测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleFileUpload = (file: File) => {
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setImportName(file.name);
      setImportPod(file.name.replace(/\.(log|txt|json)$/i, '') || 'imported-pod');
      setImportRawText(text);
    };
    reader.onerror = () => {
      setImportError('读取文件失败');
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!importRawText.trim()) {
      setImportError('请上传日志文件或粘贴日志文本');
      return;
    }
    onImportLogs({
      name: importName.trim() || '本地日志文件',
      rawText: importRawText,
      namespace: importNamespace.trim() || 'default',
      podName: importPod.trim() || 'imported-pod',
      container: importContainer.trim() || 'app',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
        className="w-full max-w-2xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 id="connect-modal-title" className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              配置数据源与集群连接
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              连接实时 Kubernetes API Server、导入本地 kubectl 日志文件，或使用内置演示集群
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭窗口"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          {[
            { id: 'k8s' as const, label: '连接实时 K8s 集群', icon: Server },
            { id: 'file' as const, label: '导入日志文件 / 文本', icon: FileUp },
            { id: 'sandbox' as const, label: '内置演示集群', icon: HardDrive },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-2.5 text-xs font-medium inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto log-scrollbar">
          {tab === 'k8s' && (
            <form onSubmit={handleConnectK8s} className="space-y-4">
              {savedClusters.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    已保存的集群（刷新后自动保持）
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B0F17]">
                    {savedClusters.map((item) => {
                      const isCurrent =
                        activeCluster.mode === 'k8s-api' && activeCluster.apiServer === item.apiServer;
                      return (
                        <div
                          key={item.id}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onConnectK8sCluster(item, true);
                              onClose();
                            }}
                            className="flex-1 min-w-0 text-left group"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate">
                                {item.name}
                              </span>
                              {isCurrent && (
                                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                                  当前已连接
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.apiServer}
                              {item.gitVersion ? ` · ${item.gitVersion}` : ''}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteSavedCluster(item.id)}
                            aria-label={`删除已保存集群 ${item.name}`}
                            title="删除记录"
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(localStatus?.hasLocalKubeconfig || localStatus?.hasInCluster) && (
                localStatus.hasLocalKubeconfig && !localStatus.kubeconfigReadable ? (
                  <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/25 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                    <div className="font-medium">
                      检测到本地 kubeconfig ({localStatus.kubeconfigPath})，但容器当前用户 (uid=1000) 无读取权限
                    </div>
                    <div className="text-[11px] opacity-90">
                      宿主机文件通常为 0600 权限。您可以直接在下方粘贴 kubeconfig 内容，或在启动容器时添加 <code className="font-mono">--user $(id -u):$(id -g)</code>。
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-md border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/25 flex items-center justify-between gap-3">
                    <div className="text-xs text-sky-800 dark:text-sky-200">
                      检测到当前运行环境存在 {localStatus.hasLocalKubeconfig ? `本地 kubeconfig (${localStatus.kubeconfigPath})` : 'In-Cluster ServiceAccount 凭据'}
                    </div>
                    <button
                      type="button"
                      onClick={handleLoadLocalConfig}
                      className="h-8 px-3 rounded bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white whitespace-nowrap shrink-0"
                    >
                      一键载入
                    </button>
                  </div>
                )
              )}

              {/* Quick Kubeconfig Paste */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    快速解析 kubeconfig (可选)
                  </label>
                  <label className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer">
                    选择 kubeconfig 文件
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const r = new FileReader();
                        r.onload = () => {
                          const txt = typeof r.result === 'string' ? r.result : '';
                          setKubeconfigText(txt);
                          handleParseKubeconfig(txt);
                        };
                        r.readAsText(file);
                      }}
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={kubeconfigText}
                    onChange={(e) => {
                      const val = e.target.value;
                      setKubeconfigText(val);
                      setKubeconfigDirty(true);
                    }}
                    placeholder="粘贴 kubeconfig YAML/JSON 内容可自动提取 server、token 与证书..."
                    className="flex-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-2.5 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleParseKubeconfig(kubeconfigText)}
                    disabled={!kubeconfigText.trim()}
                    className="px-3 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    解析填充
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    集群名称
                  </label>
                  <input
                    type="text"
                    value={clusterName}
                    onChange={(e) => setClusterName(e.target.value)}
                    placeholder="production-k8s"
                    className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    API Server 地址 *
                  </label>
                  <input
                    type="url"
                    value={apiServer}
                    onChange={(e) => setApiServer(e.target.value)}
                    placeholder="https://10.0.0.10:6443"
                    className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Bearer Token (ServiceAccount / OIDC Token)
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
                  className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={insecureTls}
                    onChange={(e) => setInsecureTls(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-sky-600 focus:ring-sky-500"
                  />
                  <span>跳过 TLS 证书校验 (insecure-skip-tls-verify)</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowAdvancedTls((s) => !s)}
                  className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                >
                  {showAdvancedTls ? '收起客户端证书选项' : '配置 CA / mTLS 客户端证书'}
                </button>
              </div>

              {showAdvancedTls && (
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-600 dark:text-slate-400">CA 证书 (PEM)</label>
                    <textarea
                      rows={2}
                      value={caCert}
                      onChange={(e) => setCaCert(e.target.value)}
                      placeholder="-----BEGIN CERTIFICATE-----"
                      className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-600 dark:text-slate-400">Client Cert (PEM)</label>
                      <textarea
                        rows={2}
                        value={clientCert}
                        onChange={(e) => setClientCert(e.target.value)}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-600 dark:text-slate-400">Client Key (PEM)</label>
                      <textarea
                        rows={2}
                        value={clientKey}
                        onChange={(e) => setClientKey(e.target.value)}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----"
                        className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-2 text-[11px] font-mono text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>
                </div>
              )}

              {testError && (
                <div className="p-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs font-mono text-red-700 dark:text-red-300">
                  {testError}
                </div>
              )}

              {testSuccess && (
                <div className="p-3 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{testSuccess}</span>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberConnection}
                    onChange={(e) => setRememberConnection(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-sky-600 focus:ring-sky-500"
                  />
                  <span>记住连接配置（保存在本地浏览器，刷新不丢失）</span>
                </label>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={testing}
                    className="h-9 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {testing ? '正在验证连接...' : '测试并连接'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {tab === 'file' && (
            <form onSubmit={handleConfirmImport} className="space-y-4">
              <label className="block border border-dashed border-slate-300 dark:border-slate-700 rounded-md p-6 text-center cursor-pointer hover:border-sky-500 dark:hover:border-sky-500 transition-colors bg-slate-50/50 dark:bg-[#0B0F17]">
                <Upload className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  点击选择日志文件 (.log, .txt, .json)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  支持 kubectl logs 导出、CRI 日志、JSON 结构化日志及混合堆栈文本
                </div>
                <input
                  type="file"
                  accept=".log,.txt,.json,text/plain,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400">命名空间</label>
                  <input
                    type="text"
                    value={importNamespace}
                    onChange={(e) => setImportNamespace(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400">Pod 名称</label>
                  <input
                    type="text"
                    value={importPod}
                    onChange={(e) => setImportPod(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400">容器名称</label>
                  <input
                    type="text"
                    value={importContainer}
                    onChange={(e) => setImportContainer(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  或直接粘贴原始日志文本
                </label>
                <textarea
                  rows={6}
                  value={importRawText}
                  onChange={(e) => setImportRawText(e.target.value)}
                  placeholder="粘贴 kubectl logs --timestamps 输出内容..."
                  className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] p-3 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {importError && (
                <div className="text-xs text-red-600 dark:text-red-400">{importError}</div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white"
                >
                  解析并载入视图
                </button>
              </div>
            </form>
          )}

          {tab === 'sandbox' && (
            <div className="space-y-4">
              <div className="p-4 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  prod-us-east-1 (内置演示集群)
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  包含 4 个命名空间（prod-ecommerce、staging-payments、observability、kube-system）与 8 个多容器 Pod，覆盖 JSON 结构化日志、CrashLoopBackOff 崩溃堆栈（含 --previous 日志）、Envoy Sidecar 访问日志、Nginx Ingress 超时及实时日志流模拟。
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSwitchToSandbox();
                    onClose();
                  }}
                  className="h-9 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white"
                >
                  切换到演示集群
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
