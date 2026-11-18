import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClusterConnectModal } from './components/ClusterConnectModal';
import { LogDetailDrawer } from './components/LogDetailDrawer';
import { LogHistogram } from './components/LogHistogram';
import { LogPatternPanel } from './components/LogPatternPanel';
import { LogToolbar } from './components/LogToolbar';
import { LogViewport } from './components/LogViewport';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import {
  SANDBOX_NAMESPACES,
  SANDBOX_PODS,
  generateSandboxLiveLog,
  getSandboxLogs,
} from './data/sandboxCluster';
import type {
  ClusterConfig,
  FilterState,
  LogEntry,
  LogLevel,
  PodInfo,
  SelectedTarget,
} from './types/k8s';
import { fetchNamespaces, fetchPodLogs, fetchPods } from './utils/k8sClient';
import { exportLogsToFile, parseRawLogs } from './utils/logParser';
import { aggregateLogPatterns } from './utils/logPatternDetector';
import {
  loadActiveCluster,
  loadDisplayPrefs,
  loadPersistedSidebarOpen,
  loadPersistedTheme,
  loadSavedClusters,
  loadSelectedNamespace,
  loadSelectedTarget,
  saveActiveCluster,
  saveDisplayPrefs,
  savePersistedSidebarOpen,
  savePersistedTheme,
  saveSavedClusters,
  saveSelectedNamespace,
  saveSelectedTarget,
} from './utils/storage';

const DEFAULT_SANDBOX_CLUSTER: ClusterConfig = {
  id: 'sandbox-prod',
  name: 'prod-us-east-1',
  mode: 'sandbox',
};

const INITIAL_FILTERS: FilterState = {
  search: '',
  exclude: '',
  isRegex: false,
  caseSensitive: false,
  levels: [],
  tailLines: 500,
  showTimestamp: true,
  showLineNumbers: true,
  wrapLines: false,
  contextLines: false,
  jsonPreview: true,
  fieldFilter: null,
  timeBucketRange: null,
};

function matchesTextQuery(
  text: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean
): boolean {
  if (!query.trim()) return true;
  if (isRegex) {
    try {
      const re = new RegExp(query, caseSensitive ? '' : 'i');
      return re.test(text);
    } catch {
      return false;
    }
  }
  if (caseSensitive) return text.includes(query);
  return text.toLowerCase().includes(query.toLowerCase());
}

