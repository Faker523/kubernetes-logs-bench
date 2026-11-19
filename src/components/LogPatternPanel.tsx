import { Check, Copy, Eye, EyeOff, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLevel } from '../types/k8s';
import { copyTextToClipboard } from '../utils/clipboard';
import type { LogPattern } from '../utils/logPatternDetector';

interface LogPatternPanelProps {
  patterns: LogPattern[];
  totalEntries: number;
  compressionPct: number;
  excludedPatternIds: string[];
  focusedPatternId: string | null;
  onToggleExcludePattern: (patternId: string) => void;
  onToggleFocusPattern: (patternId: string) => void;
  onClearPatternFilters: () => void;
  onApplyRegexToSearch: (regex: string) => void;
  onClose: () => void;
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

export function LogPatternPanel({
  patterns,
  totalEntries,
  compressionPct,
  excludedPatternIds,
  focusedPatternId,
  onToggleExcludePattern,
  onToggleFocusPattern,
  onClearPatternFilters,
  onApplyRegexToSearch,
  onClose,
}: LogPatternPanelProps) {
  const [patternQuery, setPatternQuery] = useState('');
  const [sortBy, setSortBy] = useState<'count' | 'severity'>('count');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const filteredPatterns = useMemo(() => {
    const q = patternQuery.trim().toLowerCase();
    const list = patterns.filter((p) => {
      if (!q) return true;
      return (
        p.template.toLowerCase().includes(q) ||
        p.level.toLowerCase().includes(q) ||
        p.regexString.toLowerCase().includes(q)
      );
    });

    if (sortBy === 'severity') {
      const rank: Record<LogLevel, number> = {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3,
        UNKNOWN: 4,
      };
      return [...list].sort((a, b) => rank[a.level] - rank[b.level] || b.count - a.count);
    }

    return list;
  }, [patterns, patternQuery, sortBy]);

  const excludedCountTotal = useMemo(() => {
    const excludedSet = new Set(excludedPatternIds);
    return patterns
      .filter((p) => excludedSet.has(p.id))
      .reduce((sum, p) => sum + p.count, 0);
  }, [patterns, excludedPatternIds]);

  const copyRegex = async (id: string, regex: string) => {
    const ok = await copyTextToClipboard(regex);
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

  return (
    <aside
      aria-label="日志模式检测面板"
      className="w-[440px] xl:w-[480px] shrink-0 border-l border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141F] flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800/90 space-y-2.5 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              日志模式检测（正则聚合）
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {totalEntries} 条日志归并为 {patterns.length} 个模板
              <span className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
              <span>降噪压缩 {compressionPct.toFixed(1)}%</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭模式检测面板"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131926] px-2.5 gap-1.5 focus-within:ring-2 focus-within:ring-sky-500">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={patternQuery}
              onChange={(e) => setPatternQuery(e.target.value)}
              placeholder="筛选模式模板..."
              className="flex-1 min-w-0 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-slate-100 dark:bg-slate-800/70 shrink-0">
            <button
              type="button"
              onClick={() => setSortBy('count')}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                sortBy === 'count'
                  ? 'bg-white dark:bg-[#1B2333] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              频次优先
            </button>
            <button
              type="button"
              onClick={() => setSortBy('severity')}
              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                sortBy === 'severity'
                  ? 'bg-white dark:bg-[#1B2333] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              异常优先
            </button>
          </div>
        </div>

        {/* Active exclusion / focus bar */}
        {(excludedPatternIds.length > 0 || focusedPatternId) && (
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
            <div className="font-mono text-sky-600 dark:text-sky-400 truncate">
              {focusedPatternId
                ? '正在单独查看 1 类模式'
                : `已屏蔽 ${excludedPatternIds.length} 类干扰模式（过滤 ${excludedCountTotal} 条）`}
            </div>
            <button
              type="button"
              onClick={onClearPatternFilters}
              className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复全部</span>
            </button>
          </div>
        )}
      </div>

      {/* Pattern List */}
      <div className="flex-1 overflow-y-auto log-scrollbar divide-y divide-slate-200 dark:divide-slate-800/80">
        {filteredPatterns.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            没有可归类的日志模式
          </div>
        ) : (
          filteredPatterns.map((pattern) => {
            const isExcluded = excludedPatternIds.includes(pattern.id);
            const isFocused = focusedPatternId === pattern.id;

            return (
              <div
                key={pattern.id}
                className={`p-3.5 space-y-2 transition-colors ${
                  isFocused
                    ? 'bg-sky-500/[0.08]'
                    : isExcluded
                      ? 'bg-slate-100/60 dark:bg-slate-900/50 opacity-55'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/35'
                }`}
              >
                {/* Top Meta Row */}
                <div className="flex items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[11px] ${getLevelStyle(pattern.level)}`}>
                      {pattern.level === 'UNKNOWN' ? 'LOG' : pattern.level}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="text-slate-900 dark:text-slate-100 font-semibold">
                      {pattern.count} 条
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      ({pattern.sharePct.toFixed(1)}%)
                    </span>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleFocusPattern(pattern.id)}
                      title={isFocused ? '取消仅看该模式' : '在左侧视口仅看该模式'}
                      className={`h-6 px-2 rounded text-[11px] inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                        isFocused
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{isFocused ? '取消仅看' : '仅看'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleExcludePattern(pattern.id)}
                      title={isExcluded ? '取消屏蔽该干扰模式' : '屏蔽该类干扰日志'}
                      className={`h-6 px-2 rounded text-[11px] inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                        isExcluded
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      <EyeOff className="w-3 h-3" />
                      <span>{isExcluded ? '已屏蔽' : '屏蔽'}</span>
                    </button>
                  </div>
                </div>

                {/* Density Proportion Bar */}
                <div className="h-1 w-full rounded-[1px] bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    style={{ width: `${Math.max(2, pattern.sharePct)}%` }}
                    className={`h-full ${
                      pattern.level === 'ERROR'
                        ? 'bg-red-500'
                        : pattern.level === 'WARN'
                          ? 'bg-amber-500'
                          : 'bg-sky-500/75'
                    }`}
                  />
                </div>

                {/* Template Text with Highlighted Dynamic Placeholders */}
                <div className="font-mono text-[12px] leading-relaxed text-slate-800 dark:text-slate-200 break-words">
                  {pattern.tokens.map((tok, idx) =>
                    tok.isPlaceholder ? (
                      <span
                        key={idx}
                        className="text-sky-600 dark:text-sky-400 font-semibold mx-0.5"
                      >
                        {tok.text}
                      </span>
                    ) : (
                      <span key={idx}>{tok.text}</span>
                    )
                  )}
                </div>

                {/* Regex Preview & Copy / Apply */}
                <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                  <span className="font-mono text-slate-400 dark:text-slate-500 truncate" title={pattern.regexString}>
                    /{pattern.regexString}/
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyRegex(pattern.id, pattern.regexString)}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    >
                      {copiedId === pattern.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === pattern.id ? '已复制' : '复制正则'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onApplyRegexToSearch(pattern.regexString)}
                      className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>填入搜索</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
