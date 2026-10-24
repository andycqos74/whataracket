// Worker configuration, from the environment only (README rule 3).

export interface Config {
  temporal: {
    address: string;
    namespace: string;
    taskQueue: string;
    /** Temporal Cloud or an mTLS/API-key front end. Optional for a home server. */
    apiKey?: string;
    tls: boolean;
  };
  clubspark: {
    host: string;
    roleName?: string;
    userAgent?: string;
  };
  ntfy?: { topicUrl: string; token?: string };
}

type Env = Record<string, string | undefined>;

function get(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function readConfig(env: Env = process.env): Config {
  const apiKey = get(env, 'TEMPORAL_API_KEY');
  const roleName = get(env, 'CLUBSPARK_ROLE');
  const userAgent = get(env, 'CLUBSPARK_USER_AGENT');
  const topicUrl = get(env, 'NTFY_TOPIC_URL');
  const token = get(env, 'NTFY_TOKEN');
  return {
    temporal: {
      address: get(env, 'TEMPORAL_ADDRESS') ?? 'localhost:7233',
      namespace: get(env, 'TEMPORAL_NAMESPACE') ?? 'default',
      taskQueue: get(env, 'TEMPORAL_TASK_QUEUE') ?? 'whataracket',
      ...(apiKey ? { apiKey } : {}),
      tls: get(env, 'TEMPORAL_TLS') === 'true' || apiKey !== undefined,
    },
    clubspark: {
      host: get(env, 'CLUBSPARK_HOST') ?? 'clubspark.lta.org.uk',
      ...(roleName ? { roleName } : {}),
      ...(userAgent ? { userAgent } : {}),
    },
    ...(topicUrl ? { ntfy: { topicUrl, ...(token ? { token } : {}) } } : {}),
  };
}

/** Connection options shared by the worker and the CLI. */
export function connectionOptions(config: Config): { address: string; tls?: boolean; apiKey?: string } {
  return {
    address: config.temporal.address,
    ...(config.temporal.tls ? { tls: true } : {}),
    ...(config.temporal.apiKey ? { apiKey: config.temporal.apiKey } : {}),
  };
}
