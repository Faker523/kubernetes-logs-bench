import type { LogEntry, LogLevel } from '../types/k8s';

const ISO_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)$/;
const CRI_PREFIX_RE = /^(stdout|stderr)\s+[FP]\s+(.*)$/;
const KLOG_RE = /^([IWEF])(\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\d+\s+([^\]]+)\]\s+(.*)$/;
const SYSLOG_DATE_RE = /^(\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+(.*)$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return String(n);
}

export function formatTimeDisplay(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--:--.---';
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

export function normalizeLevel(rawLevel: unknown, fallbackText = ''): LogLevel {
  if (typeof rawLevel === 'string') {
    const up = rawLevel.trim().toUpperCase();
    if (up === 'ERR' || up === 'ERROR' || up === 'FATAL' || up === 'PANIC' || up === 'CRITICAL' || up === 'E' || up === 'F') {
      return 'ERROR';
    }
    if (up === 'WARN' || up === 'WARNING' || up === 'W') {
      return 'WARN';
    }
    if (up === 'INFO' || up === 'INF' || up === 'I' || up === 'NOTICE') {
      return 'INFO';
    }
    if (up === 'DEBUG' || up === 'DBG' || up === 'TRACE' || up === 'D') {
      return 'DEBUG';
    }
  }
  if (typeof rawLevel === 'number') {
    // Pino / Bunyan numeric levels
    if (rawLevel >= 50) return 'ERROR';
    if (rawLevel >= 40) return 'WARN';
    if (rawLevel >= 30) return 'INFO';
    if (rawLevel >= 10) return 'DEBUG';
  }

  const text = fallbackText;
  if (/\b(ERROR|ERR|FATAL|PANIC|Exception|Traceback|CrashLoopBackOff|OOMKilled)\b/i.test(text) || /\s5\d{2}\s/.test(text)) {
    return 'ERROR';
  }
  if (/\b(WARN|WARNING|DEPRECATED|RETRY|TIMEOUT)\b/i.test(text) || /\s4\d{2}\s/.test(text)) {
    return 'WARN';
  }
  if (/\b(DEBUG|TRACE)\b/i.test(text)) {
    return 'DEBUG';
  }
  if (/\b(INFO|STARTED|LISTENING|READY)\b/i.test(text)) {
    return 'INFO';
  }
  return 'UNKNOWN';
}

function isStackContinuation(line: string): boolean {
  if (!line.trim()) return false;
  return (
    /^\s+(at\s+|Caused by:|\.{3}\s+\d+\s+more|File\s+"|goroutine\s+\d+|runtime\.|panic:)/.test(line) ||
    /^(Caused by:|Traceback \(most recent call last\):|goroutine \d+ \[)/.test(line) ||
    /^\t+/.test(line) ||
    /^\s{2,}\S/.test(line)
  );
}

export function parseRawLogs(
  rawText: string,
  meta: { pod: string; namespace: string; container: string; nodeName?: string },
  idPrefix = 'log',
  startLineNumber = 1
): LogEntry[] {
  const lines = rawText.split(/\r?\n/);
  const entries: LogEntry[] = [];
  let lineCounter = startLineNumber;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine && i === lines.length - 1) continue;

    let working = rawLine;
    let timestampIso = '';
    let timestampMs = 0;
    let stream: 'stdout' | 'stderr' | undefined;

    // 1. Check K8s ISO timestamp prefix
    const isoMatch = working.match(ISO_PREFIX_RE);
    if (isoMatch) {
      timestampIso = isoMatch[1];
      const parsed = Date.parse(timestampIso);
      if (!Number.isNaN(parsed)) timestampMs = parsed;
      working = isoMatch[2];
    }

    // 2. Check CRI stdout/stderr prefix
    const criMatch = working.match(CRI_PREFIX_RE);
    if (criMatch) {
      stream = criMatch[1] as 'stdout' | 'stderr';
      working = criMatch[2];
    }

    // 3. Group stacktrace continuations with the previous entry if applicable
    if (entries.length > 0 && !working.trimStart().startsWith('{') && isStackContinuation(working)) {
      const prev = entries[entries.length - 1];
      prev.stackLines = prev.stackLines || [];
      prev.stackLines.push(working);
      prev.raw = `${prev.raw}\n${rawLine}`;
      if (prev.level === 'UNKNOWN' && /Exception|Error|panic/i.test(working)) {
        prev.level = 'ERROR';
      }
      continue;
    }

    let level: LogLevel = 'UNKNOWN';
    let message = working;
    let jsonPayload: Record<string, unknown> | undefined;
    let traceId: string | undefined;

    // 4. Try JSON log parsing
    const trimmedWork = working.trim();
    if (trimmedWork.startsWith('{') && trimmedWork.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmedWork) as Record<string, unknown>;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          jsonPayload = obj;
          const rawLvl = obj.level ?? obj.lvl ?? obj.severity ?? obj.log_level;
          const rawMsg = obj.msg ?? obj.message ?? obj.log ?? obj.event ?? obj.error;
          const rawTs = obj.ts ?? obj.timestamp ?? obj.time ?? obj['@timestamp'];

          if (!timestampIso && (typeof rawTs === 'string' || typeof rawTs === 'number')) {
            if (typeof rawTs === 'number') {
              timestampMs = rawTs > 1e12 ? rawTs : rawTs * 1000;
              timestampIso = new Date(timestampMs).toISOString();
            } else {
              const p = Date.parse(rawTs);
              if (!Number.isNaN(p)) {
                timestampMs = p;
                timestampIso = rawTs;
              }
            }
          }

          if (typeof rawMsg === 'string') {
            message = rawMsg;
          } else if (typeof obj.method === 'string' && typeof obj.path === 'string') {
            message = `${obj.method} ${obj.path} ${obj.status ?? ''} ${obj.latency_ms ? `${obj.latency_ms}ms` : ''}`.trim();
          }

          const rawTrace = obj.trace_id ?? obj.traceId ?? obj.request_id ?? obj.requestId ?? obj.correlationId;
          if (typeof rawTrace === 'string') {
            traceId = rawTrace;
          }

          level = normalizeLevel(rawLvl, message);
          if (level === 'UNKNOWN' && typeof obj.status === 'number') {
            if (obj.status >= 500) level = 'ERROR';
            else if (obj.status >= 400) level = 'WARN';
            else level = 'INFO';
          }
        }
      } catch {
        // Not valid JSON, fall back to plain text parsing
      }
    }

    // 5. Try klog format if not JSON
    if (!jsonPayload) {
      const klogMatch = working.match(KLOG_RE);
      if (klogMatch) {
        level = normalizeLevel(klogMatch[1]);
        message = `[${klogMatch[3]}] ${klogMatch[4]}`;
        if (!timestampIso) {
          const klogTime = klogMatch[2].match(/^(\d{2})(\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)$/);
          if (klogTime) {
            const year = new Date().getFullYear();
            const msStr = klogTime[3].slice(0, 12); // HH:MM:SS.mmm
            const p = Date.parse(`${year}-${klogTime[1]}-${klogTime[2]}T${msStr}`);
            if (!Number.isNaN(p)) {
              timestampMs = p;
              timestampIso = new Date(p).toISOString();
            }
          }
        }
      } else {
        // Try embedded syslog-style date if no ISO prefix
        if (!timestampIso) {
          const sysMatch = working.match(SYSLOG_DATE_RE);
          if (sysMatch) {
            const normalized = sysMatch[1].replace(',', '.').replace(' ', 'T');
            const p = Date.parse(normalized);
            if (!Number.isNaN(p)) {
              timestampMs = p;
              timestampIso = new Date(p).toISOString();
              working = sysMatch[2];
              message = working;
            }
          }
        }
        level = normalizeLevel(undefined, message);
        if (level === 'UNKNOWN' && stream === 'stderr') {
          level = 'WARN';
        }
        const traceMatch = message.match(/(?:trace_id|traceId|req_id|request_id)[=:\s]+([a-zA-Z0-9_-]{6,36})/i);
        if (traceMatch) {
          traceId = traceMatch[1];
        }
      }
    }

    if (!timestampMs) {
      timestampMs = Date.now() - (lines.length - i) * 150;
      timestampIso = new Date(timestampMs).toISOString();
    }

    entries.push({
      id: `${idPrefix}-${lineCounter}-${i}`,
      lineNumber: lineCounter++,
      timestampIso,
      timestampMs,
      timeDisplay: formatTimeDisplay(timestampMs),
      level,
      message,
      raw: rawLine,
      pod: meta.pod,
      namespace: meta.namespace,
      container: meta.container,
      nodeName: meta.nodeName,
      stream,
      jsonPayload,
      traceId,
    });
  }

  return entries;
}

export function exportLogsToFile(entries: LogEntry[], format: 'log' | 'json', filenamePrefix: string): void {
  let content = '';
  let mime = 'text/plain;charset=utf-8';
  const ext = format === 'json' ? 'json' : 'log';

  if (format === 'json') {
    content = JSON.stringify(
      entries.map((e) => ({
        lineNumber: e.lineNumber,
        timestamp: e.timestampIso,
        namespace: e.namespace,
        pod: e.pod,
        container: e.container,
        level: e.level,
        message: e.message,
        ...(e.jsonPayload ? { fields: e.jsonPayload } : {}),
        ...(e.stackLines ? { stack: e.stackLines } : {}),
      })),
      null,
      2
    );
    mime = 'application/json;charset=utf-8';
  } else {
    content = entries
      .map((e) => `[${e.timestampIso}] [${e.namespace}/${e.pod}:${e.container}] [${e.level}] ${e.message}${e.stackLines?.length ? '\n' + e.stackLines.join('\n') : ''}`)
      .join('\n');
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
