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
      adaptationMode: "local",
      localAdaptation: {
        sourceWidth: 100,
        sourceHeight: 80,
        background: "#ffffff",
        confidence: 1,
        objects: [
          {
            id: "object",
            blob: new Blob(["object"]),
            rect: { x: 1, y: 2, width: 3, height: 4 },
            role: "main",
          },
        ],
        layers: [
          {
            id: "object",
            blob: new Blob(["object"]),
            x: 10,
            y: 20,
            width: 30,
            rotation: 0,
            locked: true,
          },
        ],
        fill: 40,
        gap: 2,
        scale: 1,
        seed: 1,
        backgroundMode: "white",
        backgroundColor: "#ffffff",
        cupKey: JSON.stringify(DEFAULT_CUP),
        unplaced: [],
      },
    },
  ]);
  const [d] = await loadDesigns();
  expect(d.quantity).toBe(2);
  expect(await d.source!.text()).toBe("edited");
  expect(await d.originalSource!.text()).toBe("original");
  expect(await d.adopted!.text()).toBe("result");
  expect(d.localAdaptation?.objects).toHaveLength(1);
  expect(await d.localAdaptation!.objects[0].blob.text()).toBe("object");
});