export default function App() {
  const initialClusterRef = useRef<ClusterConfig | null>(null);
  if (initialClusterRef.current === null) {
    initialClusterRef.current = loadActiveCluster() || DEFAULT_SANDBOX_CLUSTER;
  }
  const initialCluster = initialClusterRef.current;

  const initialNamespaceRef = useRef<string | null>(null);
  if (initialNamespaceRef.current === null) {
    const savedNs = loadSelectedNamespace();
    initialNamespaceRef.current =
      initialCluster.mode === 'k8s-api'
        ? savedNs || '__all__'
        : savedNs && SANDBOX_NAMESPACES.includes(savedNs)
          ? savedNs
          : 'prod-ecommerce';
  }

  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadPersistedTheme());
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => loadPersistedSidebarOpen());
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const [savedClusters, setSavedClusters] = useState<ClusterConfig[]>(() => loadSavedClusters());
  const [cluster, setCluster] = useState<ClusterConfig>(initialCluster);
  const [namespaces, setNamespaces] = useState<string[]>(() =>
    initialCluster.mode === 'sandbox' ? SANDBOX_NAMESPACES : []
  );
  const [selectedNamespace, setSelectedNamespace] = useState<string>(initialNamespaceRef.current);
  const [pods, setPods] = useState<PodInfo[]>(() =>
    initialCluster.mode === 'sandbox' ? SANDBOX_PODS : []
  );
  const [isLoadingPods, setIsLoadingPods] = useState(false);

  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(() => {
    const saved = loadSelectedTarget();
    if (initialCluster.mode === 'k8s-api') {
      return saved;
    }
    if (
      saved &&
      SANDBOX_PODS.some((p) => p.namespace === saved.namespace && p.name === saved.pod)
    ) {
      return saved;
    }
    return {
      namespace: 'prod-ecommerce',
      pod: 'order-api-7f9d8c4b2-x9k2p',
      container: 'app',
      previous: false,
    };
  });

  const [isMultiPodMode, setIsMultiPodMode] = useState(false);
  const [multiPodSelection, setMultiPodSelection] = useState<
    Array<{ namespace: string; pod: string; container: string }>
  >(() =>
    initialCluster.mode === 'sandbox'
      ? [
          { namespace: 'prod-ecommerce', pod: 'order-api-7f9d8c4b2-x9k2p', container: 'app' },
          { namespace: 'prod-ecommerce', pod: 'payment-worker-5c6b89d74-m4n1q', container: 'worker' },
        ]
      : []
  );

  const [rawEntries, setRawEntries] = useState<LogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [isLiveTail, setIsLiveTail] = useState(false);

  const [filters, setFilters] = useState<FilterState>(() => ({
    ...INITIAL_FILTERS,
    ...loadDisplayPrefs(),
  }));
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [patternPanelOpen, setPatternPanelOpen] = useState(false);
  const [excludedPatternIds, setExcludedPatternIds] = useState<string[]>([]);
  const [focusedPatternId, setFocusedPatternId] = useState<string | null>(null);

  const importedEntriesRef = useRef<LogEntry[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync theme class on <html> and persist
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    savePersistedTheme(theme);
  }, [theme]);

  useEffect(() => {
    savePersistedSidebarOpen(sidebarOpen);
  }, [sidebarOpen]);

  useEffect(() => {
    saveSavedClusters(savedClusters);
  }, [savedClusters]);

  useEffect(() => {
    saveSelectedNamespace(selectedNamespace);
  }, [selectedNamespace]);

  useEffect(() => {
    if (cluster.mode !== 'imported-file') {
      saveSelectedTarget(selectedTarget);
    }
  }, [selectedTarget, cluster.mode]);

  useEffect(() => {
    saveDisplayPrefs({
      tailLines: filters.tailLines,
      showTimestamp: filters.showTimestamp,
      showLineNumbers: filters.showLineNumbers,
      wrapLines: filters.wrapLines,
      contextLines: filters.contextLines,
      jsonPreview: filters.jsonPreview,
    });
  }, [
    filters.tailLines,
    filters.showTimestamp,
    filters.showLineNumbers,
    filters.wrapLines,
    filters.contextLines,
    filters.jsonPreview,
  ]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (!isInput && e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (connectModalOpen) setConnectModalOpen(false);
        else if (selectedEntryId) setSelectedEntryId(null);
        else if (patternPanelOpen) setPatternPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectModalOpen, selectedEntryId, patternPanelOpen]);

  const loadPodsForCluster = useCallback(
    async (activeCluster: ClusterConfig, ns: string) => {
      if (activeCluster.mode === 'sandbox') {
        setNamespaces(SANDBOX_NAMESPACES);
        setPods(SANDBOX_PODS);
        return;
      }
      if (activeCluster.mode === 'imported-file') {
        return;
      }

      setIsLoadingPods(true);
      try {
        const [nsList, podList] = await Promise.all([
          fetchNamespaces(activeCluster),
          fetchPods(activeCluster, ns),
        ]);
        setNamespaces(nsList);
        setPods(podList);
        if (podList.length > 0) {
          const first = podList[0];
          const firstContainer = first.containers[0]?.name || '';
          setSelectedTarget((prev) => {
            if (prev && podList.some((p) => p.name === prev.pod && p.namespace === prev.namespace)) {
              return prev;
            }
            return {
              namespace: first.namespace,
              pod: first.name,
              container: firstContainer,
              previous: false,
            };
          });
        }
      } catch (err) {
        setLogError(err instanceof Error ? err.message : '无法获取集群 Pod 列表');
      } finally {
        setIsLoadingPods(false);
      }
    },
    []
  );

  // Automatically restore pods when reloading a persisted K8s API cluster
  useEffect(() => {
    if (initialCluster.mode === 'k8s-api') {
      loadPodsForCluster(initialCluster, initialNamespaceRef.current || '__all__');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLogs = useCallback(async () => {
    setLogError(null);

    if (cluster.mode === 'imported-file') {
      setRawEntries(importedEntriesRef.current);
      return;
    }

    if (cluster.mode === 'sandbox') {
      if (isMultiPodMode) {
        const merged: LogEntry[] = [];
        for (const item of multiPodSelection) {
          merged.push(...getSandboxLogs(item.namespace, item.pod, item.container, false));
        }
        merged.sort((a, b) => a.timestampMs - b.timestampMs);
        setRawEntries(
          merged.map((entry, idx) => ({
            ...entry,
            lineNumber: idx + 1,
          }))
        );
      } else if (selectedTarget) {
        const logs = getSandboxLogs(
          selectedTarget.namespace,
          selectedTarget.pod,
          selectedTarget.container,
          selectedTarget.previous
        );
        const sliced =
          filters.tailLines > 0 ? logs.slice(-filters.tailLines) : logs;
        setRawEntries(sliced);
      } else {
        setRawEntries([]);
      }
      return;
    }

    // Real Kubernetes API mode
    setIsLoadingLogs(true);
    try {
      const tail = filters.tailLines > 0 ? filters.tailLines : 5000;
      if (isMultiPodMode) {
        const allResults = await Promise.all(
          multiPodSelection.map(async (item) => {
            const raw = await fetchPodLogs(cluster, {
              namespace: item.namespace,
              pod: item.pod,
              container: item.container,
              tailLines: tail,
              previous: false,
            });
            return parseRawLogs(
              raw,
              { namespace: item.namespace, pod: item.pod, container: item.container },
              `${item.pod}-${item.container}`
            );
          })
        );
        const merged = allResults.flat().sort((a, b) => a.timestampMs - b.timestampMs);
        setRawEntries(merged.map((e, i) => ({ ...e, lineNumber: i + 1 })));
      } else if (selectedTarget) {
        const raw = await fetchPodLogs(cluster, {
          namespace: selectedTarget.namespace,
          pod: selectedTarget.pod,
          container: selectedTarget.container,
          tailLines: tail,
          previous: selectedTarget.previous,
        });
        const parsed = parseRawLogs(
          raw,
          {
            namespace: selectedTarget.namespace,
            pod: selectedTarget.pod,
            container: selectedTarget.container,
          },
          `${selectedTarget.pod}-${selectedTarget.container}`
        );
        setRawEntries(parsed);
      } else {
        setRawEntries([]);
      }
    } catch (err) {
      setLogError(err instanceof Error ? err.message : '拉取 Pod 日志失败');
      setRawEntries([]);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [cluster, isMultiPodMode, multiPodSelection, selectedTarget, filters.tailLines]);

  useEffect(() => {
    loadLogs();
    setSelectedEntryId(null);
    setExcludedPatternIds([]);
    setFocusedPatternId(null);
  }, [loadLogs]);

  // Live Tail polling / simulation
  useEffect(() => {
    if (!isLiveTail) return;

    if (cluster.mode === 'sandbox') {
      const timer = setInterval(() => {
        setRawEntries((prev) => {
          const nextNum = (prev[prev.length - 1]?.lineNumber ?? 0) + 1;
          let nextEntry: LogEntry | null = null;
          if (isMultiPodMode && multiPodSelection.length > 0) {
            const pick = multiPodSelection[Math.floor(Math.random() * multiPodSelection.length)];
            nextEntry = generateSandboxLiveLog(pick.namespace, pick.pod, pick.container, nextNum);
          } else if (selectedTarget && !selectedTarget.previous) {
            nextEntry = generateSandboxLiveLog(
              selectedTarget.namespace,
              selectedTarget.pod,
              selectedTarget.container,
              nextNum
            );
          }
          if (!nextEntry) return prev;
          const updated = [...prev, nextEntry];
          return updated.length > 3000 ? updated.slice(-3000) : updated;
        });
      }, 1400);
      return () => clearInterval(timer);
    }

    if (cluster.mode === 'k8s-api' && selectedTarget && !selectedTarget.previous) {
      const timer = setInterval(async () => {
        try {
          const raw = await fetchPodLogs(cluster, {
            namespace: selectedTarget.namespace,
            pod: selectedTarget.pod,
            container: selectedTarget.container,
            tailLines: filters.tailLines > 0 ? filters.tailLines : 500,
            previous: false,
          });
          const parsed = parseRawLogs(
            raw,
            {
              namespace: selectedTarget.namespace,
              pod: selectedTarget.pod,
              container: selectedTarget.container,
            },
            `${selectedTarget.pod}-${selectedTarget.container}`
          );
          setRawEntries(parsed);
        } catch {
          // Keep current view during transient live poll hiccups
        }
      }, 2500);
      return () => clearInterval(timer);
    }
  }, [isLiveTail, cluster, isMultiPodMode, multiPodSelection, selectedTarget, filters.tailLines]);

  // Compute level counts from rawEntries
  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel | 'ALL', number> = {
      ALL: rawEntries.length,
      ERROR: 0,
      WARN: 0,
      INFO: 0,
      DEBUG: 0,
      UNKNOWN: 0,
    };
    for (const e of rawEntries) {
      counts[e.level] += 1;
    }
    return counts;
  }, [rawEntries]);

  // Aggregate log patterns using regex masking
  const patternAggregation = useMemo(
    () => aggregateLogPatterns(rawEntries),
    [rawEntries]
  );

  const patternEntryFilters = useMemo(() => {
    const focusedEntryIds = focusedPatternId
      ? patternAggregation.patterns.find((p) => p.id === focusedPatternId)?.entryIds ?? null
      : null;

    let excludedEntryIds: Set<string> | null = null;
    if (excludedPatternIds.length > 0) {
      excludedEntryIds = new Set<string>();
      const excludedSet = new Set(excludedPatternIds);
      for (const p of patternAggregation.patterns) {
        if (excludedSet.has(p.id)) {
          for (const id of p.entryIds) excludedEntryIds.add(id);
        }
      }
    }

    return { focusedEntryIds, excludedEntryIds };
  }, [patternAggregation.patterns, focusedPatternId, excludedPatternIds]);

  // Apply filtering + optional ±3 lines context expansion
  const { visibleEntries, contextMatchIds } = useMemo(() => {
    const hasFilter =
      filters.search.trim() !== '' ||
      filters.exclude.trim() !== '' ||
      filters.levels.length > 0 ||
      filters.fieldFilter !== null ||
      filters.timeBucketRange !== null ||
      patternEntryFilters.focusedEntryIds !== null ||
      patternEntryFilters.excludedEntryIds !== null;

    if (!hasFilter) {
      return { visibleEntries: rawEntries, contextMatchIds: undefined };
    }

    const matchIndexes = new Set<number>();
    const directMatchIds = new Set<string>();

    rawEntries.forEach((entry, idx) => {
      if (patternEntryFilters.focusedEntryIds && !patternEntryFilters.focusedEntryIds.has(entry.id)) {
        return;
      }

      if (patternEntryFilters.excludedEntryIds && patternEntryFilters.excludedEntryIds.has(entry.id)) {
        return;
      }

      if (filters.levels.length > 0 && !filters.levels.includes(entry.level)) {
        return;
      }

      if (filters.timeBucketRange) {
        if (
          entry.timestampMs < filters.timeBucketRange.startMs ||
          entry.timestampMs > filters.timeBucketRange.endMs
        ) {
          return;
        }
      }

      if (filters.fieldFilter) {
        const { key, value, negate } = filters.fieldFilter;
        const fieldRaw = entry.jsonPayload?.[key] ?? (key === 'trace_id' ? entry.traceId : undefined);
        const fieldStr = fieldRaw !== undefined && fieldRaw !== null ? String(fieldRaw) : '';
        const equals = fieldStr === value;
        if (negate ? equals : !equals) {
          return;
        }
      }

      const searchable = entry.stackLines?.length
        ? `${entry.raw}\n${entry.stackLines.join('\n')}`
        : entry.raw;

      if (
        filters.exclude.trim() &&
        matchesTextQuery(searchable, filters.exclude, false, filters.caseSensitive)
      ) {
        return;
      }

      if (
        filters.search.trim() &&
        !matchesTextQuery(searchable, filters.search, filters.isRegex, filters.caseSensitive)
      ) {
        return;
      }

      matchIndexes.add(idx);
      directMatchIds.add(entry.id);
    });

    if (!filters.contextLines) {
      return {
        visibleEntries: rawEntries.filter((_, idx) => matchIndexes.has(idx)),
        contextMatchIds: undefined,
      };
    }

    const expandedIndexes = new Set<number>();
    for (const idx of matchIndexes) {
      for (let offset = -3; offset <= 3; offset++) {
        const target = idx + offset;
        if (target >= 0 && target < rawEntries.length) {
          expandedIndexes.add(target);
        }
      }
    }

    return {
      visibleEntries: rawEntries.filter((_, idx) => expandedIndexes.has(idx)),
      contextMatchIds: directMatchIds,
    };
  }, [rawEntries, filters, patternEntryFilters]);

  const selectedEntry = useMemo(
    () => visibleEntries.find((e) => e.id === selectedEntryId) || null,
    [visibleEntries, selectedEntryId]
  );

  const selectedEntryIndex = useMemo(
    () => (selectedEntryId ? visibleEntries.findIndex((e) => e.id === selectedEntryId) : -1),
    [visibleEntries, selectedEntryId]
  );

  const handleSelectNamespace = (ns: string) => {
    setSelectedNamespace(ns);
    if (cluster.mode === 'k8s-api') {
      loadPodsForCluster(cluster, ns);
    }
  };

  const handleConnectK8sCluster = (nextCluster: ClusterConfig, remember = true) => {
    setIsLiveTail(false);
    setIsMultiPodMode(false);
    setMultiPodSelection([]);
    setSelectedTarget(null);
    setSelectedEntryId(null);
    setNamespaces([]);
    setPods([]);
    setRawEntries([]);
    setLogError(null);
    setCluster(nextCluster);
    setSelectedNamespace('__all__');

    if (remember) {
      saveActiveCluster(nextCluster);
      setSavedClusters((prev) => {
        const filtered = prev.filter((c) => c.apiServer !== nextCluster.apiServer);
        return [nextCluster, ...filtered].slice(0, 10);
      });
    } else {
      saveActiveCluster(null);
    }

    loadPodsForCluster(nextCluster, '__all__');
  };

  const handleDeleteSavedCluster = (clusterId: string) => {
    setSavedClusters((prev) => prev.filter((c) => c.id !== clusterId));
    if (cluster.id === clusterId) {
      saveActiveCluster(null);
    }
  };

  const handleImportLogs = (payload: {
    name: string;
    rawText: string;
    podName: string;
    namespace: string;
    container: string;
  }) => {
    setIsLiveTail(false);
    setIsMultiPodMode(false);
    const parsed = parseRawLogs(
      payload.rawText,
      {
        namespace: payload.namespace,
        pod: payload.podName,
        container: payload.container,
      },
      'imported'
    );
    importedEntriesRef.current = parsed;
    setCluster({
      id: `file-${Date.now()}`,
      name: payload.name,
      mode: 'imported-file',
    });
    setNamespaces([payload.namespace]);
    setSelectedNamespace(payload.namespace);
    setPods([
      {
        name: payload.podName,
        namespace: payload.namespace,
        nodeName: 'local-file',
        podIP: '-',
        phase: 'Running',
        restarts: 0,
        createdAt: new Date().toISOString(),
        labels: {},
        containers: [
          {
            name: payload.container,
            image: 'imported-log',
            ready: true,
            restarts: 0,
            state: 'Loaded',
          },
        ],
      },
    ]);
    setSelectedTarget({
      namespace: payload.namespace,
      pod: payload.podName,
      container: payload.container,
      previous: false,
    });
    setRawEntries(parsed);
  };

  const handleSwitchToSandbox = () => {
    setIsLiveTail(false);
    setIsMultiPodMode(false);
    saveActiveCluster(DEFAULT_SANDBOX_CLUSTER);
    setCluster(DEFAULT_SANDBOX_CLUSTER);
    setNamespaces(SANDBOX_NAMESPACES);
    setSelectedNamespace('prod-ecommerce');
    setPods(SANDBOX_PODS);
    setSelectedTarget({
      namespace: 'prod-ecommerce',
      pod: 'order-api-7f9d8c4b2-x9k2p',
      container: 'app',
      previous: false,
    });
  };

  const handleToggleMultiPodItem = (item: { namespace: string; pod: string; container: string }) => {
    setMultiPodSelection((prev) => {
      const exists = prev.some(
        (i) => i.namespace === item.namespace && i.pod === item.pod && i.container === item.container
      );
      if (exists) {
        return prev.filter(
          (i) => !(i.namespace === item.namespace && i.pod === item.pod && i.container === item.container)
        );
      }
      return [...prev, item];
    });
  };

  const handleExportLogs = (format: 'log' | 'json') => {
    const prefix = isMultiPodMode
      ? `kubelog-multi-${multiPodSelection.length}pods`
      : selectedTarget
        ? `${selectedTarget.namespace}-${selectedTarget.pod}-${selectedTarget.container}`
        : 'kubelog';
    exportLogsToFile(visibleEntries, format, prefix);
  };

  const canLiveTail =
    cluster.mode !== 'imported-file' &&
    (!selectedTarget?.previous || isMultiPodMode) &&
    (isMultiPodMode ? multiPodSelection.length > 0 : Boolean(selectedTarget));

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <TopBar
        cluster={cluster}
        selectedTarget={selectedTarget}
        multiPodCount={multiPodSelection.length}
        isMultiPodMode={isMultiPodMode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onOpenConnectModal={() => setConnectModalOpen(true)}
        onExportLogs={handleExportLogs}
        canExport={visibleEntries.length > 0}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            cluster={cluster}
            namespaces={namespaces}
            selectedNamespace={selectedNamespace}
            onSelectNamespace={handleSelectNamespace}
            pods={pods}
            isLoadingPods={isLoadingPods}
            onRefreshPods={() => loadPodsForCluster(cluster, selectedNamespace)}
            selectedTarget={selectedTarget}
            onSelectContainer={(target) => {
              setIsLiveTail(false);
              setSelectedTarget(target);
            }}
            isMultiPodMode={isMultiPodMode}
            onToggleMultiPodMode={() => {
              setIsLiveTail(false);
              setIsMultiPodMode((m) => !m);
            }}
            multiPodSelection={multiPodSelection}
            onToggleMultiPodItem={handleToggleMultiPodItem}
            onOpenConnectModal={() => setConnectModalOpen(true)}
          />
        )}

        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <LogToolbar
            filters={filters}
            onChangeFilters={(next) => setFilters((prev) => ({ ...prev, ...next }))}
            levelCounts={levelCounts}
            isLiveTail={isLiveTail}
            onToggleLiveTail={() => setIsLiveTail((v) => !v)}
            onRefreshLogs={loadLogs}
            isLoadingLogs={isLoadingLogs}
            canLiveTail={canLiveTail}
            searchInputRef={searchInputRef}
            patternPanelOpen={patternPanelOpen}
            patternCount={patternAggregation.patterns.length}
            excludedPatternCount={excludedPatternIds.length}
            focusedPatternActive={focusedPatternId !== null}
            onTogglePatternPanel={() => {
              setPatternPanelOpen((open) => {
                const next = !open;
                if (next) setSelectedEntryId(null);
                return next;
              });
            }}
            onClearPatternFilters={() => {
              setExcludedPatternIds([]);
              setFocusedPatternId(null);
            }}
          />

          <LogHistogram
            entries={rawEntries}
            activeRange={filters.timeBucketRange}
            activeLevels={filters.levels}
            onSelectRange={(range) =>
              setFilters((prev) => ({ ...prev, timeBucketRange: range }))
            }
            onToggleLevelFilter={(level) =>
              setFilters((prev) => {
                const exists = prev.levels.includes(level);
                return {
                  ...prev,
                  levels: exists
                    ? prev.levels.filter((item) => item !== level)
                    : [...prev.levels, level],
                };
              })
            }
          />

          <LogViewport
            entries={visibleEntries}
            totalCount={rawEntries.length}
            filters={filters}
            isMultiPodMode={isMultiPodMode}
            isLoading={isLoadingLogs}
            error={logError}
            selectedEntryId={selectedEntryId}
            onSelectEntry={(entry) => {
              setPatternPanelOpen(false);
              setSelectedEntryId((curr) => (curr === entry.id ? null : entry.id));
            }}
            isLiveTail={isLiveTail}
            onResetFilters={() => {
              setExcludedPatternIds([]);
              setFocusedPatternId(null);
              setFilters((prev) => ({
                ...INITIAL_FILTERS,
                showTimestamp: prev.showTimestamp,
                showLineNumbers: prev.showLineNumbers,
                wrapLines: prev.wrapLines,
                jsonPreview: prev.jsonPreview,
              }));
            }}
            onRetry={loadLogs}
            contextMatchIds={contextMatchIds}
          />
        </main>

        {patternPanelOpen ? (
          <LogPatternPanel
            patterns={patternAggregation.patterns}
            totalEntries={patternAggregation.totalEntries}
            compressionPct={patternAggregation.compressionPct}
            excludedPatternIds={excludedPatternIds}
            focusedPatternId={focusedPatternId}
            onToggleExcludePattern={(id) => {
              setFocusedPatternId(null);
              setExcludedPatternIds((prev) =>
                prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
              );
            }}
            onToggleFocusPattern={(id) => {
              setFocusedPatternId((curr) => (curr === id ? null : id));
            }}
            onClearPatternFilters={() => {
              setExcludedPatternIds([]);
              setFocusedPatternId(null);
            }}
            onApplyRegexToSearch={(regex) => {
              setFilters((prev) => ({
                ...prev,
                search: regex,
                isRegex: true,
              }));
            }}
            onClose={() => setPatternPanelOpen(false)}
          />
        ) : (
          <LogDetailDrawer
            entry={selectedEntry}
            onClose={() => setSelectedEntryId(null)}
            canPrev={selectedEntryIndex > 0}
            canNext={selectedEntryIndex >= 0 && selectedEntryIndex < visibleEntries.length - 1}
            onNavigate={(dir) => {
              if (selectedEntryIndex < 0) return;
              const nextIdx = dir === 'prev' ? selectedEntryIndex - 1 : selectedEntryIndex + 1;
              const target = visibleEntries[nextIdx];
              if (target) setSelectedEntryId(target.id);
            }}
            onApplyFieldFilter={(key, value, negate) =>
              setFilters((prev) => ({
                ...prev,
                fieldFilter: { key, value, negate },
              }))
            }
          />
        )}
      </div>

      <ClusterConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        activeCluster={cluster}
        savedClusters={savedClusters}
        onConnectK8sCluster={handleConnectK8sCluster}
        onDeleteSavedCluster={handleDeleteSavedCluster}
        onImportLogs={handleImportLogs}
        onSwitchToSandbox={handleSwitchToSandbox}
      />
    </div>
  );
}
