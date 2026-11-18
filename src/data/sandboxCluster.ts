import type { LogEntry, PodInfo } from '../types/k8s';
import { parseRawLogs } from '../utils/logParser';

export const SANDBOX_NAMESPACES = [
  'prod-ecommerce',
  'staging-payments',
  'observability',
  'kube-system',
];

export const SANDBOX_PODS: PodInfo[] = [
  {
    name: 'order-api-7f9d8c4b2-x9k2p',
    namespace: 'prod-ecommerce',
    nodeName: 'node-pool-a-04',
    podIP: '10.244.2.18',
    phase: 'Running',
    restarts: 1,
    createdAt: '2026-11-16T08:12:40Z',
    labels: { app: 'order-api', version: 'v2.14.3', tier: 'backend' },
    containers: [
      { name: 'app', image: 'registry.internal/ecommerce/order-api:v2.14.3', ready: true, restarts: 1, state: 'Running' },
      { name: 'envoy-sidecar', image: 'envoyproxy/envoy:v1.31.2', ready: true, restarts: 0, state: 'Running' },
      { name: 'init-db-migrate', image: 'registry.internal/ecommerce/migrator:v2.14.3', isInit: true, ready: true, restarts: 0, state: 'Completed' },
    ],
  },
  {
    name: 'payment-worker-5c6b89d74-m4n1q',
    namespace: 'prod-ecommerce',
    nodeName: 'node-pool-a-07',
    podIP: '10.244.3.42',
    phase: 'CrashLoopBackOff',
    restarts: 14,
    createdAt: '2026-11-17T14:22:10Z',
    labels: { app: 'payment-worker', version: 'v1.9.0', tier: 'worker' },
    containers: [
      { name: 'worker', image: 'registry.internal/payments/worker:v1.9.0', ready: false, restarts: 14, state: 'CrashLoopBackOff' },
      { name: 'vault-agent', image: 'hashicorp/vault:1.17.3', ready: true, restarts: 0, state: 'Running' },
    ],
  },
  {
    name: 'inventory-sync-6d4b5f9b7-k8p2w',
    namespace: 'prod-ecommerce',
    nodeName: 'node-pool-a-02',
    podIP: '10.244.1.95',
    phase: 'Running',
    restarts: 0,
    createdAt: '2026-11-15T19:05:00Z',
    labels: { app: 'inventory-sync', version: 'v3.1.1' },
    containers: [
      { name: 'sync', image: 'registry.internal/ecommerce/inventory-sync:v3.1.1', ready: true, restarts: 0, state: 'Running' },
    ],
  },
  {
    name: 'redis-cluster-0',
    namespace: 'prod-ecommerce',
    nodeName: 'node-pool-mem-01',
    podIP: '10.244.4.11',
    phase: 'Running',
    restarts: 0,
    createdAt: '2026-11-10T03:00:00Z',
    labels: { app: 'redis-cluster', role: 'primary' },
    containers: [
      { name: 'redis', image: 'redis:7.4.1-alpine', ready: true, restarts: 0, state: 'Running' },
    ],
  },
  {
    name: 'checkout-gateway-9b7c4d2f-r3v8t',
    namespace: 'staging-payments',
    nodeName: 'node-pool-b-02',
    podIP: '10.244.5.33',
    phase: 'Running',
    restarts: 2,
    createdAt: '2026-11-17T09:45:12Z',
    labels: { app: 'checkout-gateway', env: 'staging' },
    containers: [
      { name: 'gateway', image: 'registry.internal/payments/checkout-gateway:rc-412', ready: true, restarts: 2, state: 'Running' },
    ],
  },
  {
    name: 'prometheus-server-0',
    namespace: 'observability',
    nodeName: 'node-pool-obs-01',
    podIP: '10.244.6.14',
    phase: 'Running',
    restarts: 0,
    createdAt: '2026-11-08T12:00:00Z',
    labels: { app: 'prometheus', component: 'server' },
    containers: [
      { name: 'prometheus', image: 'prom/prometheus:v2.55.0', ready: true, restarts: 0, state: 'Running' },
    ],
  },
  {
    name: 'ingress-nginx-controller-84b7f6d-q9w2z',
    namespace: 'kube-system',
    nodeName: 'node-pool-edge-01',
    podIP: '10.244.0.19',
    phase: 'Running',
    restarts: 0,
    createdAt: '2026-11-01T00:15:00Z',
    labels: { 'app.kubernetes.io/name': 'ingress-nginx' },
    containers: [
      { name: 'controller', image: 'registry.k8s.io/ingress-nginx/controller:v1.11.2', ready: true, restarts: 0, state: 'Running' },
    ],
  },
  {
    name: 'coredns-5d78c9869d-v2x9l',
    namespace: 'kube-system',
    nodeName: 'node-pool-sys-01',
    podIP: '10.244.0.4',
    phase: 'Running',
    restarts: 0,
    createdAt: '2026-10-28T04:10:00Z',
    labels: { 'k8s-app': 'kube-dns' },
    containers: [
      { name: 'coredns', image: 'registry.k8s.io/coredns/coredns:v1.11.3', ready: true, restarts: 0, state: 'Running' },
    ],
  },
];

