import { expect, it } from "vitest";
import { isNearReference } from "./reference-guard";
it("detects near copies despite exposure changes but rejects different structure and flat images", () => {
  const reference = Array.from(
    { length: 4096 },
    (_, i) => (i * 37 + i * i * 11) % 230,
  );
  expect(isNearReference(reference, reference)).toBe(true);
  expect(
    isNearReference(
      reference,
      reference.map((x) => x * 0.8 + 10),
    ),
  ).toBe(true);
  expect(isNearReference(reference, [...reference].reverse())).toBe(false);
  expect(isNearReference(Array(4096).fill(0), Array(4096).fill(0))).toBe(false);
});

it("detects similar large-scale structure despite fine detail changes", () => {
  const source = Array.from(
    { length: 4096 },
    (_, i) =>
      40 +
      ((((Math.floor(i / 64) / 8) | 0) + (((i % 64) / 8) | 0) * 3) % 6) * 30,
  );
  const changed = source.map((v, i) => v + (i % 2 ? 12 : -12));
  expect(isNearReference(source, changed)).toBe(true);
  expect(
    isNearReference(source, changed.slice(2048).concat(changed.slice(0, 2048))),
  ).toBe(false);
});
