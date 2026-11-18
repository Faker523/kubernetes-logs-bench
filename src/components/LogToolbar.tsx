import { Pause, Play, RefreshCw, Search, X } from 'lucide-react';
import { useRef } from 'react';
import type { FilterState, LogLevel } from '../types/k8s';

interface LogToolbarProps {
  filters: FilterState;
  onChangeFilters: (next: Partial<FilterState>) => void;
  levelCounts: Record<LogLevel | 'ALL', number>;
  isLiveTail: boolean;
  onToggleLiveTail: () => void;
  onRefreshLogs: () => void;
  isLoadingLogs: boolean;
  canLiveTail: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function LogToolbar({
  filters,
  onChangeFilters,
  levelCounts,
  isLiveTail,
  onToggleLiveTail,
  onRefreshLogs,
  isLoadingLogs,
  canLiveTail,
  searchInputRef,
}: LogToolbarProps) {
  const excludeInputRef = useRef<HTMLInputElement>(null);

  const toggleLevel = (lvl: LogLevel) => {
    const exists = filters.levels.includes(lvl);
    const next = exists
      ? filters.levels.filter((item) => item !== lvl)
      : [...filters.levels, lvl];
    onChangeFilters({ levels: next });
  };

  return (
    <div className="shrink-0 border-b border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0F141F] px-4 py-2.5 space-y-2.5">
      {/* Row 1: Search, Exclude, Live Tail */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Search Input with Regex & Case toggles */}
        <div className="flex-1 min-w-[260px] flex items-center h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131926] focus-within:ring-2 focus-within:ring-sky-500 px-2.5 gap-1.5">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={filters.search}
            onChange={(e) => onChangeFilters({ search: e.target.value })}
            placeholder={filters.isRegex ? '输入正则表达式过滤日志 (快捷键 /)...' : '搜索日志关键词、Trace ID、状态码 (快捷键 /)...'}
            className="flex-1 min-w-0 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onChangeFilters({ search: '' })}
              aria-label="清除搜索"
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onChangeFilters({ caseSensitive: !filters.caseSensitive })}
            title="区分大小写"
            className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              filters.caseSensitive
                ? 'bg-sky-600 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => onChangeFilters({ isRegex: !filters.isRegex })}
            title="启用正则表达式"
            className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
              filters.isRegex
                ? 'bg-sky-600 text-white'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            .*
          </button>
        </div>

        {/* Exclude Pattern */}
        <div className="w-48 lg:w-56 flex items-center h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131926] focus-within:ring-2 focus-within:ring-sky-500 px-2.5 gap-1.5">
          <span className="font-mono text-[11px] text-slate-400 shrink-0">-v</span>
          <input
            ref={excludeInputRef}
            type="text"
            value={filters.exclude}
            onChange={(e) => onChangeFilters({ exclude: e.target.value })}
            placeholder="排除关键词..."
            className="flex-1 min-w-0 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          {filters.exclude && (
            <button
              type="button"
              onClick={() => onChangeFilters({ exclude: '' })}
              aria-label="清除排除词"
              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Tail Lines Selector */}
        <select
          aria-label="拉取行数"
          value={filters.tailLines}
          onChange={(e) => onChangeFilters({ tailLines: Number(e.target.value) })}
          className="h-9 px-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131926] text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 shrink-0"
        >
          <option value={100}>最近 100 行</option>
          <option value={500}>最近 500 行</option>
          <option value={2000}>最近 2000 行</option>
          <option value={0}>全部日志</option>
        </select>

        {/* Refresh Logs Button */}
        <button
          type="button"
          onClick={onRefreshLogs}
          disabled={isLoadingLogs}
          title="重新拉取日志"
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>

        {/* Live Tail Button */}
        <button
          type="button"
          disabled={!canLiveTail}
          onClick={onToggleLiveTail}
          className={`h-9 px-3.5 inline-flex items-center gap-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40 disabled:pointer-events-none ${
            isLiveTail
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
              : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131926] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          {isLiveTail ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              <span>实时追踪中</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              <span>实时追踪</span>
            </>
          )}
        </button>
      </div>

      {/* Row 2: Level Filters & Display Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Level Segmented Controls */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => onChangeFilters({ levels: [] })}
            className={`h-7 px-2.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 font-mono ${
              filters.levels.length === 0
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            全部 ({levelCounts.ALL})
          </button>

          {(
            [
              { level: 'ERROR', activeClass: 'bg-red-600 text-white', idleClass: 'text-red-600 dark:text-red-400 hover:bg-red-500/10' },
              { level: 'WARN', activeClass: 'bg-amber-600 text-white', idleClass: 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10' },
              { level: 'INFO', activeClass: 'bg-sky-600 text-white', idleClass: 'text-sky-600 dark:text-sky-400 hover:bg-sky-500/10' },
              { level: 'DEBUG', activeClass: 'bg-slate-600 text-white', idleClass: 'text-slate-600 dark:text-slate-400 hover:bg-slate-500/10' },
            ] as const
          ).map(({ level, activeClass, idleClass }) => {
            const active = filters.levels.includes(level);
            return (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                className={`h-7 px-2.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 font-mono ${
                  active ? activeClass : idleClass
                }`}
              >
                {level} ({levelCounts[level]})
              </button>
            );
          })}

          {filters.fieldFilter && (
            <button
              type="button"
              onClick={() => onChangeFilters({ fieldFilter: null })}
              className="h-7 px-2.5 ml-1 rounded bg-sky-500/12 text-sky-700 dark:text-sky-300 text-xs font-mono inline-flex items-center gap-1.5 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              <span>
                {filters.fieldFilter.negate ? '!=' : '='} {filters.fieldFilter.key}:{filters.fieldFilter.value}
              </span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Display Options */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { key: 'showTimestamp' as const, label: '时间戳' },
            { key: 'showLineNumbers' as const, label: '行号' },
            { key: 'wrapLines' as const, label: '自动换行' },
            { key: 'jsonPreview' as const, label: 'JSON 摘要' },
            { key: 'contextLines' as const, label: '匹配上下文 ±3行' },
          ].map((opt) => {
            const active = filters[opt.key];
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChangeFilters({ [opt.key]: !active })}
                className={`h-7 px-2.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                  active
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