function buildTimestamp(offsetSeconds: number): string {
  const base = Date.now() - offsetSeconds * 1000;
  return new Date(base).toISOString();
}

function makeRawDataset(): Record<string, string> {
  return {
    'prod-ecommerce/order-api-7f9d8c4b2-x9k2p/app': [
      `${buildTimestamp(310)} {"level":"info","ts":"${buildTimestamp(310)}","caller":"server/main.go:84","msg":"HTTP server listening on :8080","grpc_port":9090,"env":"production"}`,
      `${buildTimestamp(295)} {"level":"info","ts":"${buildTimestamp(295)}","caller":"db/pool.go:42","msg":"PostgreSQL connection pool initialized","max_conns":50,"min_conns":10,"host":"pg-orders-rw.db.svc"}`,
      `${buildTimestamp(270)} {"level":"debug","ts":"${buildTimestamp(270)}","caller":"cache/redis.go:29","msg":"Warming SKU inventory cache","keys_loaded":1420,"duration_ms":38.4}`,
      `${buildTimestamp(240)} {"level":"info","ts":"${buildTimestamp(240)}","caller":"handler/order.go:118","msg":"Order created successfully","trace_id":"tr-88f91a2c44d1","order_id":"ORD-20261117-9041","user_id":"usr_8821","amount_cents":24900,"latency_ms":21.3}`,
      `${buildTimestamp(215)} {"level":"info","ts":"${buildTimestamp(215)}","caller":"handler/order.go:118","msg":"Order created successfully","trace_id":"tr-88f91a2c99b0","order_id":"ORD-20261117-9042","user_id":"usr_1904","amount_cents":8900,"latency_ms":18.7}`,
      `${buildTimestamp(190)} {"level":"warn","ts":"${buildTimestamp(190)}","caller":"client/inventory.go:76","msg":"Upstream inventory-sync latency exceeded SLA threshold","trace_id":"tr-88f91a2d11e2","target":"inventory-sync.prod-ecommerce.svc:8080","latency_ms":842.5,"threshold_ms":500}`,
      `${buildTimestamp(165)} {"level":"info","ts":"${buildTimestamp(165)}","caller":"handler/checkout.go:205","msg":"Payment intent authorized","trace_id":"tr-88f91a2d11e2","order_id":"ORD-20261117-9043","provider":"stripe","latency_ms":134.1}`,
      `${buildTimestamp(140)} {"level":"error","ts":"${buildTimestamp(140)}","caller":"client/payment.go:142","msg":"gRPC call to payment-worker failed: context deadline exceeded","trace_id":"tr-88f91a2f00a9","order_id":"ORD-20261117-9044","grpc_code":"DeadlineExceeded","retry_attempt":2,"latency_ms":3002.4}`,
      `${buildTimestamp(139)} {"level":"error","ts":"${buildTimestamp(139)}","caller":"handler/order.go:164","msg":"Failed to confirm order payment","trace_id":"tr-88f91a2f00a9","order_id":"ORD-20261117-9044","status":502,"error":"payment service timeout after 3000ms"}`,
      `${buildTimestamp(110)} {"level":"warn","ts":"${buildTimestamp(110)}","caller":"middleware/ratelimit.go:53","msg":"Client IP approaching rate limit","client_ip":"198.51.100.42","route":"/api/v1/orders","rpm":288,"limit":300}`,
      `${buildTimestamp(82)} {"level":"info","ts":"${buildTimestamp(82)}","caller":"handler/order.go:92","msg":"Order status queried","trace_id":"tr-88f91a317a04","order_id":"ORD-20261117-9041","status":200,"latency_ms":6.2}`,
      `${buildTimestamp(55)} {"level":"debug","ts":"${buildTimestamp(55)}","caller":"kafka/producer.go:88","msg":"Published domain event order.paid","partition":3,"offset":1948271,"order_id":"ORD-20261117-9043"}`,
      `${buildTimestamp(28)} {"level":"info","ts":"${buildTimestamp(28)}","caller":"handler/order.go:118","msg":"Order created successfully","trace_id":"tr-88f91a34b211","order_id":"ORD-20261117-9045","user_id":"usr_4419","amount_cents":51200,"latency_ms":19.8}`,
      `${buildTimestamp(12)} {"level":"info","ts":"${buildTimestamp(12)}","caller":"health/probe.go:24","msg":"Readiness probe succeeded","db_ping_ms":1.8,"redis_ping_ms":0.6}`,
    ].join('\n'),

    'prod-ecommerce/order-api-7f9d8c4b2-x9k2p/app::previous': [
      `${buildTimestamp(3800)} {"level":"info","msg":"Starting order-api v2.14.2","pod":"order-api-7f9d8c4b2-x9k2p"}`,
      `${buildTimestamp(3790)} {"level":"warn","msg":"High heap allocation detected: 1.78Gi / 2.00Gi limit","goroutines":1420}`,
      `${buildTimestamp(3785)} {"level":"error","msg":"fatal error: runtime: out of memory (OOMKilled by cgroup)","exit_code":137}`,
    ].join('\n'),

    'prod-ecommerce/order-api-7f9d8c4b2-x9k2p/envoy-sidecar': [
      `${buildTimestamp(240)} {"timestamp":"${buildTimestamp(240)}","method":"POST","path":"/api/v1/orders","protocol":"HTTP/1.1","status":201,"latency_ms":24,"upstream_cluster":"inbound|8080||","trace_id":"tr-88f91a2c44d1"}`,
      `${buildTimestamp(190)} {"timestamp":"${buildTimestamp(190)}","method":"GET","path":"/internal/inventory/check","protocol":"HTTP/2","status":200,"latency_ms":845,"upstream_cluster":"outbound|8080||inventory-sync.prod-ecommerce.svc.cluster.local","trace_id":"tr-88f91a2d11e2"}`,
      `${buildTimestamp(140)} {"timestamp":"${buildTimestamp(140)}","method":"POST","path":"/payment.v1.PaymentService/Authorize","protocol":"HTTP/2","status":504,"latency_ms":3003,"upstream_cluster":"outbound|9090||payment-worker.prod-ecommerce.svc.cluster.local","response_flags":"UT","trace_id":"tr-88f91a2f00a9"}`,
      `${buildTimestamp(82)} {"timestamp":"${buildTimestamp(82)}","method":"GET","path":"/api/v1/orders/ORD-20261117-9041","protocol":"HTTP/1.1","status":200,"latency_ms":7,"upstream_cluster":"inbound|8080||","trace_id":"tr-88f91a317a04"}`,
    ].join('\n'),

    'prod-ecommerce/order-api-7f9d8c4b2-x9k2p/init-db-migrate': [
      `${buildTimestamp(7200)} INFO  [migrator] Checking schema_migrations table on pg-orders-rw.db.svc:5432`,
      `${buildTimestamp(7198)} INFO  [migrator] Applying migration 20261116_01_add_order_idempotency_idx.sql`,
      `${buildTimestamp(7195)} INFO  [migrator] Migration 20261116_01 completed in 2.41s (current version: 47)`,
    ].join('\n'),

    'prod-ecommerce/payment-worker-5c6b89d74-m4n1q/worker': [
      `${buildTimestamp(95)} 2026-11-17 18:05:19.104 INFO  [main] Booting payment-worker v1.9.0 (Go 1.23.2)`,
      `${buildTimestamp(94)} 2026-11-17 18:05:19.240 INFO  [vault] Loaded dynamic secret lease for stripe_live_key (ttl=3600s)`,
      `${buildTimestamp(92)} 2026-11-17 18:05:21.411 WARN  [postgres] Failed to acquire connection from pg-payments-rw.db.svc:5432, retrying (1/3)`,
      `${buildTimestamp(90)} 2026-11-17 18:05:23.418 WARN  [postgres] Failed to acquire connection from pg-payments-rw.db.svc:5432, retrying (2/3)`,
      `${buildTimestamp(87)} 2026-11-17 18:05:26.422 ERROR [postgres] Exhausted retries connecting to pg-payments-rw.db.svc:5432: dial tcp 10.96.44.18:5432: i/o timeout`,
      `${buildTimestamp(87)} panic: unable to initialize payment ledger store: dial tcp 10.96.44.18:5432: i/o timeout`,
      `${buildTimestamp(87)} goroutine 1 [running]:`,
      `${buildTimestamp(87)} \tmain.initLedgerStore(0xc00018a000, {0x14a8b20, 0xc0000b4060})`,
      `${buildTimestamp(87)} \t\t/workspace/cmd/worker/main.go:118 +0x245`,
      `${buildTimestamp(87)} \tmain.main()`,
      `${buildTimestamp(87)} \t\t/workspace/cmd/worker/main.go:62 +0x9a`,
    ].join('\n'),

    'prod-ecommerce/payment-worker-5c6b89d74-m4n1q/worker::previous': [
      `${buildTimestamp(420)} 2026-11-17 17:59:11.012 INFO  [main] Booting payment-worker v1.9.0 (attempt #13)`,
      `${buildTimestamp(414)} 2026-11-17 17:59:17.890 ERROR [postgres] PQFATAL: remaining connection slots are reserved for superuser roles`,
      `${buildTimestamp(414)} Caused by: org.postgresql.util.PSQLException: FATAL: too many clients already`,
      `${buildTimestamp(414)} \tat com.payments.ledger.ConnectionFactory.open(ConnectionFactory.kt:89)`,
      `${buildTimestamp(414)} \tat com.payments.WorkerApplicationKt.main(WorkerApplication.kt:34)`,
    ].join('\n'),

    'prod-ecommerce/payment-worker-5c6b89d74-m4n1q/vault-agent': [
      `${buildTimestamp(100)} [INFO]  agent.auth.handler: authenticating with Kubernetes auth method`,
      `${buildTimestamp(98)} [INFO]  agent.auth.handler: authentication successful`,
      `${buildTimestamp(96)} [INFO]  agent.template.server: rendered /vault/secrets/payment-creds.json`,
    ].join('\n'),

    'prod-ecommerce/inventory-sync-6d4b5f9b7-k8p2w/sync': [
      `${buildTimestamp(180)} {"level":"info","msg":"Kafka consumer group inventory-sync-cg rebalanced","assigned_partitions":[0,1,2,3]}`,
      `${buildTimestamp(120)} {"level":"info","msg":"Synced 420 SKU stock deltas to PostgreSQL","duration_ms":41.2,"lag":0}`,
      `${buildTimestamp(45)} {"level":"warn","msg":"Dead-letter event queued for SKU-99182 (negative stock guard triggered)","sku":"SKU-99182","delta":-5,"current_qty":2}`,
    ].join('\n'),

    'prod-ecommerce/redis-cluster-0/redis': [
      `${buildTimestamp(600)} 1:M 17 Nov 2026 17:56:54.112 * Ready to accept connections tcp`,
      `${buildTimestamp(240)} 1:M 17 Nov 2026 18:02:54.308 * 10000 changes in 60 seconds. Saving...`,
      `${buildTimestamp(239)} 1:M 17 Nov 2026 18:02:54.492 * Background saving started by pid 142`,
      `${buildTimestamp(237)} 1:M 17 Nov 2026 18:02:56.815 * Background saving terminated with success`,
      `${buildTimestamp(60)} 1:M 17 Nov 2026 18:05:54.021 # WARNING overcommit_memory is set to 0! Background save may fail under low memory condition.`,
    ].join('\n'),

    'staging-payments/checkout-gateway-9b7c4d2f-r3v8t/gateway': [
      `${buildTimestamp(200)} {"level":"info","msg":"Staging feature flag enabled: apple_pay_v3=true","env":"staging"}`,
      `${buildTimestamp(150)} {"level":"debug","msg":"Webhook signature verified for event charge.succeeded","event_id":"evt_3Qa992LkdIwHu7ix","latency_ms":4.1}`,
      `${buildTimestamp(90)} {"level":"warn","msg":"Sandbox Stripe test card declined (insufficient_funds)","trace_id":"tr-stg-4029","order_id":"STG-1049"}`,
      `${buildTimestamp(30)} {"level":"info","msg":"Health check OK","uptime_sec":32400}`,
    ].join('\n'),

    'observability/prometheus-server-0/prometheus': [
      `${buildTimestamp(300)} ts=${buildTimestamp(300)} caller=main.go:1182 level=info msg="Server is ready to receive web requests."`,
      `${buildTimestamp(180)} ts=${buildTimestamp(180)} caller=compact.go:519 level=info component=tsdb msg="write block" mint=1763400000000 maxt=1763407200000 duration=1.428s`,
      `${buildTimestamp(75)} ts=${buildTimestamp(75)} caller=scrape.go:1388 level=warn component="scrape manager" scrape_pool=kubernetes-pods target=http://10.244.3.42:9090/metrics msg="Scrape failed" err="Get \\"http://10.244.3.42:9090/metrics\\": dial tcp 10.244.3.42:9090: connect: connection refused"`,
    ].join('\n'),

    'kube-system/ingress-nginx-controller-84b7f6d-q9w2z/controller': [
      `${buildTimestamp(220)} I1117 18:03:14.119022       7 controller.go:187] "Configuration changes detected, backend reload required"`,
      `${buildTimestamp(219)} I1117 18:03:14.482019       7 controller.go:205] "Backend successfully reloaded" elapsed="362ms"`,
      `${buildTimestamp(140)} E1117 18:04:34.918201       7 upstream.go:412] "upstream timed out (110: Operation timed out) while reading response header from upstream" client="203.0.113.84" host="api.shop.example.com" request="POST /api/v1/orders HTTP/2.0" upstream="10.244.2.18:8080"`,
      `${buildTimestamp(40)} W1117 18:06:14.004192       7 tls.go:94] "SSL certificate for *.staging.example.com expires in 6 days"`,
    ].join('\n'),

    'kube-system/coredns-5d78c9869d-v2x9l/coredns': [
      `${buildTimestamp(250)} [INFO] plugin/reload: Running configuration SHA512 = 591cf328cccc12bc490481272e5c3378`,
      `${buildTimestamp(160)} [INFO] 10.244.2.18:51842 - 48291 "A IN pg-orders-rw.db.svc.cluster.local. udp 52 false 512" NOERROR qr,aa,rd 104 0.000412s`,
      `${buildTimestamp(88)} [WARNING] 10.244.3.42:49201 - 11842 "A IN legacy-redis.db.svc.cluster.local. udp 54 false 512" NXDOMAIN qr,aa,rd 147 0.000891s`,
    ].join('\n'),
  };
}

