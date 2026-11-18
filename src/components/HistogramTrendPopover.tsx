import { AlertTriangle, ChevronLeft, ChevronRight, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useMemo } from 'react';
import type { LogEntry, LogLevel } from '../types/k8s';
import { formatTimeDisplay } from '../utils/logParser';

export interface HistogramBucket {
  index: number;
  startMs: number;
  endMs: number;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  debugCount: number;
  unknownCount: number;
  total: number;
}

interface LevelMetric {
  level: LogLevel;
  label: string;
  bucketCount: number;
  bucketShare: number;
  globalCount: number;
  globalShare: number;
  deltaPp: number;
  textClass: string;
  barClass: string;
}

interface SpikeAlert {
  severity: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
}

interface HistogramTrendPopoverProps {
  bucket: HistogramBucket;
  allBuckets: HistogramBucket[];
  allEntries: LogEntry[];
  activeLevels: LogLevel[];
  anchorPercent: number;
  onSelectBucket: (bucket: HistogramBucket) => void;
  onToggleLevelFilter: (level: LogLevel) => void;
  onClearRange: () => void;
  onClosePanel: () => void;
}

function formatDeltaPp(delta: number): string {
  const abs = Math.abs(delta).toFixed(1);
  if (Math.abs(delta) < 0.05) return '0.0%';
  return delta > 0 ? `+${abs}%` : `-${abs}%`;
}

