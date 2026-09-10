export async function runTaskQueue(
  items: { id: string; run: () => Promise<void> }[],
  concurrency: number,
  cancelled: () => boolean,
  status: (id: string, state: "running" | "done" | "failed") => void,
) {
  let next = 0;
  const worker = async () => {
    while (!cancelled() && next < items.length) {
      const item = items[next++];
      status(item.id, "running");
      try {
        await item.run();
        status(item.id, "done");
      } catch {
        status(item.id, "failed");
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          items.length,
          Math.max(1, Math.min(4, Math.floor(concurrency) || 1)),
        ),
      },
      worker,
    ),
  );
}
