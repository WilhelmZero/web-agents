import { useEffect, useState } from "react";
import { processInWorker } from "./workerClient";
import type { RenderParams, Rendered } from "./types";

const cache = new WeakMap<RenderParams, WeakMap<Blob, Map<number, Rendered>>>();
function cached(source: Blob, params: RenderParams, edge: number) {
  return cache.get(params)?.get(source)?.get(edge);
}
function remember(
  source: Blob,
  params: RenderParams,
  edge: number,
  result: Rendered,
) {
  let sources = cache.get(params);
  if (!sources) {
    sources = new WeakMap();
    cache.set(params, sources);
  }
  let sizes = sources.get(source);
  if (!sizes) {
    sizes = new Map();
    sources.set(source, sizes);
  }
  sizes.set(edge, result);
}

let running = 0;
const waiting: (() => void)[] = [];
async function queuedPreview(
  blob: Blob,
  params: RenderParams,
  signal: AbortSignal,
) {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await processInWorker(blob, params, signal);
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
export function useEngravingPreview(
  source: Blob,
  params: RenderParams,
  edge = 1200,
) {
  const [value, setValue] = useState<{ source: Blob; blob: Blob }>();
  const [error, setError] = useState(""),
    [computing, setComputing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const hit = cached(source, params, edge);
    if (hit) {
      setValue({ source, blob: hit.buffer });
      setError(hit.warnings.join("；"));
      setComputing(false);
      return;
    }
    setComputing(true);
    const timer = setTimeout(() => {
      queuedPreview(
        source,
        { ...params, preview: true, previewEdge: edge },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            remember(source, params, edge, result);
            setValue({ source, blob: result.buffer });
            setError(result.warnings.join("；"));
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setComputing(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, params, edge]);
  return {
    blob:
      cached(source, params, edge)?.buffer ||
      (value?.source === source
        ? value.blob
        : cached(source, params, 400)?.buffer),
    computing,
    error,
  };
}
