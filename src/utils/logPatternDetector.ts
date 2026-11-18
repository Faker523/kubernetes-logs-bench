import type { LogEntry, LogLevel } from '../types/k8s';

export interface PatternToken {
  text: string;
  isPlaceholder: boolean;
}

export interface LogPattern {
  id: string;
  template: string;
  tokens: PatternToken[];
  level: LogLevel;
  count: number;
  sharePct: number;
  entryIds: Set<string>;
  sampleEntry: LogEntry;
  regexString: string;
  pods: string[];
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface PatternAggregationResult {
  patterns: LogPattern[];
  totalEntries: number;
  compressionPct: number;
}

interface MaskRule {
  token: string;
  regex: RegExp;
  equivalentPattern: string;
}

const MASK_RULES: MaskRule[] = [
  {
    token: '<TIME>',
    regex: /\b\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    equivalentPattern: '\\d{4}[-/]\\d{2}[-/]\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?',
  },
  {
    token: '<UUID>',
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    equivalentPattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
  },
  {
    token: '<ADDR>',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
    equivalentPattern: '(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?',
  },
  {
    token: '<ID>',
    regex: /\b(?:tr|ORD|STG|SKU|usr|evt|req|job|task)[-_][A-Za-z0-9_-]{3,}\b/g,
    equivalentPattern: '(?:tr|ORD|STG|SKU|usr|evt|req|job|task)[-_][A-Za-z0-9_-]{3,}',
  },
  {
    token: '<HEX>',
    regex: /\b0x[0-9a-fA-F]+\b|\b[0-9a-f]{16,64}\b/g,
    equivalentPattern: '(?:0x[0-9a-fA-F]+|[0-9a-f]{16,64})',
  },
  {
    token: '<DUR>',
    regex: /\b\d+(?:\.\d+)?(?:ms|us|µs|ns|sec|Gi|Mi|Ki|GB|MB|KB|s|m|h)\b/g,
    equivalentPattern: '\\d+(?:\\.\\d+)?(?:ms|us|µs|ns|sec|Gi|Mi|Ki|GB|MB|KB|s|m|h)',
  },
  {
    token: '<NUM>',
    regex: /\b\d+(?:\.\d+)?\b/g,
    equivalentPattern: '\\d+(?:\\.\\d+)?',
  },
];

const TOKEN_EQUIVALENT_MAP = new Map<string, string>(
  MASK_RULES.map((r) => [r.token, r.equivalentPattern])
);

const PLACEHOLDER_SPLIT_RE = /(<(?:TIME|UUID|ADDR|ID|HEX|DUR|NUM)>)/g;

export function normalizeMessageToTemplate(message: string): string {
  let template = message.trim().replace(/\s+/g, ' ');
  for (const rule of MASK_RULES) {
    template = template.replace(rule.regex, rule.token);
  }
  return template;
}

export function tokenizeTemplate(template: string): PatternToken[] {
  return template
    .split(PLACEHOLDER_SPLIT_RE)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      isPlaceholder: TOKEN_EQUIVALENT_MAP.has(part),
    }));
}

function escapeRegexLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildEquivalentRegex(template: string): string {
  const tokens = tokenizeTemplate(template);
  return tokens
    .map((t) =>
      t.isPlaceholder
        ? TOKEN_EQUIVALENT_MAP.get(t.text) ?? '.*?'
        : escapeRegexLiteral(t.text).replace(/\\ /g, '\\s+')
    )
    .join('');
}

export function aggregateLogPatterns(entries: LogEntry[]): PatternAggregationResult {
  if (entries.length === 0) {
    return { patterns: [], totalEntries: 0, compressionPct: 0 };
  }

  const groups = new Map<
    string,
    {
      template: string;
      level: LogLevel;
      entries: LogEntry[];
      pods: Set<string>;
      firstSeenMs: number;
      lastSeenMs: number;
    }
  >();

  for (const entry of entries) {
    const template = normalizeMessageToTemplate(entry.message || entry.raw);
    const key = `${entry.level}::${template}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.pods.add(entry.pod);
      if (entry.timestampMs < existing.firstSeenMs) existing.firstSeenMs = entry.timestampMs;
      if (entry.timestampMs > existing.lastSeenMs) existing.lastSeenMs = entry.timestampMs;
    } else {
      groups.set(key, {
        template,
        level: entry.level,
        entries: [entry],
        pods: new Set([entry.pod]),
        firstSeenMs: entry.timestampMs,
        lastSeenMs: entry.timestampMs,
      });
    }
  }

  const total = entries.length;
  const patterns: LogPattern[] = Array.from(groups.entries()).map(([key, grp]) => ({
    id: key,
    template: grp.template,
    tokens: tokenizeTemplate(grp.template),
    level: grp.level,
    count: grp.entries.length,
    sharePct: (grp.entries.length / total) * 100,
    entryIds: new Set(grp.entries.map((e) => e.id)),
    sampleEntry: grp.entries[0],
    regexString: buildEquivalentRegex(grp.template),
    pods: Array.from(grp.pods),
    firstSeenMs: grp.firstSeenMs,
    lastSeenMs: grp.lastSeenMs,
  }));

  patterns.sort((a, b) => b.count - a.count);

  const compressionPct = total > 0 ? ((total - patterns.length) / total) * 100 : 0;

  return {
    patterns,
    totalEntries: total,
    compressionPct: Math.max(0, compressionPct),
  };
}
