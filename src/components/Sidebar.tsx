import { CheckSquare, ChevronDown, ChevronRight, Layers, RefreshCw, Search, Server, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ClusterConfig, PodInfo, SelectedTarget } from '../types/k8s';

interface SidebarProps {
  cluster: ClusterConfig;
  namespaces: string[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
  pods: PodInfo[];
  isLoadingPods: boolean;
  onRefreshPods: () => void;
  selectedTarget: SelectedTarget | null;
  onSelectContainer: (target: SelectedTarget) => void;
  isMultiPodMode: boolean;
  onToggleMultiPodMode: () => void;
  multiPodSelection: Array<{ namespace: string; pod: string; container: string }>;
  onToggleMultiPodItem: (item: { namespace: string; pod: string; container: string }) => void;
  onOpenConnectModal: () => void;
}

function getPhaseTextStyle(phase: string): string {
  const lower = phase.toLowerCase();
  if (lower.includes('crash') || lower.includes('error') || lower.includes('failed') || lower.includes('oom')) {
    return 'text-red-600 dark:text-red-400';
  }
  if (lower.includes('pending') || lower.includes('init') || lower.includes('terminating') || lower.includes('backoff')) {
    return 'text-amber-600 dark:text-amber-400';
  }
  if (lower === 'running' || lower === 'completed' || lower === 'succeeded') {
    return 'text-emerald-600 dark:text-emerald-400';
  }
  return 'text-slate-500 dark:text-slate-400';
}

export function Sidebar({
  cluster,
  namespaces,
  selectedNamespace,
  onSelectNamespace,
  pods,
  isLoadingPods,
  onRefreshPods,
  selectedTarget,
  onSelectContainer,
  isMultiPodMode,
  onToggleMultiPodMode,
  multiPodSelection,
  onToggleMultiPodItem,
  onOpenConnectModal,
}: SidebarProps) {
  const [podSearch, setPodSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'unhealthy'>('all');
  const [expandedPods, setExpandedPods] = useState<Record<string, boolean>>({});

  const filteredPods = useMemo(() => {
    const q = podSearch.trim().toLowerCase();
    return pods.filter((pod) => {
      if (selectedNamespace !== '__all__' && pod.namespace !== selectedNamespace) {
        return false;
      }
      if (statusFilter === 'running' && pod.phase !== 'Running') {
        return false;
      }
      if (statusFilter === 'unhealthy' && (pod.phase === 'Running' || pod.phase === 'Succeeded')) {
        return false;
      }
      if (q) {
        const matchName = pod.name.toLowerCase().includes(q);
        const matchContainer = pod.containers.some((c) => c.name.toLowerCase().includes(q));
        const matchNs = pod.namespace.toLowerCase().includes(q);
        return matchName || matchContainer || matchNs;
      }
      return true;
    });
  }, [pods, selectedNamespace, statusFilter, podSearch]);

  const toggleExpandPod = (key: string) => {
    setExpandedPods((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  };

  const isMultiSelected = (ns: string, pod: string, container: string) =>
    multiPodSelection.some((i) => i.namespace === ns && i.pod === pod && i.container === container);

  return (
    <aside className="w-[276px] shrink-0 border-r border-slate-200 dark:border-slate-800/90 bg-slate-50/70 dark:bg-[#0D121C] flex flex-col h-full select-none">
      {/* Cluster Header */}
      <div className="p-3.5 border-b border-slate-200 dark:border-slate-800/90 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenConnectModal}
            className="flex items-center gap-2 text-left min-w-0 group focus-visible:outline-none"
            title="切换集群或数据源"
          >
            <Server className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                {cluster.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {cluster.mode === 'sandbox'
                  ? '内置演示集群'
                  : cluster.mode === 'k8s-api'
                    ? `实时 API${cluster.gitVersion ? ` · ${cluster.gitVersion}` : ''}`
                    : '本地导入日志文件'}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onRefreshPods}
            disabled={isLoadingPods || cluster.mode === 'imported-file'}
            aria-label="刷新 Pod 列表"
            title="刷新 Pod 列表"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPods ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Namespace Selector */}
        {cluster.mode !== 'imported-file' && (
          <div>
            <label htmlFor="ns-select" className="sr-only">命名空间</label>
            <select
              id="ns-select"
              value={selectedNamespace}
              onChange={(e) => onSelectNamespace(e.target.value)}
              className="w-full h-9 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="__all__">全部命名空间 ({pods.length})</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pod Search & Filters */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800/90 space-y-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={podSearch}
            onChange={(e) => setPodSearch(e.target.value)}
            placeholder="过滤 Pod 或容器名..."
            className="w-full h-8 pl-8 pr-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800/70">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'running', label: '正常' },
                { id: 'unhealthy', label: '异常' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? 'bg-white dark:bg-[#1B2333] text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onToggleMultiPodMode}
            title="开启后可勾选多个 Pod/容器合并追踪日志"
            className={`h-7 px-2 inline-flex items-center gap-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              isMultiPodMode
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>聚合</span>
          </button>
        </div>
      </div>

      {/* Pod & Container List */}
      <div className="flex-1 overflow-y-auto log-scrollbar p-2 space-y-1">
        {isLoadingPods ? (
          <div className="space-y-2 p-1">
            {[1, 2, 3, 4].map((idx) => (
              <div key={idx} className="h-14 rounded-md bg-slate-200/60 dark:bg-slate-800/40 animate-pulse" />
            ))}
          </div>
        ) : filteredPods.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            没有匹配的 Pod 实例
          </div>
        ) : (
          filteredPods.map((pod) => {
            const podKey = `${pod.namespace}/${pod.name}`;
            const isExpanded = expandedPods[podKey] ?? true;

            return (
              <div key={podKey} className="rounded-md">
                <button
                  type="button"
                  onClick={() => toggleExpandPod(podKey)}
                  className="w-full px-2 py-2 flex items-start gap-1.5 rounded-md text-left hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <span className="mt-0.5 text-slate-400 shrink-0">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={pod.name}>
                      {pod.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      <span className={`font-medium ${getPhaseTextStyle(pod.phase)}`}>{pod.phase}</span>
                      {selectedNamespace === '__all__' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono truncate">{pod.namespace}</span>
                        </>
                      )}
                      {pod.restarts > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                            {pod.restarts} 次重启
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="pl-5 pr-1 pb-1 space-y-0.5">
                    {pod.containers.map((container) => {
                      const isSelected =
                        !isMultiPodMode &&
                        selectedTarget?.namespace === pod.namespace &&
                        selectedTarget?.pod === pod.name &&
                        selectedTarget?.container === container.name &&
                        !selectedTarget.previous;

                      const isSelectedPrev =
                        !isMultiPodMode &&
                        selectedTarget?.namespace === pod.namespace &&
                        selectedTarget?.pod === pod.name &&
                        selectedTarget?.container === container.name &&
                        selectedTarget.previous;

                      const multiChecked = isMultiSelected(pod.namespace, pod.name, container.name);

                      return (
                        <div key={container.name} className="space-y-0.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (isMultiPodMode) {
                                  onToggleMultiPodItem({
                                    namespace: pod.namespace,
                                    pod: pod.name,
                                    container: container.name,
                                  });
                                } else {
                                  onSelectContainer({
                                    namespace: pod.namespace,
                                    pod: pod.name,
                                    container: container.name,
                                    previous: false,
                                  });
                                }
                              }}
                              className={`flex-1 min-w-0 px-2 py-1.5 rounded text-left flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                                isSelected || (isMultiPodMode && multiChecked)
                                  ? 'bg-sky-500/12 dark:bg-sky-500/18 text-sky-700 dark:text-sky-300'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isMultiPodMode && (
                                  multiChecked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )
                                )}
                                <span className="font-mono text-xs truncate">{container.name}</span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
                                {container.isInit ? 'init' : container.ready ? 'ready' : container.state}
                              </span>
                            </button>

                            {!isMultiPodMode && container.restarts > 0 && (
                              <button
                                type="button"
                                title="查看上次崩溃退出前的容器日志 (--previous)"
                                onClick={() =>
                                  onSelectContainer({
                                    namespace: pod.namespace,
                                    pod: pod.name,
                                    container: container.name,
                                    previous: true,
                                  })
                                }
                                className={`px-1.5 py-1 rounded font-mono text-[10px] transition-colors whitespace-nowrap shrink-0 ${
                                  isSelectedPrev
                                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold'
                                    : 'text-amber-600 dark:text-amber-400/80 hover:bg-amber-500/10'
                                }`}
                              >
                                prev
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
