import { AlertTriangle, ArrowDown, ChevronDown, ChevronRight, FileText, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FilterState, LogEntry, LogLevel } from '../types/k8s';

interface LogViewportProps {
  viewKey: string;
  entries: LogEntry[];
  totalCount: number;
  filters: FilterState;
  isMultiPodMode: boolean;
  isLoading: boolean;
  error: string | null;
  selectedEntryId: string | null;
  onSelectEntry: (entry: LogEntry) => void;
  isLiveTail: boolean;
  onResetFilters: () => void;
  onRetry: () => void;
  contextMatchIds?: Set<string>;
}

const POD_TEXT_COLORS = [
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-400',
  'text-rose-600 dark:text-rose-400',
  'text-cyan-600 dark:text-cyan-400',
];

function getPodColorClass(podName: string): string {
  let hash = 0;
  for (let i = 0; i < podName.length; i++) {
    hash = (hash * 31 + podName.charCodeAt(i)) | 0;
  }
  return POD_TEXT_COLORS[Math.abs(hash) % POD_TEXT_COLORS.length];
}

function getLevelStyle(level: LogLevel): string {
  switch (level) {
    case 'ERROR':
      return 'text-red-600 dark:text-red-400 font-semibold';
    case 'WARN':
      return 'text-amber-600 dark:text-amber-400 font-semibold';
    case 'INFO':
      return 'text-sky-600 dark:text-sky-400';
    case 'DEBUG':
      return 'text-slate-500 dark:text-slate-400';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
}

function getRowSurfaceStyle(level: LogLevel, isSelected: boolean, isDimmedContext: boolean): string {
  if (isSelected) {
    return 'bg-sky-500/15 dark:bg-sky-500/20';
  }
  const opacityClass = isDimmedContext ? 'opacity-55 hover:opacity-100' : '';
  if (level === 'ERROR') {
    return `bg-red-500/[0.06] hover:bg-red-500/[0.11] ${opacityClass}`;
  }
  if (level === 'WARN') {
    return `bg-amber-500/[0.05] hover:bg-amber-500/[0.09] ${opacityClass}`;
  }
  return `hover:bg-slate-100/80 dark:hover:bg-slate-800/45 ${opacityClass}`;
}

function highlightText(text: string, search: string, isRegex: boolean, caseSensitive: boolean) {
  const query = search.trim();
  if (!query) return text;

  try {
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = isRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    const nodes: Array<string | React.ReactNode> = [];
    let lastIndex = 0;
    let matchCount = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null && matchCount < 100) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      if (match.index > lastIndex) {
        nodes.push(text.slice(lastIndex, match.index));
      }
      nodes.push(
        <mark
          key={`${match.index}-${matchCount}`}
          className="bg-amber-300/70 dark:bg-amber-500/40 text-slate-950 dark:text-amber-50 rounded-[2px] px-0.5"
        >
          {match[0]}
        </mark>
      );
      lastIndex = match.index + match[0].length;
      matchCount += 1;
    }

    if (nodes.length === 0) return text;
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes;
  } catch {
    return text;
  }
}

function formatJsonPreviewPairs(payload: Record<string, unknown>): Array<[string, string]> {
  const skip = new Set(['level', 'lvl', 'severity', 'log_level', 'msg', 'message', 'log', 'ts', 'timestamp', 'time', '@timestamp']);
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(payload)) {
    if (skip.has(k) || v === undefined || v === null) continue;
    const strVal = typeof v === 'object' ? JSON.stringify(v) : String(v);
    pairs.push([k, strVal.length > 48 ? `${strVal.slice(0, 48)}…` : strVal]);
    if (pairs.length >= 5) break;
  }
  return pairs;
}

