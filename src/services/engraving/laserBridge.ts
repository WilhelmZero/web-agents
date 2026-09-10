export type LaserPayload = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  dpi: number;
  mode: "dither" | "grayscale";
};
export function openLaser3d(
  payload: LaserPayload,
  status: (text: string) => void,
  target = (import.meta.env.DEV && import.meta.env.VITE_3D_PREVIEW_URL) ||
    "https://wilhelmzero.github.io/img2threejs/",
) {
  const session = crypto.randomUUID(),
    url = new URL(target);
  url.searchParams.set("engravingPreview", "1");
  url.searchParams.set("session", session);
  const child = window.open(url.href, "_blank");
  if (!child) {
    status("新窗口被拦截，请允许弹窗后重试，或下载图片后手动导入。");
    return () => {};
  }
  const bridge = "engraving-preview-v1";
  let sent = false,
    finished = false;
  const cleanup = () => {
    finished = true;
    clearInterval(interval);
    clearTimeout(timeout);
    window.removeEventListener("message", receive);
  };
  const receive = (e: MessageEvent) => {
    if (
      e.source !== child ||
      e.origin !== url.origin ||
      e.data?.bridge !== bridge ||
      e.data?.session !== session
    )
      return;
    if (e.data.type === "ready" && !sent) {
      sent = true;
      child.postMessage(
        { bridge, session, type: "image", payload },
        url.origin,
      );
      status("正在应用雕刻贴图…");
    }
    if (e.data.type === "applied") {
      cleanup();
      status("3D预览已打开，雕刻贴图已自动导入。");
    }
    if (e.data.type === "error") {
      cleanup();
      status("3D导入失败，请重试或下载图片后手动导入。");
    }
  };
  const ping = () => {
    if (finished) return;
    if (child.closed) {
      cleanup();
      status("3D窗口已关闭，可重新打开。");
      return;
    }
    child.postMessage({ bridge, session, type: "hello" }, url.origin);
  };
  const interval = setInterval(ping, 500),
    timeout = setTimeout(() => {
      cleanup();
      status("3D导入超时，请重试或下载图片后手动导入。");
    }, 45000);
  window.addEventListener("message", receive);
  status("等待3D工作台就绪…");
  ping();
  return cleanup;
}