let cachedDatasets: Record<string, string> | null = null;

export function getSandboxLogs(namespace: string, podName: string, containerName: string, previous: boolean): LogEntry[] {
  if (!cachedDatasets) {
    cachedDatasets = makeRawDataset();
  }
  const key = previous ? `${namespace}/${podName}/${containerName}::previous` : `${namespace}/${podName}/${containerName}`;
  const raw = cachedDatasets[key] || '';
  const pod = SANDBOX_PODS.find((p) => p.name === podName && p.namespace === namespace);
  if (!raw) return [];
  return parseRawLogs(raw, {
    namespace,
    pod: podName,
    container: containerName,
    nodeName: pod?.nodeName,
  }, `${podName}-${containerName}${previous ? '-prev' : ''}`);
}

const LIVE_TEMPLATES: Record<string, Array<() => string>> = {
  'order-api-7f9d8c4b2-x9k2p/app': [
    () => {
      const id = Math.floor(9050 + Math.random() * 900);
      const trace = Math.random().toString(16).slice(2, 14);
      const ms = (11 + Math.random() * 28).toFixed(1);
      return `${new Date().toISOString()} {"level":"info","ts":"${new Date().toISOString()}","caller":"handler/order.go:118","msg":"Order created successfully","trace_id":"tr-${trace}","order_id":"ORD-20261117-${id}","amount_cents":${Math.floor(2900 + Math.random() * 45000)},"latency_ms":${ms}}`;
    },
    () => {
      const trace = Math.random().toString(16).slice(2, 14);
      return `${new Date().toISOString()} {"level":"warn","ts":"${new Date().toISOString()}","caller":"client/inventory.go:76","msg":"Upstream inventory-sync latency exceeded SLA threshold","trace_id":"tr-${trace}","latency_ms":${Math.floor(540 + Math.random() * 450)},"threshold_ms":500}`;
    },
    () => {
      const trace = Math.random().toString(16).slice(2, 14);
      return `${new Date().toISOString()} {"level":"error","ts":"${new Date().toISOString()}","caller":"client/payment.go:142","msg":"gRPC call to payment-worker failed: context deadline exceeded","trace_id":"tr-${trace}","grpc_code":"DeadlineExceeded","status":502,"latency_ms":3001.2}`;
    },
    () => `${new Date().toISOString()} {"level":"debug","ts":"${new Date().toISOString()}","caller":"cache/redis.go:54","msg":"Cache hit for SKU pricing table","hit_ratio":0.984,"latency_ms":0.7}`,
  ],
  'envoy-sidecar': [
    () => {
      const trace = Math.random().toString(16).slice(2, 14);
      const statuses = [200, 200, 200, 201, 429, 504];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      return `${new Date().toISOString()} {"timestamp":"${new Date().toISOString()}","method":"POST","path":"/api/v1/orders","protocol":"HTTP/2","status":${status},"latency_ms":${status >= 500 ? 3001 : Math.floor(8 + Math.random() * 45)},"trace_id":"tr-${trace}"}`;
    },
  ],
  'payment-worker': [
    () => `${new Date().toISOString()} ${new Date().toISOString().replace('T', ' ').slice(0, 23)} WARN  [postgres] Waiting for pg-payments-rw.db.svc:5432 readiness probe...`,
    () => `${new Date().toISOString()} ${new Date().toISOString().replace('T', ' ').slice(0, 23)} ERROR [postgres] dial tcp 10.96.44.18:5432: i/o timeout (Back-off restarting failed container)`,
  ],
};

