import { expect, it, vi, afterEach } from "vitest";
import { openLaser3d, openHighQualityLaser3d } from "./laserBridge";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const payload = {
  blob: new Blob(["png"], { type: "image/png" }),
  name: "a.png",
  width: 300,
  height: 600,
  widthMm: 25.4,
  heightMm: 50.8,
  dpi: 300,
  mode: "dither" as const,
};
it("reports blocked popups", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const status = vi.fn();
  openLaser3d(payload, status);
  expect(status).toHaveBeenCalledWith(expect.stringContaining("拦截"));
});
it("transfers only to the matching window/session and stops after acknowledgment", () => {
  vi.useFakeTimers();
  const child = { closed: false, postMessage: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(child as unknown as Window);
  const status = vi.fn();
  openLaser3d(payload, status);
  const hello = child.postMessage.mock.calls[0][0];
  const send = (source: any, origin: string, type: string) =>
    window.dispatchEvent(
      new MessageEvent("message", { source, origin, data: { ...hello, type } }),
    );
  send(null, "https://wilhelmzero.github.io", "ready");
  expect(child.postMessage).toHaveBeenCalledTimes(1);
  send(child, "https://wilhelmzero.github.io", "ready");
  expect(child.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "image", payload }),
    "https://wilhelmzero.github.io",
  );
  send(child, "https://wilhelmzero.github.io", "applied");
  vi.advanceTimersByTime(50000);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining("自动导入"));
});

it("opens the high quality destination with the same payload and allows its longer initialization", () => {
  vi.useFakeTimers();
  const child = { closed: false, postMessage: vi.fn() };
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(child as unknown as Window);
  const status = vi.fn();
  const stop = openHighQualityLaser3d(payload, status);
  expect(String(open.mock.calls[0][0])).toMatch(
    /^https:\/\/wilhelmzero.github.io\/cup-studio\/\?engravingPreview=1&session=/,
  );
  const hello = child.postMessage.mock.calls[0][0];
  window.dispatchEvent(
    new MessageEvent("message", {
      source: child as unknown as Window,
      origin: "https://wilhelmzero.github.io",
      data: { ...hello, type: "ready" },
    }),
  );
  expect(child.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "image", payload }),
    "https://wilhelmzero.github.io",
  );
  vi.advanceTimersByTime(46000);
  expect(status).not.toHaveBeenLastCalledWith(expect.stringContaining("超时"));
  vi.advanceTimersByTime(74001);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining("超时"));
  stop();
});
