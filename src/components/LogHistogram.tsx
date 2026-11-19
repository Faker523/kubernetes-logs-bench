import { BarChart2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../types/k8s';
import { formatTimeDisplay } from '../utils/logParser';
import { type HistogramBucket, HistogramTrendPopover } from './HistogramTrendPopover';

interface LogHistogramProps {
  entries: LogEntry[];
  activeRange: { startMs: number; endMs: number } | null;
  activeLevels: LogLevel[];
  onSelectRange: (range: { startMs: number; endMs: number } | null) => void;
  onToggleLevelFilter: (level: LogLevel) => void;
}

export function LogHistogram({
  entries,
  activeRange,
  activeLevels,
  onSelectRange,
  onToggleLevelFilter,
}: LogHistogramProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { buckets, maxTotal } = useMemo(() => {
    if (entries.length === 0) return { buckets: [] as HistogramBucket[], maxTotal: 0 };

    let minMs = entries[0].timestampMs;
    let maxMs = entries[0].timestampMs;
    for (const e of entries) {
      if (e.timestampMs < minMs) minMs = e.timestampMs;
      if (e.timestampMs > maxMs) maxMs = e.timestampMs;
    }

    const bucketCount = 36;
    const span = Math.max(maxMs - minMs, bucketCount * 1000);
    const step = span / bucketCount;

    const list: HistogramBucket[] = Array.from({ length: bucketCount }, (_, idx) => ({
      index: idx,
      startMs: minMs + idx * step,
      endMs: minMs + (idx + 1) * step,
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
      debugCount: 0,
      unknownCount: 0,
      total: 0,
    }));

    for (const e of entries) {
      let idx = Math.floor((e.timestampMs - minMs) / step);
      if (idx >= bucketCount) idx = bucketCount - 1;
      if (idx < 0) idx = 0;
      const b = list[idx];
      b.total += 1;
      if (e.level === 'ERROR') b.errorCount += 1;
      else if (e.level === 'WARN') b.warnCount += 1;
      else if (e.level === 'INFO') b.infoCount += 1;
      else if (e.level === 'DEBUG') b.debugCount += 1;
      else b.unknownCount += 1;
    }

    const max = Math.max(...list.map((b) => b.total), 1);
    return { buckets: list, maxTotal: max };
  }, [entries]);

  const activeBucket = useMemo(() => {
    if (!activeRange || buckets.length === 0) return null;
    const exact = buckets.find(
      (b) =>
        Math.abs(activeRange.startMs - b.startMs) < 1 &&
        Math.abs(activeRange.endMs - b.endMs) < 1
    );
    if (exact) return exact;

    let best: HistogramBucket | null = null;
    let bestOverlap = 0;
    for (const b of buckets) {
      const overlap = Math.min(activeRange.endMs, b.endMs) - Math.max(activeRange.startMs, b.startMs);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = b;
      }
    }
    return best;
  }, [buckets, activeRange]);

  useEffect(() => {
    if (!activeRange) {
      setPanelOpen(false);
    }
  }, [activeRange]);

  useEffect(() => {
    if (!panelOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen]);

  if (entries.length < 2) return null;

  const anchorPercent = activeBucket
    ? ((activeBucket.index + 0.5) / buckets.length) * 100
    : 50;

  return (
    <div ref={wrapperRef} className="relative shrink-0 border-b border-slate-200 dark:border-slate-800/90 bg-slate-50/80 dark:bg-[#0D121C] px-4 py-2">
      <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
        <span>
          时间分布 ({formatTimeDisplay(buckets[0].startMs)} – {formatTimeDisplay(buckets[buckets.length - 1].endMs)})
        </span>
        <div className="flex items-center gap-3">
          <span>正常</span>
          <span className="text-amber-600 dark:text-amber-400">WARN</span>
          <span className="text-red-600 dark:text-red-400">ERROR</span>
          {activeBucket && !panelOpen && (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
            >
              <BarChart2 className="w-3 h-3" />
              <span>趋势分析</span>
            </button>
          )}
          {activeRange && (
            <button
              type="button"
              onClick={() => {
                onSelectRange(null);
                setPanelOpen(false);
              }}
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
            >
              <span>清除时间窗口</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="h-8 flex items-end gap-[2px]">
        {buckets.map((bucket) => {
          const heightPct = bucket.total === 0 ? 0 : Math.max(12, Math.round((bucket.total / maxTotal) * 100));
          const errPct = bucket.total === 0 ? 0 : (bucket.errorCount / bucket.total) * 100;
          const warnPct = bucket.total === 0 ? 0 : (bucket.warnCount / bucket.total) * 100;
          const otherPct = Math.max(0, 100 - errPct - warnPct);
          const isSelected = activeBucket?.index === bucket.index;

          return (
            <button
              key={bucket.index}
              type="button"
              onClick={() => {
                if (isSelected) {
                  onSelectRange(null);
                  setPanelOpen(false);
                } else {
                  onSelectRange({ startMs: bucket.startMs, endMs: bucket.endMs });
                  setPanelOpen(true);
                }
              }}
              title={`${formatTimeDisplay(bucket.startMs)} - ${formatTimeDisplay(bucket.endMs)}\n总计: ${bucket.total} (ERROR: ${bucket.errorCount}, WARN: ${bucket.warnCount})`}
              className={`flex-1 h-full flex flex-col justify-end rounded-t-[2px] transition-opacity focus:outline-none ${
                activeRange && !isSelected ? 'opacity-35 hover:opacity-80' : 'opacity-95 hover:opacity-100'
              }`}
            >
              {bucket.total > 0 ? (
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-full flex flex-col overflow-hidden rounded-t-[2px] ${
                    isSelected ? 'ring-1 ring-sky-500' : ''
                  }`}
                >
                  {errPct > 0 && (
                    <div style={{ height: `${errPct}%` }} className="w-full bg-red-500" />
                  )}
                  {warnPct > 0 && (
                    <div style={{ height: `${warnPct}%` }} className="w-full bg-amber-500" />
                  )}
                  {otherPct > 0 && (
                    <div style={{ height: `${otherPct}%` }} className="w-full bg-slate-400/60 dark:bg-slate-600/70" />
                  )}
                </div>
              ) : (
                <div className="w-full h-[2px] bg-slate-200 dark:bg-slate-800/60" />
              )}
            </button>
          );
        })}
      </div>

      {panelOpen && activeBucket && (
        <HistogramTrendPopover
          bucket={activeBucket}
          allBuckets={buckets}
          allEntries={entries}
          activeLevels={activeLevels}
          anchorPercent={anchorPercent}
          onSelectBucket={(b) => {
            onSelectRange({ startMs: b.startMs, endMs: b.endMs });
            setPanelOpen(true);
          }}
          onToggleLevelFilter={onToggleLevelFilter}
          onClearRange={() => {
            onSelectRange(null);
            setPanelOpen(false);
          }}
          onClosePanel={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

