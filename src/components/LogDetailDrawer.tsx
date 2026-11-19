import { Check, ChevronDown, ChevronUp, Copy, Filter, FilterX, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types/k8s';
import { copyTextToClipboard } from '../utils/clipboard';

interface LogDetailDrawerProps {
  entry: LogEntry | null;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  canPrev: boolean;
  canNext: boolean;
  onApplyFieldFilter: (key: string, value: string, negate?: boolean) => void;
  onExplainWithAi: (entry: LogEntry) => void;
}

export function LogDetailDrawer({
  entry,
  onClose,
  onNavigate,
  canPrev,
  canNext,
  onApplyFieldFilter,
  onExplainWithAi,
}: LogDetailDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!entry) return null;

  const copyText = async (id: string, text: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedId(id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedId(null);
      copyTimerRef.current = null;
    }, 1500);
  };

  const jsonEntries = entry.jsonPayload ? Object.entries(entry.jsonPayload) : [];

  return (
    <aside
      aria-label="日志详情检查器"
      className="w-[400px] xl:w-[440px] shrink-0 border-l border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141F] flex flex-col h-full"
    >
      {/* Header */}
      <div className="h-11 px-4 border-b border-slate-200 dark:border-slate-800/90 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
            日志详情
          </span>
          <span className="text-xs font-mono text-slate-400">#{entry.lineNumber}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onExplainWithAi(entry)}
            title="脱敏后交由 AI 深度解读该条日志与堆栈"
            className="h-7 px-2 mr-1 inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-[11px] font-medium text-sky-700 dark:text-sky-300 transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3" />
            <span>AI 解读此行</span>
          </button>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onNavigate('prev')}
            aria-label="上一条日志"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onNavigate('next')}
            aria-label="下一条日志"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情面板"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto log-scrollbar p-4 space-y-5">
        {/* Core Metadata */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">上下文信息</div>
          <dl className="grid grid-cols-[88px_1fr] gap-y-2 gap-x-3 text-xs">
            <dt className="text-slate-500 dark:text-slate-400">级别</dt>
            <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100">{entry.level}</dd>

            <dt className="text-slate-500 dark:text-slate-400">时间戳</dt>
            <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{entry.timestampIso}</dd>

            <dt className="text-slate-500 dark:text-slate-400">命名空间</dt>
            <dd className="font-mono text-slate-800 dark:text-slate-200">{entry.namespace}</dd>

            <dt className="text-slate-500 dark:text-slate-400">Pod</dt>
            <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">{entry.pod}</dd>

            <dt className="text-slate-500 dark:text-slate-400">容器</dt>
            <dd className="font-mono text-sky-600 dark:text-sky-400">{entry.container}</dd>

            {entry.nodeName && (
              <>
                <dt className="text-slate-500 dark:text-slate-400">节点</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200 break-all">
                  {entry.nodeName === '-' ? '未调度 (-)' : entry.nodeName}
                </dd>
              </>
            )}

            {entry.traceId && (
              <>
                <dt className="text-slate-500 dark:text-slate-400">Trace ID</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <span className="truncate">{entry.traceId}</span>
                  <button
                    type="button"
                    onClick={() => onApplyFieldFilter('trace_id', entry.traceId!, false)}
                    className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline shrink-0"
                  >
                    追踪
                  </button>
                </dd>
              </>
            )}
          </dl>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">日志消息</span>
            <button
              type="button"
              onClick={() => copyText('msg', entry.message)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              {copiedId === 'msg' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedId === 'msg' ? '已复制' : '复制'}</span>
            </button>
          </div>
          <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] font-mono text-xs text-slate-800 dark:text-slate-200 break-words whitespace-pre-wrap">
            {entry.message}
          </div>
        </div>

        {/* Structured JSON Fields */}
        {jsonEntries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                结构化字段 ({jsonEntries.length})
              </span>
              <button
                type="button"
                onClick={() => copyText('json', JSON.stringify(entry.jsonPayload, null, 2))}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {copiedId === 'json' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedId === 'json' ? '已复制 JSON' : '复制 JSON'}</span>
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
              {jsonEntries.map(([key, val]) => {
                const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                return (
                  <div
                    key={key}
                    className="group px-3 py-2 bg-slate-50/50 dark:bg-[#0B0F17] flex items-start justify-between gap-2 text-xs font-mono"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{key}</div>
                      <div className="text-slate-800 dark:text-slate-200 break-all mt-0.5">{displayVal}</div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        title="仅看包含此字段值的日志"
                        onClick={() => onApplyFieldFilter(key, displayVal, false)}
                        className="p-1 rounded text-slate-500 hover:text-sky-600 hover:bg-sky-500/10 dark:text-slate-400 dark:hover:text-sky-400"
                      >
                        <Filter className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        title="排除此字段值"
                        onClick={() => onApplyFieldFilter(key, displayVal, true)}
                        className="p-1 rounded text-slate-500 hover:text-red-600 hover:bg-red-500/10 dark:text-slate-400 dark:hover:text-red-400"
                      >
                        <FilterX className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stacktrace if present */}
        {entry.stackLines && entry.stackLines.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-red-600 dark:text-red-400">
              异常堆栈 ({entry.stackLines.length} 行)
            </div>
            <pre className="p-3 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 font-mono text-[11.5px] text-red-800 dark:text-red-200 overflow-x-auto whitespace-pre">
              {entry.stackLines.join('\n')}
            </pre>
          </div>
        )}

        {/* Raw Line */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">原始日志行</span>
            <button
              type="button"
              onClick={() => copyText('raw', entry.raw)}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              {copiedId === 'raw' ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span>{copiedId === 'raw' ? '已复制原文' : '复制原文'}</span>
            </button>
          </div>
          <pre className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] font-mono text-[11px] text-slate-600 dark:text-slate-400 overflow-x-auto whitespace-pre-wrap break-all">
            {entry.raw}
          </pre>
        </div>
      </div>
    </aside>
  );
}
