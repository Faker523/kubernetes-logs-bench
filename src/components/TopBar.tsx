import { Download, Moon, PanelLeft, Plug, Sun } from 'lucide-react';
import { useState } from 'react';
import type { ClusterConfig, SelectedTarget } from '../types/k8s';

interface TopBarProps {
  cluster: ClusterConfig;
  selectedTarget: SelectedTarget | null;
  multiPodCount: number;
  isMultiPodMode: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenConnectModal: () => void;
  onExportLogs: (format: 'log' | 'json') => void;
  canExport: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function TopBar({
  cluster,
  selectedTarget,
  multiPodCount,
  isMultiPodMode,
  sidebarOpen,
  onToggleSidebar,
  onOpenConnectModal,
  onExportLogs,
  canExport,
  theme,
  onToggleTheme,
}: TopBarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  return (
    <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141F] px-4 flex items-center justify-between gap-6">
      {/* Left: Wordmark + Contextual Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 shrink-0"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <span className="font-display text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0">
          KubeLog
        </span>

        <span className="text-slate-300 dark:text-slate-700 select-none hidden sm:inline" aria-hidden="true">
          /
        </span>

        {/* Contextual Breadcrumbs */}
        <nav aria-label="当前日志路径" className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0 truncate">
          <span className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap shrink-0">
            {cluster.name}
          </span>
          {isMultiPodMode ? (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-mono text-sky-600 dark:text-sky-400 whitespace-nowrap">
                多 Pod 聚合 ({multiPodCount} 个实例)
              </span>
            </>
          ) : selectedTarget ? (
            <>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-mono whitespace-nowrap shrink-0">{selectedTarget.namespace}</span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-mono text-slate-800 dark:text-slate-200 truncate max-w-[260px]" title={selectedTarget.pod}>
                {selectedTarget.pod}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">/</span>
              <span className="font-mono text-sky-600 dark:text-sky-400 whitespace-nowrap shrink-0">
                {selectedTarget.container}
                {selectedTarget.previous ? ' (previous)' : ''}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      {/* Right: Primary Actions */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 shrink-0"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button
            type="button"
            disabled={!canExport}
            onClick={() => setExportMenuOpen((prev) => !prev)}
            className="h-9 px-3.5 inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出日志</span>
          </button>

          {exportMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 w-44 z-30 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#141A26] shadow-lg py-1">
                <button
                  type="button"
                  onClick={() => {
                    onExportLogs('log');
                    setExportMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  导出为纯文本 (.log)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportLogs('json');
                    setExportMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  导出为结构化 JSON (.json)
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenConnectModal}
          className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <Plug className="w-3.5 h-3.5" />
          <span>连接集群 / 导入</span>
        </button>
      </div>
    </header>
  );
}
