import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { LogEntry } from '../types/k8s';
import { formatTimeDisplay } from '../utils/logParser';

interface LogHistogramProps {
  entries: LogEntry[];
  activeRange: { startMs: number; endMs: number } | null;
  onSelectRange: (range: { startMs: number; endMs: number } | null) => void;
}

interface Bucket {
  startMs: number;
  endMs: number;
  errorCount: number;
  warnCount: number;
  otherCount: number;
  total: number;
}

export function LogHistogram({ entries, activeRange, onSelectRange }: LogToolbarHistogramProps) {
  const { buckets, maxTotal } = useMemo(() => {
    if (entries.length === 0) return { buckets: [] as Bucket[], maxTotal: 0 };

    let minMs = entries[0].timestampMs;
    let maxMs = entries[0].timestampMs;
    for (const e of entries) {
      if (e.timestampMs < minMs) minMs = e.timestampMs;
      if (e.timestampMs > maxMs) maxMs = e.timestampMs;
    }

    const bucketCount = 36;
    const span = Math.max(maxMs - minMs, bucketCount * 1000);
    const step = span / bucketCount;

    const list: Bucket[] = Array.from({ length: bucketCount }, (_, idx) => ({
      startMs: minMs + idx * step,
      endMs: minMs + (idx + 1) * step,
      errorCount: 0,
      warnCount: 0,
      otherCount: 0,
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
      else b.otherCount += 1;
    }

    const max = Math.max(...list.map((b) => b.total), 1);
    return { buckets: list, maxTotal: max };
  }, [entries]);

  if (entries.length < 2) return null;

  return (
    <div className="shrink-0 border-b border-slate-200 dark:border-slate-800/90 bg-slate-50/80 dark:bg-[#0D121C] px-4 py-2">
      <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
        <span>
          时间分布 ({formatTimeDisplay(buckets[0].startMs)} – {formatTimeDisplay(buckets[buckets.length - 1].endMs)})
        </span>
        <div className="flex items-center gap-3">
          <span>正常</span>
          <span className="text-amber-600 dark:text-amber-400">WARN</span>
          <span className="text-red-600 dark:text-red-400">ERROR</span>
          {activeRange && (
            <button
              type="button"
              onClick={() => onSelectRange(null)}
              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline"
            >
              <span>清除时间窗口</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="h-8 flex items-end gap-[2px]">
        {buckets.map((bucket, idx) => {
          const heightPct = bucket.total === 0 ? 0 : Math.max(12, Math.round((bucket.total / maxTotal) * 100));
          const errPct = bucket.total === 0 ? 0 : (bucket.errorCount / bucket.total) * 100;
          const warnPct = bucket.total === 0 ? 0 : (bucket.warnCount / bucket.total) * 100;
          const otherPct = Math.max(0, 100 - errPct - warnPct);
          const isSelected =
            activeRange &&
            Math.abs(activeRange.startMs - bucket.startMs) < 1 &&
            Math.abs(activeRange.endMs - bucket.endMs) < 1;

          return (
            <button
              key={idx}
              type="button"
              onClick={() =>
                onSelectRange(
                  isSelected ? null : { startMs: bucket.startMs, endMs: bucket.endMs }
                )
              }
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
    </div>
  );
}

type LogToolbarHistogramProps = LogHistogramProps;
