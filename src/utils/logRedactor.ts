import type {
  AiEntryExplainPayload,
  RedactionCounts,
  SanitizedLogContext,
  SanitizedLogExcerpt,
} from '../types/ai';
import type { ClusterConfig, LogEntry, LogLevel, SelectedTarget } from '../types/k8s';
import type { LogPattern } from './logPatternDetector';

export function emptyRedactionCounts(): RedactionCounts {
  return {
    tokens: 0,
    secrets: 0,
    ips: 0,
    privateKeys: 0,
    emails: 0,
    total: 0,
  };
}

export function mergeRedactionCounts(target: RedactionCounts, delta: RedactionCounts): RedactionCounts {
  target.tokens += delta.tokens;
  target.secrets += delta.secrets;
  target.ips += delta.ips;
  target.privateKeys += delta.privateKeys;
  target.emails += delta.emails;
  target.total += delta.total;
  return target;
}

export function redactSensitiveText(input: string): { text: string; counts: RedactionCounts } {
  const counts = emptyRedactionCounts();
  if (!input) return { text: '', counts };

  let text = input;

  // 1. PEM private keys
  text = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    () => {
      counts.privateKeys += 1;
      counts.total += 1;
      return '[REDACTED_PRIVATE_KEY]';
    }
  );

  // 2. Bearer / Basic Authorization headers
  text = text.replace(
    /(\b(?:Authorization|Proxy-Authorization)\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+)([A-Za-z0-9\-._~+/=]{8,})/gi,
    (_m, prefix: string) => {
      counts.tokens += 1;
      counts.total += 1;
      return `${prefix}[REDACTED_TOKEN]`;
    }
  );

  text = text.replace(/\b(Bearer\s+)([A-Za-z0-9\-._~+/=]{12,})/g, (_m, prefix: string) => {
    counts.tokens += 1;
    counts.total += 1;
    return `${prefix}[REDACTED_TOKEN]`;
  });

  // 3. JWT tokens (3 base64url segments starting with eyJ)
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => {
    counts.tokens += 1;
    counts.total += 1;
    return '[REDACTED_JWT]';
  });

  // 4. Common cloud / API key prefixes
  text = text.replace(
    /\b(?:AIza[0-9A-Za-z\-_]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk-(?:proj-|live-|test-)?[A-Za-z0-9\-_]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
    () => {
      counts.secrets += 1;
      counts.total += 1;
      return '[REDACTED_API_KEY]';
    }
  );

  // 5. URL embedded credentials (e.g. postgres://user:pass@host)
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^/\s@]{3,})(@)/gi, (_m, p1: string, _p2: string, p3: string) => {
    counts.secrets += 1;
    counts.total += 1;
    return `${p1}[REDACTED_SECRET]${p3}`;
  });

  // 6. Key-value / JSON sensitive fields
  text = text.replace(
    /((?:["']?)(?:password|passwd|pwd|secret|client_secret|api_key|apikey|access_key|secret_key|private_key|access_token|refresh_token|id_token|auth_token|session_token|cookie|set-cookie|token)(?:["']?)\s*[:=]\s*["']?)([^\s"',;}\]]{4,})/gi,
    (_m, prefix: string, val: string) => {
      if (val.startsWith('[REDACTED_')) return `${prefix}${val}`;
      counts.secrets += 1;
      counts.total += 1;
      return `${prefix}[REDACTED_SECRET]`;
    }
  );

  // 7. IPv4 addresses (excluding common k8s/semver prefixes like v1.2.3.4)
  text = text.replace(
    /(?<![A-Za-z0-9_.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{1,5})?(?![A-Za-z0-9_.])/g,
    () => {
      counts.ips += 1;
      counts.total += 1;
      return '[REDACTED_IP]';
    }
  );

  // 8. IPv6 addresses (compressed or full hex notation with >= 3 colons or ::)
  text = text.replace(
    /(?<![A-Za-z0-9:])(?:(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}::(?:[0-9a-fA-F]{1,4}:?){0,5}|::(?:[0-9a-fA-F]{1,4}:){1,6}[0-9a-fA-F]{1,4})(?![A-Za-z0-9:])/g,
    () => {
      counts.ips += 1;
      counts.total += 1;
      return '[REDACTED_IP]';
    }
  );

  // 9. Email addresses
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => {
    counts.emails += 1;
    counts.total += 1;
    return '[REDACTED_EMAIL]';
  });

  return { text, counts };
}

function isAlertEntry(entry: LogEntry): boolean {
  if (/Exception|Critical/i.test(entry.raw)) return true;
  if (entry.stackLines?.some((line) => /Exception|Critical/i.test(line))) return true;
  return false;
}

export function buildSanitizedLogContext(params: {
  cluster: ClusterConfig;
  selectedTarget: SelectedTarget | null;
  isMultiPodMode: boolean;
  multiPodCount: number;
  rawEntries: LogEntry[];
  visibleEntries: LogEntry[];
  levelCounts: Record<LogLevel | 'ALL', number>;
  patterns: LogPattern[];
}): SanitizedLogContext {
  const {
    cluster,
    selectedTarget,
    isMultiPodMode,
    multiPodCount,
    rawEntries,
    visibleEntries,
    levelCounts,
    patterns,
  } = params;

  const redaction = emptyRedactionCounts();
  const redactStr = (s: string) => {
    const r = redactSensitiveText(s);
    mergeRedactionCounts(redaction, r.counts);
    return r.text;
  };

  // Prefer visibleEntries if user actively filtered, otherwise rawEntries
  const pool = visibleEntries.length > 0 ? visibleEntries : rawEntries;

  let alertHitCount = 0;
  for (const e of pool) {
    if (isAlertEntry(e)) alertHitCount += 1;
  }

  // Top 12 patterns (prioritizing ERROR/WARN first, then high frequency)
  const sortedPatterns = [...patterns].sort((a, b) => {
    const score = (p: LogPattern) => (p.level === 'ERROR' ? 2 : p.level === 'WARN' ? 1 : 0);
    return score(b) - score(a) || b.count - a.count;
  });

  const topPatterns = sortedPatterns.slice(0, 12).map((p) => ({
    level: p.level,
    count: p.count,
    sharePct: Number(p.sharePct.toFixed(1)),
    template: redactStr(p.template.slice(0, 260)),
  }));

  // Select representative excerpts within ~14KB char budget:
  // Priority 1: Exception / Critical / ERROR lines (up to 35)
  // Priority 2: WARN lines (up to 20)
  // Priority 3: Tail lines for recent context (up to 20)
  const chosenMap = new Map<number, LogEntry>();

  const errorEntries = pool.filter((e) => e.level === 'ERROR' || isAlertEntry(e));
  for (const e of errorEntries.slice(-35)) {
    chosenMap.set(e.lineNumber, e);
  }

  const warnEntries = pool.filter((e) => e.level === 'WARN' && !chosenMap.has(e.lineNumber));
  for (const e of warnEntries.slice(-20)) {
    chosenMap.set(e.lineNumber, e);
  }

  for (const e of pool.slice(-20)) {
    if (!chosenMap.has(e.lineNumber)) {
      chosenMap.set(e.lineNumber, e);
    }
  }

  const orderedChosen = Array.from(chosenMap.values()).sort((a, b) => a.lineNumber - b.lineNumber);

  const excerpts: SanitizedLogExcerpt[] = [];
  let charBudget = 14000;

  for (const entry of orderedChosen) {
    if (charBudget <= 0) break;
    const msgSource = entry.jsonPayload
      ? `${entry.message} ${JSON.stringify(entry.jsonPayload).slice(0, 320)}`
      : entry.message || entry.raw;
    const safeMsg = redactStr(msgSource.slice(0, 500));
    let stackPreview: string | undefined;
    if (entry.stackLines && entry.stackLines.length > 0) {
      const joinedStack = entry.stackLines.slice(0, 12).join('\n');
      stackPreview = redactStr(joinedStack.slice(0, 900));
    }

    charBudget -= safeMsg.length + (stackPreview?.length ?? 0) + 60;
    excerpts.push({
      lineNumber: entry.lineNumber,
      timeDisplay: entry.timeDisplay,
      level: entry.level,
      pod: entry.pod,
      container: entry.container,
      message: safeMsg,
      ...(stackPreview ? { stackPreview } : {}),
    });
  }

  return {
    target: {
      clusterName: cluster.name,
      mode: cluster.mode,
      namespace: isMultiPodMode ? 'multi-namespace' : selectedTarget?.namespace || 'default',
      pod: isMultiPodMode ? `multi-pod (${multiPodCount})` : selectedTarget?.pod || 'unknown',
      container: isMultiPodMode ? 'multiple' : selectedTarget?.container || '',
      previous: !isMultiPodMode ? Boolean(selectedTarget?.previous) : false,
      isMultiPod: isMultiPodMode,
      multiPodCount: isMultiPodMode ? multiPodCount : undefined,
    },
    stats: {
      totalLines: rawEntries.length,
      visibleLines: visibleEntries.length,
      errorCount: levelCounts.ERROR,
      warnCount: levelCounts.WARN,
      infoCount: levelCounts.INFO,
      debugCount: levelCounts.DEBUG,
      alertHitCount,
    },
    topPatterns,
    excerpts,
    redaction,
  };
}

export function buildSanitizedEntryExplainPayload(params: {
  cluster: ClusterConfig;
  selectedTarget: SelectedTarget | null;
  isMultiPodMode: boolean;
  multiPodCount: number;
  entry: LogEntry;
  allEntries: LogEntry[];
}): AiEntryExplainPayload {
  const { cluster, selectedTarget, isMultiPodMode, multiPodCount, entry, allEntries } = params;
  const redaction = emptyRedactionCounts();
  const redactStr = (s: string) => {
    const r = redactSensitiveText(s);
    mergeRedactionCounts(redaction, r.counts);
    return r.text;
  };

  const idx = allEntries.findIndex((e) => e.id === entry.id);
  const start = idx >= 0 ? Math.max(0, idx - 3) : 0;
  const end = idx >= 0 ? Math.min(allEntries.length - 1, idx + 3) : -1;
  const surroundingLines: AiEntryExplainPayload['surroundingLines'] = [];

  for (let i = start; i <= end; i++) {
    const item = allEntries[i];
    if (!item || item.id === entry.id) continue;
    surroundingLines.push({
      lineNumber: item.lineNumber,
      level: item.level,
      timeDisplay: item.timeDisplay,
      message: redactStr((item.message || item.raw).slice(0, 320)),
    });
  }

  return {
    target: {
      clusterName: cluster.name,
      mode: cluster.mode,
      namespace: entry.namespace || selectedTarget?.namespace || 'default',
      pod: entry.pod || selectedTarget?.pod || 'unknown',
      container: entry.container || selectedTarget?.container || '',
      previous: !isMultiPodMode ? Boolean(selectedTarget?.previous) : false,
      isMultiPod: isMultiPodMode,
      multiPodCount: isMultiPodMode ? multiPodCount : undefined,
    },
    entry: {
      lineNumber: entry.lineNumber,
      timestampIso: entry.timestampIso,
      level: entry.level,
      namespace: entry.namespace,
      pod: entry.pod,
      container: entry.container,
      message: redactStr(entry.message.slice(0, 1200)),
      raw: redactStr(entry.raw.slice(0, 2000)),
      jsonFields: entry.jsonPayload
        ? redactStr(JSON.stringify(entry.jsonPayload, null, 2).slice(0, 2000))
        : undefined,
      stackTrace: entry.stackLines?.length
        ? redactStr(entry.stackLines.slice(0, 40).join('\n').slice(0, 3500))
        : undefined,
    },
    surroundingLines,
    redaction,
  };
}

export function formatContextPreview(ctx: SanitizedLogContext): string {
  const lines: string[] = [
    `目标: ${ctx.target.clusterName} / ${ctx.target.namespace} / ${ctx.target.pod}${ctx.target.container ? `:${ctx.target.container}` : ''}`,
    `统计: 共 ${ctx.stats.totalLines} 行 (ERROR=${ctx.stats.errorCount}, WARN=${ctx.stats.warnCount}, 高危命中=${ctx.stats.alertHitCount})`,
    `脱敏: 共替换 ${ctx.redaction.total} 处 (Token=${ctx.redaction.tokens}, 密钥=${ctx.redaction.secrets}, IP=${ctx.redaction.ips}, 私钥=${ctx.redaction.privateKeys}, 邮箱=${ctx.redaction.emails})`,
    '',
    `--- 高频模式摘要 (${ctx.topPatterns.length}) ---`,
    ...ctx.topPatterns.map((p) => `[${p.level}] ${p.count}次 (${p.sharePct}%): ${p.template}`),
    '',
    `--- 精选日志片段 (${ctx.excerpts.length} 行) ---`,
    ...ctx.excerpts.map(
      (e) =>
        `#${e.lineNumber} [${e.timeDisplay}] [${e.level}] ${e.message}${e.stackPreview ? `\n  ${e.stackPreview.replace(/\n/g, '\n  ')}` : ''}`
    ),
  ];
  return lines.join('\n');
}
