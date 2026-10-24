// Notifications. Proposed in docs/DESIGN.md §7: ntfy push to your phone.
// Without NTFY_TOPIC_URL the worker only logs, which is fine for a first run.

export interface Notification {
  title: string;
  message: string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent';
  tags?: string[];
  /** Opened when the notification is tapped. */
  clickUrl?: string;
}

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

export class NtfyNotifier implements Notifier {
  private readonly base: string;
  private readonly topic: string;

  /** `topicUrl` is the full topic URL, e.g. `https://ntfy.sh/my-secret-topic`. */
  constructor(
    topicUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(topicUrl);
    const topic = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!topic || topic.includes('/')) throw new Error('NTFY_TOPIC_URL must look like https://ntfy.sh/<topic>');
    this.topic = topic;
    this.base = url.origin;
  }

  async send(n: Notification): Promise<void> {
    // JSON publishing keeps titles and messages UTF-8 safe (headers are not).
    const res = await this.fetchImpl(this.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({
        topic: this.topic,
        title: n.title,
        message: n.message,
        priority: { min: 1, low: 2, default: 3, high: 4, urgent: 5 }[n.priority ?? 'default'],
        tags: n.tags ?? [],
        ...(n.clickUrl ? { click: n.clickUrl } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy returned HTTP ${res.status}`);
  }
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  send(n: Notification): Promise<void> {
    this.log(`[notify] ${n.title}: ${n.message}${n.clickUrl ? ` (${n.clickUrl})` : ''}`);
    return Promise.resolve();
  }
}
