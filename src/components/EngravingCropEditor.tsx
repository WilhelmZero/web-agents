import { useRef, useState } from "react";
import { Button, Select, Space } from "antd";
import type { CropRect } from "../services/engraving/types";
const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
export default function EngravingCropEditor({
  url,
  width,
  height,
  value,
  onApply,
  onCancel,
}: {
  url: string;
  width: number;
  height: number;
  value?: CropRect | null;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState<CropRect>(value || FULL),
    [ratio, setRatio] = useState(0);
  const drag = useRef<{
    x: number;
    y: number;
    crop: CropRect;
    mode: "draw" | "move" | "resize";
  } | null>(null);
  function resize(x: number, y: number, w: number, h: number) {
    w = Math.max(1 / width, Math.min(1 - x, w));
    h = Math.max(1 / height, Math.min(1 - y, h));
    if (ratio) {
      const normalizedRatio = (ratio * height) / width;
      h = w / normalizedRatio;
      if (h > 1 - y) {
        h = 1 - y;
        w = h * normalizedRatio;
      }
    }
    return { x, y, width: w, height: h };
  }
  return (
    <div>
      <Space wrap>
        <span>裁剪比例</span>
        <Select
          aria-label="裁剪比例"
          value={ratio}
          style={{ width: 130 }}
          onChange={(v) => {
            setRatio(v);
            if (v) {
              const n = (v * height) / width,
                w = Math.min(1, n),
                h = w / n;
              setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h });
            }
          }}
          options={[
            { value: 0, label: "自由比例" },
            ...[
              [1, 1],
              [4, 3],
              [3, 4],
              [16, 9],
              [9, 16],
            ].map(([w, h]) => ({ value: w / h, label: w + ":" + h })),
          ]}
        />
        <Button onClick={() => onApply(crop)}>应用裁剪</Button>
        <Button onClick={onCancel}>取消裁剪</Button>
      </Space>
      <p>
        拖动框内移动，拖动右下角调整大小，框外拖动重新框选。原始文件不会被修改。
      </p>
      <svg
        className="engraving-crop-stage"
        aria-label="裁剪画布"
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={(e) => {
          const matrix = e.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            matrix.inverse(),
          );
          const x = Math.max(0, Math.min(1 - 1 / width, p.x / width)),
            y = Math.max(0, Math.min(1 - 1 / height, p.y / height));
          const mode = (e.target as SVGElement).getAttribute("data-mode") as
            "move" | "resize" | null;
          drag.current = { x, y, crop, mode: mode || "draw" };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current,
            matrix = e.currentTarget.getScreenCTM();
          if (!d || !matrix) return;
          const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            matrix.inverse(),
          );
          const x = Math.max(0, Math.min(1, p.x / width)),
            y = Math.max(0, Math.min(1, p.y / height));
          if (d.mode === "move")
            setCrop({
              ...d.crop,
              x: Math.max(0, Math.min(1 - d.crop.width, d.crop.x + x - d.x)),
              y: Math.max(0, Math.min(1 - d.crop.height, d.crop.y + y - d.y)),
            });
          else if (d.mode === "resize")
            setCrop(resize(d.crop.x, d.crop.y, x - d.crop.x, y - d.crop.y));
          else
            setCrop(
              resize(
                Math.min(d.x, x),
                Math.min(d.y, y),
                Math.abs(x - d.x),
                Math.abs(y - d.y),
              ),
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <image href={url} width={width} height={height} />
        <path
          fill="rgba(0,0,0,.5)"
          fillRule="evenodd"
          d={`M0 0H${width}V${height}H0Z M${crop.x * width} ${crop.y * height}h${crop.width * width}v${crop.height * height}h${-crop.width * width}Z`}
        />
        <rect
          data-mode="move"
          x={crop.x * width}
          y={crop.y * height}
          width={crop.width * width}
          height={crop.height * height}
          fill="transparent"
          stroke="#a78bfa"
          strokeWidth={Math.max(width, height) / 300}
          style={{ cursor: "move" }}
        />
        <rect
          data-mode="resize"
          x={(crop.x + crop.width) * width - width * 0.025}
          y={(crop.y + crop.height) * height - height * 0.025}
          width={width * 0.05}
          height={height * 0.05}
          fill="#a78bfa"
          style={{ cursor: "nwse-resize" }}
        />
      </svg>
    </div>
  );
}