export function HistogramTrendPopover({
  bucket,
  allBuckets,
  allEntries,
  activeLevels,
  anchorPercent,
  onSelectBucket,
  onToggleLevelFilter,
  onClearRange,
  onClosePanel,
}: HistogramTrendPopoverProps) {
  const analysis = useMemo(() => {
    const globalTotal = allEntries.length || 1;
    const bucketTotal = bucket.total;

    const globalCounts: Record<LogLevel, number> = {
      ERROR: 0,
      WARN: 0,
      INFO: 0,
      DEBUG: 0,
      UNKNOWN: 0,
    };
    for (const entry of allEntries) {
      globalCounts[entry.level] += 1;
    }

    const bucketCounts: Record<LogLevel, number> = {
      ERROR: bucket.errorCount,
      WARN: bucket.warnCount,
      INFO: bucket.infoCount,
      DEBUG: bucket.debugCount,
      UNKNOWN: bucket.unknownCount,
    };

    const defs: Array<{
      level: LogLevel;
      label: string;
      textClass: string;
      barClass: string;
    }> = [
      {
        level: 'ERROR',
        label: 'ERROR',
        textClass: 'text-red-600 dark:text-red-400',
        barClass: 'bg-red-500',
      },
      {
        level: 'WARN',
        label: 'WARN',
        textClass: 'text-amber-600 dark:text-amber-400',
        barClass: 'bg-amber-500',
      },
      {
        level: 'INFO',
        label: 'INFO',
        textClass: 'text-sky-600 dark:text-sky-400',
        barClass: 'bg-sky-500',
      },
      {
        level: 'DEBUG',
        label: 'DEBUG',
        textClass: 'text-slate-600 dark:text-slate-400',
        barClass: 'bg-slate-400 dark:bg-slate-500',
      },
    ];

    if (globalCounts.UNKNOWN > 0 || bucketCounts.UNKNOWN > 0) {
      defs.push({
        level: 'UNKNOWN',
        label: 'LOG',
        textClass: 'text-slate-500 dark:text-slate-400',
        barClass: 'bg-slate-300 dark:bg-slate-600',
      });
    }

    const metrics: LevelMetric[] = defs.map((d) => {
      const bCount = bucketCounts[d.level];
      const gCount = globalCounts[d.level];
      const bShare = bucketTotal > 0 ? (bCount / bucketTotal) * 100 : 0;
      const gShare = (gCount / globalTotal) * 100;
      return {
        level: d.level,
        label: d.label,
        bucketCount: bCount,
        bucketShare: bShare,
        globalCount: gCount,
        globalShare: gShare,
        deltaPp: bucketTotal > 0 ? bShare - gShare : 0,
        textClass: d.textClass,
        barClass: d.barClass,
      };
    });

    // Compute average non-empty bucket volume
    const nonEmptyBuckets = allBuckets.filter((b) => b.total > 0);
    const avgBucketTotal =
      nonEmptyBuckets.length > 0
        ? nonEmptyBuckets.reduce((sum, b) => sum + b.total, 0) / nonEmptyBuckets.length
        : 0;
    const volumeRatio = avgBucketTotal > 0 ? bucketTotal / avgBucketTotal : 0;

    // Anomaly / Spike Detection comparing this window against full dataset baseline
    const alerts: SpikeAlert[] = [];
    const errMetric = metrics.find((m) => m.level === 'ERROR');
    const warnMetric = metrics.find((m) => m.level === 'WARN');

    if (bucketTotal > 0 && errMetric && errMetric.bucketCount > 0) {
      const errMultiplier =
        errMetric.globalShare > 0 ? errMetric.bucketShare / errMetric.globalShare : Infinity;
      if (errMetric.deltaPp >= 10 || (errMultiplier >= 2 && errMetric.bucketShare >= 15)) {
        alerts.push({
          severity: 'error',
          title: 'ERROR 占比突变升高',
          detail: `当前区间 ERROR 占比 ${errMetric.bucketShare.toFixed(1)}%，较全量基线 (${errMetric.globalShare.toFixed(1)}%) 上升 ${formatDeltaPp(errMetric.deltaPp)}`,
        });
      }
    }

    if (bucketTotal > 0 && warnMetric && warnMetric.bucketCount > 0) {
      const warnMultiplier =
        warnMetric.globalShare > 0 ? warnMetric.bucketShare / warnMetric.globalShare : Infinity;
      if (warnMetric.deltaPp >= 12 || (warnMultiplier >= 2 && warnMetric.bucketShare >= 20)) {
        alerts.push({
          severity: 'warn',
          title: 'WARN 占比明显上升',
          detail: `当前区间 WARN 占比 ${warnMetric.bucketShare.toFixed(1)}%，较全量基线 (${warnMetric.globalShare.toFixed(1)}%) 上升 ${formatDeltaPp(warnMetric.deltaPp)}`,
        });
      }
    }

    if (bucketTotal >= 3 && volumeRatio >= 2.0) {
      alerts.push({
        severity: 'warn',
        title: '日志流量突增',
        detail: `区间共 ${bucketTotal} 条日志，为单桶平均密度 (${avgBucketTotal.toFixed(1)} 条) 的 ${volumeRatio.toFixed(1)}x`,
      });
    }

    if (alerts.length === 0) {
      if (bucketTotal === 0) {
        alerts.push({
          severity: 'info',
          title: '空时间区间',
          detail: '该时间窗口内未采集到日志记录。',
        });
      } else {
        alerts.push({
          severity: 'info',
          title: '分布平稳 · 无异常突变',
          detail: `各级别占比与全量数据基本一致（共 ${bucketTotal} 条，密度 ${volumeRatio.toFixed(1)}x 均值）。`,
        });
      }
    }

    return {
      metrics,
      volumeRatio,
      avgBucketTotal,
      alerts,
      globalTotal: allEntries.length,
    };
  }, [bucket, allBuckets, allEntries]);

  const nonEmptyIndices = useMemo(
    () => allBuckets.filter((b) => b.total > 0).map((b) => b.index),
    [allBuckets]
  );

  const currentNonEmptyPos = nonEmptyIndices.indexOf(bucket.index);
  const prevBucket =
    currentNonEmptyPos > 0
      ? allBuckets[nonEmptyIndices[currentNonEmptyPos - 1]]
      : bucket.index > 0
        ? allBuckets[bucket.index - 1]
        : null;
  const nextBucket =
    currentNonEmptyPos >= 0 && currentNonEmptyPos < nonEmptyIndices.length - 1
      ? allBuckets[nonEmptyIndices[currentNonEmptyPos + 1]]
      : bucket.index < allBuckets.length - 1
        ? allBuckets[bucket.index + 1]
        : null;

  // Position panel horizontally based on clicked bucket percent, clamped within container
  const horizontalStyle =
    anchorPercent > 65
      ? { right: '16px' }
      : anchorPercent < 25
        ? { left: '16px' }
        : { left: `${anchorPercent}%`, transform: 'translateX(-50%)' };

  return (
    <div
      role="region"
      aria-label="直方图时间区间趋势分析面板"
      style={horizontalStyle}
      className="absolute top-full mt-1.5 z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] shadow-xl p-4 space-y-3.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            区间趋势与突变分析
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {formatTimeDisplay(bucket.startMs)} – {formatTimeDisplay(bucket.endMs)}
            <span className="mx-1.5 text-slate-300 dark:text-slate-700">·</span>
            <span>{bucket.total} / {analysis.globalTotal} 条</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!prevBucket}
            onClick={() => prevBucket && onSelectBucket(prevBucket)}
            aria-label="上一个时间区间"
            title="上一个有日志的时间区间"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!nextBucket}
            onClick={() => nextBucket && onSelectBucket(nextBucket)}
            aria-label="下一个时间区间"
            title="下一个有日志的时间区间"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClosePanel}
            aria-label="收起分析面板"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Anomaly / Spike Alerts */}
      <div className="space-y-1.5">
        {analysis.alerts.map((alert, idx) => {
          const surfaceClass =
            alert.severity === 'error'
              ? 'border-red-200 dark:border-red-900/60 bg-red-500/[0.06] text-red-700 dark:text-red-300'
              : alert.severity === 'warn'
                ? 'border-amber-200 dark:border-amber-900/60 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300';

          return (
            <div
              key={idx}
              className={`rounded-md border px-3 py-2 text-xs space-y-0.5 ${surfaceClass}`}
            >
              <div className="flex items-center gap-1.5 font-semibold">
                {alert.severity !== 'info' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                <span>{alert.title}</span>
              </div>
              <div className="text-[11px] opacity-90 leading-relaxed font-mono">
                {alert.detail}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stacked Ratio Comparison Bars */}
      {bucket.total > 0 && (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>当前区间构成</span>
              <span className="font-mono">100%</span>
            </div>
            <div className="h-2 w-full rounded-[2px] overflow-hidden flex bg-slate-100 dark:bg-slate-800">
              {analysis.metrics.map((m) =>
                m.bucketShare > 0 ? (
                  <div
                    key={m.level}
                    style={{ width: `${m.bucketShare}%` }}
                    title={`${m.label}: ${m.bucketShare.toFixed(1)}%`}
                    className={`h-full ${m.barClass}`}
                  />
                ) : null
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>全量基线构成</span>
              <span className="font-mono">100%</span>
            </div>
            <div className="h-1.5 w-full rounded-[2px] overflow-hidden flex bg-slate-100 dark:bg-slate-800 opacity-75">
              {analysis.metrics.map((m) =>
                m.globalShare > 0 ? (
                  <div
                    key={m.level}
                    style={{ width: `${m.globalShare}%` }}
                    title={`${m.label}: ${m.globalShare.toFixed(1)}%`}
                    className={`h-full ${m.barClass}`}
                  />
                ) : null
              )}
            </div>
          </div>
        </div>
      )}

      {/* Level Delta Comparison Table */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5">
        <div className="grid grid-cols-[68px_1fr_72px_84px] gap-2 px-1.5 pb-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-medium">
          <span>级别</span>
          <span className="text-right">区间占比</span>
          <span className="text-right">全量基线</span>
          <span className="text-right">占比变化</span>
        </div>

        <div className="space-y-0.5">
          {analysis.metrics.map((m) => {
            const isLevelFiltered = activeLevels.includes(m.level);
            const isElevated = (m.level === 'ERROR' || m.level === 'WARN') && m.deltaPp >= 5;
            const isReduced = m.deltaPp <= -5;

            return (
              <button
                key={m.level}
                type="button"
                onClick={() => onToggleLevelFilter(m.level)}
                title={`点击筛选或取消筛选 ${m.label} 级别日志`}
                className={`w-full grid grid-cols-[68px_1fr_72px_84px] gap-2 items-center px-1.5 py-1.5 rounded text-xs font-mono transition-colors text-left ${
                  isLevelFiltered
                    ? 'bg-sky-500/12 dark:bg-sky-500/18'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className={`font-semibold ${m.textClass}`}>{m.label}</span>
                <span className="text-right text-slate-800 dark:text-slate-200">
                  {m.bucketCount} ({m.bucketShare.toFixed(1)}%)
                </span>
                <span className="text-right text-slate-500 dark:text-slate-400">
                  {m.globalShare.toFixed(1)}%
                </span>
                <span
                  className={`text-right inline-flex items-center justify-end gap-1 ${
                    isElevated
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : m.deltaPp > 0.05
                        ? 'text-slate-700 dark:text-slate-300'
                        : isReduced
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {m.deltaPp > 0.5 && <TrendingUp className="w-3 h-3 shrink-0" />}
                  {m.deltaPp < -0.5 && <TrendingDown className="w-3 h-3 shrink-0" />}
                  <span>{formatDeltaPp(m.deltaPp)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
        <span className="text-slate-400 dark:text-slate-500">
          点击级别行可联动过滤日志
        </span>
        <button
          type="button"
          onClick={onClearRange}
          className="text-sky-600 dark:text-sky-400 hover:underline font-medium"
        >
          清除时间过滤
        </button>
      </div>
    </div>
  );
}
