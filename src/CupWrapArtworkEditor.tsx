import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, InputNumber, Modal, Select, Space } from "antd";
import type { ArtLayer, WrapDesign } from "./services/cupWrap/types";
import { geometry } from "./services/cupWrap/geometry";
import {
  backgroundCandidates,
  suggestRegions,
  type Region,
} from "./services/cupWrap/artwork";
/** All erasing operates on an editable copy; the design's original remains available. */
export default function CupWrapArtworkEditor({
  design,
  onClose,
  onApply,
}: {
  design: WrapDesign;
  onClose: () => void;
  onApply: (source: Blob, layers: ArtLayer[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    original = useRef<ImageData | null>(null),
    history = useRef<{ image: ImageData; layers: ArtLayer[] }[]>([]),
    start = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<"select" | "erase" | "restore">("select"),
    [brush, setBrush] = useState(20),
    [rect, setRect] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    }>(),
    [locked, setLocked] = useState(true),
    [layers, setLayers] = useState<ArtLayer[]>(design.layers),
    [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Region[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!design.source) return;
    createImageBitmap(design.source).then((img) => {
      if (cancelled) {
        img.close();
        return;
      }
      const c = canvas.current!;
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      original.current = c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height);
      img.close();
    });
    return () => {
      cancelled = true;
    };
  }, [design.source]);
  const snapshot = () => {
    const c = canvas.current!;
    history.current.push({
      image: c.getContext("2d")!.getImageData(0, 0, c.width, c.height),
      layers: [...layers],
    });
    const limit = Math.max(
      1,
      Math.min(10, Math.floor(128_000_000 / (c.width * c.height * 4))),
    );
    while (history.current.length > limit) history.current.shift();
  };
  const point = (e: React.PointerEvent) => {
    const c = canvas.current!,
      r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const paint = (x: number, y: number) => {
    const c = canvas.current!,
      ctx = c.getContext("2d")!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      x,
      y,
      (brush * c.width) / c.getBoundingClientRect().width / 2,
      0,
      2 * Math.PI,
    );
    ctx.clip();
    if (mode === "erase") {
      ctx.clearRect(0, 0, c.width, c.height);
    } else if (original.current) {
      const temp = document.createElement("canvas");
      temp.width = c.width;
      temp.height = c.height;
      temp.getContext("2d")!.putImageData(original.current, 0, 0);
      ctx.drawImage(temp, 0, 0);
    }
    ctx.restore();
  };
  const extract = async () => {
    if (!rect || rect.w < 2 || rect.h < 2) return;
    const c = canvas.current!,
      out = document.createElement("canvas");
    out.width = Math.round(rect.w);
    out.height = Math.round(rect.h);
    out
      .getContext("2d")!
      .drawImage(
        c,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        0,
        0,
        out.width,
        out.height,
      );
    const blob = await new Promise<Blob>((resolve) =>
      out.toBlob((v) => resolve(v!), "image/png"),
    );
    const g = geometry(design.cup);
    setLayers((a) => [
      ...a,
      {
        id: crypto.randomUUID(),
        blob,
        x: g.width / 2,
        y: g.height / 2,
        width: (g.width * rect.w) / c.width,
        rotation: 0,
        locked,
      },
    ]);
    snapshot();
    c.getContext("2d")!.clearRect(rect.x, rect.y, rect.w, rect.h);
    setRect(undefined);
  };
  return (
    <Modal
      open
      title="素材提取／背景蒙版修正（不删除全部白色）"
      width={1000}
      onCancel={onClose}
      onOk={() =>
        canvas.current?.toBlob((blob) => {
          if (blob) onApply(blob, layers);
        }, "image/png")
      }
      okText="确认采用"
    >
      <p>
        框选完整角色或名字，提取为独立图层；重叠内容需手动修正。擦除仅修改副本，恢复画笔可找回原始像素。默认不自动抠白底。
      </p>
      <Space wrap>
        <Button
          onClick={() => {
            const c = canvas.current!;
            const small = document.createElement("canvas");
            const scale = Math.min(1, 900 / c.width);
            small.width = Math.round(c.width * scale);
            small.height = Math.round(c.height * scale);
            const ctx = small.getContext("2d")!;
            ctx.drawImage(c, 0, 0, small.width, small.height);
            setSuggestions(
              suggestRegions(
                ctx.getImageData(0, 0, small.width, small.height).data,
                small.width,
                small.height,
              ).map((r) => ({
                x: r.x / scale,
                y: r.y / scale,
                w: r.w / scale,
                h: r.h / scale,
              })),
            );
          }}
        >
          分析拆分建议
        </Button>
        <Button
          onClick={() =>
            Modal.confirm({
              title: "移除边界连通的近白背景？",
              content:
                "不会删除封闭轮廓内的白色；开放轮廓可能误删，请用恢复画笔修正。修改后仍需点击确认采用。",
              onOk: () => {
                const c = canvas.current!,
                  ctx = c.getContext("2d")!,
                  im = ctx.getImageData(0, 0, c.width, c.height);
                snapshot();
                const bg = backgroundCandidates(im.data, c.width, c.height);
                for (let i = 0; i < bg.length; i++)
                  if (bg[i]) im.data[i * 4 + 3] = 0;
                ctx.putImageData(im, 0, 0);
              },
            })
          }
        >
          背景分离候选
        </Button>
        <Select
          value={mode}
          onChange={setMode}
          options={[
            { value: "select", label: "框选素材" },
            { value: "erase", label: "擦除背景" },
            { value: "restore", label: "恢复像素" },
          ]}
        />
        <InputNumber
          min={1}
          max={100}
          value={brush}
          onChange={(n) => setBrush(n || 20)}
        />
        <Checkbox
          checked={locked}
          onChange={(e) => setLocked(e.target.checked)}
        >
          提取为保护图层
        </Checkbox>
        <Button
          disabled={!rect}
          onClick={() => extract().catch((e) => setError(String(e)))}
        >
          提取选区
        </Button>
        <Button
          onClick={() => {
            const previous = history.current.pop();
            if (previous) {
              canvas
                .current!.getContext("2d")!
                .putImageData(previous.image, 0, 0);
              setLayers(previous.layers);
            }
          }}
        >
          撤销（10笔）
        </Button>
      </Space>
      {error && <p>{error}</p>}
      {suggestions.length > 0 && (
        <Space wrap>
          <span>候选区域（请逐项确认；相邻碎片可重新框选合并）</span>
          {suggestions.map((r, i) => (
            <Button key={i} size="small" onClick={() => setRect(r)}>
              区域 {i + 1}
            </Button>
          ))}
          <Button
            onClick={() =>
              setRect(
                suggestions.reduce((a, b) => ({
                  x: Math.min(a.x, b.x),
                  y: Math.min(a.y, b.y),
                  w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                  h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
                })),
              )
            }
          >
            合并全部候选框
          </Button>
        </Space>
      )}
      <div
        style={{
          position: "relative",
          marginTop: 12,
          background:
            "repeating-conic-gradient(#ddd 0% 25%,white 0% 50%) 0/20px 20px",
        }}
      >
        <canvas
          ref={canvas}
          style={{ width: "100%", touchAction: "none", display: "block" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = point(e);
            if (mode !== "select") {
              snapshot();
              paint(start.current.x, start.current.y);
            }
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = point(e);
            if (mode === "select")
              setRect({
                x: Math.max(0, Math.min(p.x, start.current.x)),
                y: Math.max(0, Math.min(p.y, start.current.y)),
                w: Math.min(
                  canvas.current!.width,
                  Math.abs(p.x - start.current.x),
                ),
                h: Math.min(
                  canvas.current!.height,
                  Math.abs(p.y - start.current.y),
                ),
              });
            else paint(p.x, p.y);
          }}
          onPointerUp={() => {
            start.current = null;
          }}
        />
        {rect && canvas.current && (
          <div
            style={{
              pointerEvents: "none",
              position: "absolute",
              border: "2px solid red",
              left: `${(rect.x / canvas.current.width) * 100}%`,
              top: `${(rect.y / canvas.current.height) * 100}%`,
              width: `${(rect.w / canvas.current.width) * 100}%`,
              height: `${(rect.h / canvas.current.height) * 100}%`,
            }}
          />
        )}
      </div>
      <p>
        已提取 {layers.length}{" "}
        个图层，采用后可在设置中移动、等比缩放、旋转或删除。
      </p>
    </Modal>
  );
}
