export interface GenerationModelStat {
  count: number;
  lastGeneratedAt: number;
}

export interface GenerationStatsSnapshot {
  version: 1;
  total: number;
  byModel: Record<string, GenerationModelStat>;
  updatedAt: number | null;
}

export const GENERATION_STATS_STORAGE_KEY = "scene-studio:generation-stats:v1";

const listeners = new Set<() => void>();

function emptySnapshot(): GenerationStatsSnapshot {
  return { version: 1, total: 0, byModel: {}, updatedAt: null };
}

function normalizeSnapshot(value: unknown): GenerationStatsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return emptySnapshot();
  const candidate = value as Partial<GenerationStatsSnapshot>;
  const byModel: Record<string, GenerationModelStat> = {};
  if (candidate.byModel && typeof candidate.byModel === "object") {
    Object.entries(candidate.byModel).forEach(([model, raw]) => {
      if (!raw || typeof raw !== "object") return;
      const item = raw as Partial<GenerationModelStat>;
      const count = Math.floor(Number(item.count));
      const lastGeneratedAt = Number(item.lastGeneratedAt);
      if (!model.trim() || !Number.isFinite(count) || count <= 0) return;
      byModel[model] = {
        count,
        lastGeneratedAt: Number.isFinite(lastGeneratedAt)
          ? lastGeneratedAt
          : 0,
      };
    });
  }
  const total = Object.values(byModel).reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const updatedAt = Number(candidate.updatedAt);
  return {
    version: 1,
    total,
    byModel,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
  };
}

function readSnapshot(): GenerationStatsSnapshot {
  if (typeof localStorage === "undefined") return emptySnapshot();
  try {
    const raw = localStorage.getItem(GENERATION_STATS_STORAGE_KEY);
    return raw ? normalizeSnapshot(JSON.parse(raw)) : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

let snapshot = readSnapshot();

function publish(next: GenerationStatsSnapshot) {
  snapshot = next;
  try {
    localStorage.setItem(GENERATION_STATS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Counting must not break generation when browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function getGenerationStatsSnapshot() {
  return snapshot;
}

export function subscribeGenerationStats(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordGeneratedImages(
  model: string,
  count = 1,
  generatedAt = Date.now(),
) {
  const normalizedModel = model.trim();
  const normalizedCount = Math.floor(count);
  if (!normalizedModel || !Number.isFinite(normalizedCount) || normalizedCount <= 0)
    return;
  const current = readSnapshot();
  const previous = current.byModel[normalizedModel];
  publish({
    version: 1,
    total: current.total + normalizedCount,
    byModel: {
      ...current.byModel,
      [normalizedModel]: {
        count: (previous?.count || 0) + normalizedCount,
        lastGeneratedAt: generatedAt,
      },
    },
    updatedAt: generatedAt,
  });
}

export function resetGenerationStats() {
  publish(emptySnapshot());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== GENERATION_STATS_STORAGE_KEY) return;
    snapshot = event.newValue
      ? (() => {
          try {
            return normalizeSnapshot(JSON.parse(event.newValue));
          } catch {
            return emptySnapshot();
          }
        })()
      : emptySnapshot();
    listeners.forEach((listener) => listener());
  });
}
