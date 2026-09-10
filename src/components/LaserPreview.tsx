import { useEffect, useRef, useState } from "react";
import { Alert, Button, Image, Modal, Select, Space, Spin } from "antd";
import type { StoredResult } from "../services/engraving/types";
import { processInWorker } from "../services/engraving/workerClient";
import {
  openLaser3d,
  openHighQualityLaser3d,
  type LaserPayload,
} from "../services/engraving/laserBridge";
import { downloadEngraving } from "./EngravingResultCard";

async function glassSimulation(blob: Blob, signal: AbortSignal) {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const c = canvas.getContext("2d")!;
  c.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  if (signal.aborted) throw new DOMException("取消", "AbortError");
  const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const a = (pixels.data[i] * pixels.data[i + 3]) / 255;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 245;
    pixels.data[i + 3] = a;
  }
  c.putImageData(pixels, 0, 0);
  c.globalCompositeOperation = "destination-over";
  const g = c.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, "#17252d");
  g.addColorStop(0.48, "#566b76");
  g.addColorStop(1, "#162129");
  c.fillStyle = g;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.globalCompositeOperation = "source-over";
  c.strokeStyle = "rgba(255,255,255,.22)";
  c.lineWidth = 2;
  c.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("玻璃预览生成失败"))),
      "image/png",
    ),
  );
}
export default function LaserPreview({
  result,
  onClose,
}: {
  result: StoredResult;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => ({
    blob: result.job.blob,
    params: structuredClone(result.params),
  }));
  const [mode, setMode] = useState<"dither" | "grayscale">("dither");
  const [output, setOutput] = useState<{
    mode: string;
    payload: LaserPayload;
    laser: string;
    glass: string;
  }>();
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const bridgeCleanup = useRef<() => void>(() => {});
  const current = output?.mode === mode ? output : undefined;
  useEffect(() => {
    const controller = new AbortController();
    let urls: string[] = [];
    setOutput(undefined);
    setError("");
    setMessage("");
    bridgeCleanup.current();
    void (async () => {
      try {
        const params = { ...snapshot.params, mode, preview: false };
        const rendered = await processInWorker(
          snapshot.blob,
          params,
          controller.signal,
        );
        const simulation = await glassSimulation(
          rendered.buffer,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        urls = [
          URL.createObjectURL(rendered.buffer),
          URL.createObjectURL(simulation),
        ];
        setOutput({
          mode,
          laser: urls[0],
          glass: urls[1],
          payload: {
            blob: rendered.buffer,
            name: `engraving-${mode}.png`,
            width: rendered.width,
            height: rendered.height,
            dpi: params.dpi,
            widthMm: (rendered.width / params.dpi) * 25.4,
            heightMm: (rendered.height / params.dpi) * 25.4,
            mode,
          },
        });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "预览生成失败");
      }
    })();
    return () => {
      controller.abort();
      urls.forEach(URL.revokeObjectURL);
    };
  }, [snapshot, mode]);
  useEffect(() => () => bridgeCleanup.current(), []);
  return (
    <Modal
      open
      width={1100}
      title="雕刻预览"
      onCancel={onClose}
      footer={
        <Space wrap>
          <Button
            disabled={!current}
            onClick={() =>
              current &&
              downloadEngraving(current.payload.blob, current.payload.name)
            }
          >
            下载雕刻用图
          </Button>
          <Button
            type="primary"
            disabled={!current}
            onClick={() => {
              if (current) {
                bridgeCleanup.current();
                bridgeCleanup.current = openLaser3d(
                  current.payload,
                  setMessage,
                );
              }
            }}
          >
            3D预览
          </Button>
          <Button
            disabled={!current}
            onClick={() => {
              if (current) {
                bridgeCleanup.current();
                bridgeCleanup.current = openHighQualityLaser3d(
                  current.payload,
                  setMessage,
                );
              }
            }}
          >
            高质量3D预览
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <Space wrap>
        <Select
          aria-label="雕刻预览格式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "dither", label: "黑白点阵" },
            { value: "grayscale", label: "连续灰度" },
          ]}
        />
        <span>白色雕刻 · 黑色不雕刻</span>
        {current && (
          <span>
            {current.payload.width} × {current.payload.height}px ·{" "}
            {current.payload.dpi} DPI
          </span>
        )}
      </Space>
      <p>
        材质模拟，实际效果取决于设备与玻璃。点击图片可放大，滚轮缩放并拖动查看。
      </p>
      {error ? (
        <Alert type="error" title={error} />
      ) : !current ? (
        <div style={{ padding: 70, textAlign: "center" }}>
          <Spin />
          <p>正在按最终输出尺寸计算预览…</p>
        </div>
      ) : (
        <div className="laser-preview-grid">
          {[
            { title: "激光雕刻用图", url: current.laser },
            { title: "透明玻璃雕刻模拟", url: current.glass },
          ].map((item) => (
            <section key={item.title}>
              <h3>{item.title}</h3>
              <Image
                src={item.url}
                alt={item.title}
                style={{ maxHeight: 500, objectFit: "contain" }}
                preview={{
                  actionsRender: (node, info) => (
                    <>
                      {node}
                      <Button onClick={info.actions.onReset}>复位</Button>
                    </>
                  ),
                }}
              />
            </section>
          ))}
        </div>
      )}
      {message && (
        <Alert style={{ marginTop: 16 }} type="info" title={message} />
      )}
    </Modal>
  );
}