export function LogViewport({
  viewKey,
  entries,
  totalCount,
  filters,
  isMultiPodMode,
  isLoading,
  error,
  selectedEntryId,
  onSelectEntry,
  isLiveTail,
  onResetFilters,
  onRetry,
  contextMatchIds,
}: LogViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [autoScroll, setAutoScroll] = useState(true);
  const [newLogCountWhilePaused, setNewLogCountWhilePaused] = useState(0);
  const prevLenRef = useRef(entries.length);
  const prevLastSigRef = useRef<string>('');
  const [expandedStacks, setExpandedStacks] = useState<Record<string, boolean>>({});
  const [dismissedCount, setDismissedCount] = useState<number | null>(null);
  const [matchCursor, setMatchCursor] = useState(0);

  // Reset per-Pod UI state whenever the active target/cluster/mode changes
  useEffect(() => {
    setDismissedCount(null);
    setMatchCursor(0);
    setExpandedStacks({});
    setAutoScroll(true);
    setNewLogCountWhilePaused(0);
    prevLenRef.current = 0;
    prevLastSigRef.current = '';
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [viewKey]);

  const alertDetection = useMemo(() => {
    const matchedEntries: LogEntry[] = [];
    let exceptionHits = 0;
    let criticalHits = 0;

    for (const entry of entries) {
      const fullText = entry.stackLines?.length
        ? `${entry.raw}\n${entry.stackLines.join('\n')}`
        : entry.raw;
      const hasException = /Exception/i.test(fullText);
      const hasCritical = /Critical/i.test(fullText);
      if (hasException || hasCritical) {
        matchedEntries.push(entry);
        if (hasException) exceptionHits += 1;
        if (hasCritical) criticalHits += 1;
      }
    }

    return {
      matchedEntries,
      totalHits: matchedEntries.length,
      exceptionHits,
      criticalHits,
    };
  }, [entries]);

  // Reset dismissed state when match count drops to 0 or increases with new incoming alerts
  useEffect(() => {
    if (alertDetection.totalHits === 0) {
      setDismissedCount(null);
      setMatchCursor(0);
    } else if (dismissedCount !== null && alertDetection.totalHits > dismissedCount) {
      setDismissedCount(null);
    }
  }, [alertDetection.totalHits, dismissedCount]);

  const showAlertBanner =
    alertDetection.totalHits > 0 && dismissedCount !== alertDetection.totalHits;

  const jumpToAlertMatch = () => {
    if (alertDetection.matchedEntries.length === 0) return;
    const idx = matchCursor % alertDetection.matchedEntries.length;
    const target = alertDetection.matchedEntries[idx];
    const rowEl = rowRefs.current.get(target.id);
    if (rowEl) {
      rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (selectedEntryId !== target.id) {
      onSelectEntry(target);
    }
    setMatchCursor((idx + 1) % alertDetection.matchedEntries.length);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const lastEntry = entries[entries.length - 1];
    const lastSig = lastEntry ? `${lastEntry.timestampIso}|${lastEntry.raw}` : '';
    const hasNewContent =
      entries.length !== prevLenRef.current ||
      (lastSig !== '' && lastSig !== prevLastSigRef.current);
    const delta = entries.length - prevLenRef.current;

    prevLenRef.current = entries.length;
    prevLastSigRef.current = lastSig;

    if (!hasNewContent) return;

    if (isLiveTail && autoScroll) {
      el.scrollTop = el.scrollHeight;
      setNewLogCountWhilePaused(0);
    } else if (!autoScroll) {
      setNewLogCountWhilePaused((c) => c + (delta > 0 ? delta : 1));
    }
  }, [entries, isLiveTail, autoScroll]);

  useEffect(() => {
    if (isLiveTail) {
      setAutoScroll(true);
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [isLiveTail]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 36;
    if (atBottom) {
      setAutoScroll(true);
      setNewLogCountWhilePaused(0);
    } else if (isLiveTail) {
      setAutoScroll(false);
    }
  };

  const jumpToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
    setNewLogCountWhilePaused(0);
  };

  const toggleStack = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedStacks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden p-4 space-y-2 bg-white dark:bg-[#0B0F17]">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 h-6">
            <div className="w-10 h-3.5 rounded bg-slate-200 dark:bg-slate-800/70 animate-pulse" />
            <div className="w-24 h-3.5 rounded bg-slate-200 dark:bg-slate-800/70 animate-pulse" />
            <div className="w-14 h-3.5 rounded bg-slate-200 dark:bg-slate-800/70 animate-pulse" />
            <div className="flex-1 h-3.5 rounded bg-slate-200/80 dark:bg-slate-800/50 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-[#0B0F17]">
        <div className="max-w-md space-y-3">
          <div className="text-sm font-semibold text-red-600 dark:text-red-400">
            无法加载容器日志
          </div>
          <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-words bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md p-3">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="h-9 px-4 inline-flex items-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重试拉取</span>
          </button>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    const isFiltered = totalCount > 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-[#0B0F17]">
        <FileText className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-3" />
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {isFiltered ? '当前过滤条件下没有匹配的日志行' : '暂无日志输出'}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
          {isFiltered
            ? `已载入 ${totalCount} 条原始日志，请放宽关键词、日志级别或时间窗口条件。`
            : '请从左侧选择要查看的 Pod 与容器，或点击右上角连接实时集群 / 导入本地日志文件。'}
        </p>
        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 h-9 px-4 inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            重置过滤条件
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 bg-white dark:bg-[#0B0F17] flex flex-col">
      {showAlertBanner && (
        <div
          role="alert"
          className="shrink-0 px-4 py-1.5 border-b border-red-300 dark:border-red-900/70 bg-red-600/12 dark:bg-red-500/15 text-red-700 dark:text-red-300 flex items-center justify-between gap-3 text-xs animate-pulse"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
            <span className="font-semibold whitespace-nowrap">高危日志告警</span>
            <span className="text-red-300 dark:text-red-800" aria-hidden="true">·</span>
            <span className="font-mono truncate">
              检测到 {alertDetection.totalHits} 条包含{' '}
              {alertDetection.exceptionHits > 0 && `Exception (${alertDetection.exceptionHits})`}
              {alertDetection.exceptionHits > 0 && alertDetection.criticalHits > 0 && ' / '}
              {alertDetection.criticalHits > 0 && `Critical (${alertDetection.criticalHits})`}
              {' '}的日志
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={jumpToAlertMatch}
              className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-medium transition-colors whitespace-nowrap"
            >
              定位异常行 ({(matchCursor % alertDetection.totalHits) + 1}/{alertDetection.totalHits})
            </button>
            <button
              type="button"
              onClick={() => setDismissedCount(alertDetection.totalHits)}
              aria-label="关闭告警提示"
              className="p-0.5 rounded text-red-600 dark:text-red-300 hover:bg-red-500/20 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto log-scrollbar font-mono text-[12.5px] leading-[22px] py-1"
      >
        <div className={filters.wrapLines ? 'w-full' : 'min-w-max'}>
          {entries.map((entry) => {
            const isSelected = selectedEntryId === entry.id;
            const isDimmed = contextMatchIds ? !contextMatchIds.has(entry.id) : false;
            const hasStack = Boolean(entry.stackLines && entry.stackLines.length > 0);
            const stackExpanded = Boolean(expandedStacks[entry.id]);
            const jsonPairs =
              filters.jsonPreview && entry.jsonPayload
                ? formatJsonPreviewPairs(entry.jsonPayload)
                : [];

            return (
              <div
                key={entry.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(entry.id, el);
                  else rowRefs.current.delete(entry.id);
                }}
                onClick={() => onSelectEntry(entry)}
                className={`group cursor-pointer px-4 py-[2px] border-b border-transparent transition-colors ${getRowSurfaceStyle(
                  entry.level,
                  isSelected,
                  isDimmed
                )}`}
              >
                <div className={`flex items-start gap-3 ${filters.wrapLines ? '' : 'whitespace-nowrap'}`}>
                  {filters.showLineNumbers && (
                    <span className="w-10 shrink-0 text-right text-[11px] text-slate-400 dark:text-slate-600 select-none pt-[1px]">
                      {entry.lineNumber}
                    </span>
                  )}

                  {filters.showTimestamp && (
                    <span className="w-[88px] shrink-0 text-[11.5px] text-slate-500 dark:text-slate-400 select-none">
                      {entry.timeDisplay}
                    </span>
                  )}

                  {isMultiPodMode && (
                    <span
                      className={`w-44 shrink-0 truncate text-[11.5px] ${getPodColorClass(entry.pod)}`}
                      title={`${entry.namespace}/${entry.pod}:${entry.container}`}
                    >
                      {entry.pod}
                    </span>
                  )}

                  <span className={`w-12 shrink-0 text-[11.5px] ${getLevelStyle(entry.level)}`}>
                    {entry.level === 'UNKNOWN' ? 'LOG' : entry.level}
                  </span>

                  <div className={`flex-1 min-w-0 text-slate-800 dark:text-slate-200 ${filters.wrapLines ? 'break-words whitespace-pre-wrap' : ''}`}>
                    <span>{highlightText(entry.message, filters.search, filters.isRegex, filters.caseSensitive)}</span>

                    {jsonPairs.length > 0 && (
                      <span className="ml-2.5 inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                        {jsonPairs.map(([k, v]) => (
                          <span key={k}>
                            <span className="text-slate-400 dark:text-slate-500">{k}=</span>
                            <span className="text-sky-700 dark:text-sky-300">{v}</span>
                          </span>
                        ))}
                      </span>
                    )}

                    {hasStack && (
                      <button
                        type="button"
                        onClick={(e) => toggleStack(entry.id, e)}
                        className="ml-2 inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 hover:underline align-baseline"
                      >
                        {stackExpanded ? (
                          <>
                            <ChevronDown className="w-3 h-3" />
                            <span>收起堆栈 ({entry.stackLines!.length} 行)</span>
                          </>
                        ) : (
                          <>
                            <ChevronRight className="w-3 h-3" />
                            <span>展开堆栈 ({entry.stackLines!.length} 行)</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {hasStack && stackExpanded && (
                  <div className="mt-1 mb-1.5 ml-[104px] pl-3 py-1.5 rounded bg-red-500/[0.06] dark:bg-red-950/30 text-[11.5px] text-red-800 dark:text-red-200 whitespace-pre overflow-x-auto">
                    {entry.stackLines!.join('\n')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom status / Jump-to-bottom button */}
      <div className="shrink-0 h-8 border-t border-slate-200 dark:border-slate-800/90 bg-slate-50 dark:bg-[#0D121C] px-4 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
        <div className="flex items-center gap-3">
          <span>显示 {entries.length} / {totalCount} 行</span>
          {filters.timeBucketRange && <span>· 已按时间窗口过滤</span>}
          {isLiveTail && (
            <span className="text-emerald-600 dark:text-emerald-400">
              · {autoScroll ? '自动滚动追踪中' : '滚动已暂停'}
            </span>
          )}
        </div>

        {!autoScroll && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="inline-flex items-center gap-1.5 text-sky-600 dark:text-sky-400 hover:underline font-medium"
          >
            <ArrowDown className="w-3 h-3" />
            <span>
              {newLogCountWhilePaused > 0
                ? `${newLogCountWhilePaused} 条新日志 · 回到底部`
                : '回到底部'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
