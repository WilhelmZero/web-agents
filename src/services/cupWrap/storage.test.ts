// @vitest-environment node
import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { loadDesigns, saveDesigns } from "./storage";
import { DEFAULT_CUP } from "./geometry";
it("restores original blobs, edits and adopted candidates independently", async () => {
  await saveDesigns([
    {
      id: "test",
      name: "Saved",
      cup: { ...DEFAULT_CUP },
      source: new Blob(["edited"]),
      originalSource: new Blob(["original"]),
      adopted: new Blob(["result"]),
      aiResults: [new Blob(["result"])],
      fit: "contain",
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      layers: [],
      quantity: 2,
      prompt: "exact",
    },
  ]);
  const [d] = await loadDesigns();
  expect(d.quantity).toBe(2);
  expect(await d.source!.text()).toBe("edited");
  expect(await d.originalSource!.text()).toBe("original");
  expect(await d.adopted!.text()).toBe("result");
});
