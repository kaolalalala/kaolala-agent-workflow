import { Event } from "@/server/domain";

type EventSubscriber = (event: Event) => void;

class EventStreamHub {
  private subscribers = new Map<string, Set<EventSubscriber>>();

  subscribe(runId: string, handler: EventSubscriber) {
    const set = this.subscribers.get(runId) ?? new Set<EventSubscriber>();
    set.add(handler);
    this.subscribers.set(runId, set);

    return () => {
      const current = this.subscribers.get(runId);
      current?.delete(handler);
      if (current && current.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  publish(runId: string, event: Event) {
    const set = this.subscribers.get(runId);
    if (!set) {
      return;
    }

    for (const subscriber of set) {
      try {
        subscriber(event);
      } catch (error) {
        console.error("[EventStream] subscriber error:", error);
      }
    }
  }
}

export const eventStreamHub = new EventStreamHub();
