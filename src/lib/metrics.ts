import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry, prefix: 'smachnogo_' });

export const httpRequestDuration = new Histogram({
  name: 'smachnogo_http_request_duration_seconds',
  help: 'HTTP request duration by route',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const socketConnections = new Gauge({
  name: 'smachnogo_socket_connections',
  help: 'Open Socket.io connections on this instance',
  registers: [metricsRegistry],
});

export const jobRuns = new Counter({
  name: 'smachnogo_job_runs_total',
  help: 'Background job runs by result',
  labelNames: ['job', 'result'] as const,
  registers: [metricsRegistry],
});

export const jobDuration = new Histogram({
  name: 'smachnogo_job_duration_seconds',
  help: 'Background job duration',
  labelNames: ['job'] as const,
  buckets: [0.05, 0.1, 0.5, 1, 5, 15, 60],
  registers: [metricsRegistry],
});

export const paymentResults = new Counter({
  name: 'smachnogo_payment_results_total',
  help: 'Processed payment results by provider and outcome',
  labelNames: ['provider', 'outcome'] as const,
  registers: [metricsRegistry],
});

export const uploads = new Counter({
  name: 'smachnogo_uploads_total',
  help: 'Image uploads by kind and result',
  labelNames: ['kind', 'result'] as const,
  registers: [metricsRegistry],
});