export function generateSandboxLiveLog(
  namespace: string,
  podName: string,
  containerName: string,
  nextLineNum: number
): LogEntry {
  const pod = SANDBOX_PODS.find((p) => p.name === podName && p.namespace === namespace);
  const specificKey = `${podName}/${containerName}`;
  const pool =
    LIVE_TEMPLATES[specificKey] ||
    LIVE_TEMPLATES[containerName] ||
    (podName.includes('payment-worker') ? LIVE_TEMPLATES['payment-worker'] : null) ||
    [
      () => `${new Date().toISOString()} {"level":"info","msg":"Heartbeat check passed","pod":"${podName}","container":"${containerName}","latency_ms":${(1 + Math.random() * 5).toFixed(1)}}`,
      () => `${new Date().toISOString()} {"level":"debug","msg":"Processed background queue batch","pod":"${podName}","items":${Math.floor(10 + Math.random() * 60)}}`,
      () => `${new Date().toISOString()} {"level":"warn","msg":"Slow query warning on replica read","pod":"${podName}","duration_ms":${Math.floor(210 + Math.random() * 190)}}`,
    ];

  const rawLine = pool[Math.floor(Math.random() * pool.length)]();
  const parsed = parseRawLogs(
    rawLine,
    { namespace, pod: podName, container: containerName, nodeName: pod?.nodeName },
    `live-${podName}-${containerName}`,
    nextLineNum
  );
  return parsed[0];
}
