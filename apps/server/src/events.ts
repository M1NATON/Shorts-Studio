import { EventEmitter } from "node:events";
import type { JobRecord } from "@shorts/db";

/** Что уходит в SSE: обновление задачи или «проект изменился, перечитай». */
export type StudioEvent =
  | { readonly type: "job"; readonly job: JobRecord }
  | { readonly type: "project"; readonly projectId: string };

export class StudioEvents {
  private readonly emitter = new EventEmitter();
  constructor() {
    // Каждая открытая вкладка — подписчик; предупреждение о «утечке» на 11-м не нужно.
    this.emitter.setMaxListeners(0);
  }
  emit(event: StudioEvent): void {
    this.emitter.emit("event", event);
  }
  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
