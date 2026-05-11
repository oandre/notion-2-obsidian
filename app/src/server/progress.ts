import type { ProgressEvent } from '@shared/types';

export function eventToSse(event: ProgressEvent): string {
  return `event: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

interface Subscription {
  queue: ProgressEvent[];
  resolve: (() => void) | undefined;
}

export class EventBus {
  private subscribers = new Set<Subscription>();

  async publish(event: ProgressEvent): Promise<void> {
    for (const sub of this.subscribers) {
      sub.queue.push(event);
      sub.resolve?.();
    }
  }

  async *subscribe(): AsyncIterable<ProgressEvent> {
    const sub: Subscription = { queue: [], resolve: undefined };
    this.subscribers.add(sub);
    try {
      while (true) {
        const next = sub.queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((r) => {
          sub.resolve = r;
        });
        sub.resolve = undefined;
      }
    } finally {
      this.subscribers.delete(sub);
    }
  }
}
