import { expect, it, vi, afterEach } from "vitest";
import { openLaser3d } from "./laserBridge";
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
