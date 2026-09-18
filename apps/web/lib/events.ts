"use client";
/**
 * Подписка на события сервера (SSE). Одно соединение на вкладку; компоненты
 * подписываются на него, а не открывают своё — иначе на странице библиотеки
 * с сотней карточек было бы сто соединений.
 */
import { useEffect, useRef } from "react";
import type { Job } from "./api";

export type StudioEvent = { type: "job"; job: Job } | { type: "project"; projectId: string };

type Listener = (event: StudioEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | undefined;

function ensureSource(): void {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/events");
  const dispatch = (raw: MessageEvent<string>) => {
    try {
      const event = JSON.parse(raw.data) as StudioEvent;
      listeners.forEach((listener) => listener(event));
    } catch {
      // битое событие не должно ронять страницу
    }
  };
  source.addEventListener("job", dispatch);
  source.addEventListener("project", dispatch);
}

export function useStudioEvents(listener: Listener): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    ensureSource();
    const wrapped: Listener = (event) => ref.current(event);
    listeners.add(wrapped);
    return () => {
      listeners.delete(wrapped);
    };
  }, []);
}
