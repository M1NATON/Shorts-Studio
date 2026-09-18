import type { SceneVersion } from "./api";

/**
 * Варианты, из которых ещё не выбирали: последняя пачка пересборки, если она
 * новее текущей версии и текущая не из неё. Выбор одного закрывает всю пачку.
 */
export function pendingVariants(versions: readonly SceneVersion[], currentId: string): SceneVersion[] {
  const current = versions.find((v) => v.id === currentId);
  const all = versions.filter((v) => v.origin === "variant");
  const newest = all.reduce<SceneVersion | undefined>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), undefined);
  if (!newest) return [];
  const batch = newest.batchId ?? newest.id;
  const members = all.filter((v) => (v.batchId ?? v.id) === batch);
  if (current && ((current.batchId ?? current.id) === batch || members.every((v) => v.createdAt < current.createdAt))) return [];
  // В порядке создания: «По пожеланию» первым, как его поставил сервер.
  return members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
