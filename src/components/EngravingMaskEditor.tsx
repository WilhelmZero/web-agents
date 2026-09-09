import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Alert, Button, Modal, Slider, Space } from "antd";
import type { ImageJob } from "../services/engraving/types";

export default function EngravingMaskEditor({
  job,
  sourceUrl,
  value,
  onClose,
  onSave,
}: {
  job: ImageJob;
  sourceUrl: string;
  value?: string;
  onClose: () => void;
  onSave: (mask?: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<({ x: number; y: number }[] | null)[]>([]);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const [displaySize, setDisplaySize] = useState({ width: 1, height: 1 });
  const widths = useRef<number[]>([]);
  const undoFloor = useRef(0);
  const baseline = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const [brush, setBrush] = useState(35),
    [count, setCount] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  function redraw() {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, job.width, job.height);
    if (baseline.current) ctx.drawImage(baseline.current, 0, 0);
    history.current.forEach((points, index) => {
      if (!points) {
        ctx.clearRect(0, 0, job.width, job.height);
        return;
      }
      ctx.lineWidth = widths.current[index];
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      points.forEach((p, i) => {
        if (!i) ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.01, p.y + 0.01);
      });
      ctx.stroke();
    });
  }
  useEffect(() => {
    const element = stageElement;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const ratio = Math.min(box.width / job.width, box.height / job.height);
      setDisplaySize({ width: job.width * ratio, height: job.height * ratio });
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageElement, job.width, job.height]);
  useEffect(() => {
    if (!stageElement) return;
    if (!value) {
      setReady(true);
      return;
    }
    let disposed = false;
    const image = new window.Image();
    image.onload = () => {
      if (disposed) return;
      const scratch = document.createElement("canvas");
      scratch.width = job.width;
      scratch.height = job.height;
      const ctx = scratch.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, job.width, job.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i + 3] = pixels.data[i];
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const base = new window.Image();
      base.onload = () => {
        if (!disposed) {
          baseline.current = base;
          canvas.current?.getContext("2d")?.drawImage(base, 0, 0);
          setReady(true);
        }
      };
      base.src = scratch.toDataURL("image/png");
    };
    image.onerror = () => {
      if (!disposed) {
        setError("无法载入蒙版，请清空重新绘制。");
        setReady(true);
      }
    };
    image.src = value;
    return () => {
      disposed = true;
    };
  }, [stageElement, job.width, job.height, value]);
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * job.width,
      y: ((event.clientY - box.top) / box.height) * job.height,
    };
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    history.current.push([point(event)]);
    widths.current.push((job.width * brush) / 1000);
    undoFloor.current = Math.max(
      undoFloor.current,
      history.current.length - 10,
    );
    redraw();
    setCount(history.current.length);
  }
  function save() {
    const output = document.createElement("canvas");
    output.width = job.width;
    output.height = job.height;
    const ctx = output.getContext("2d");
    if (!ctx || !canvas.current) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, job.width, job.height);
    ctx.drawImage(canvas.current, 0, 0);
    onSave(output.toDataURL("image/png"));
  }
  return (
    <Modal
      open
      title="背景擦除校正"
      width={900}
      onCancel={onClose}
      onOk={save}
      okText="应用校正"
      cancelText="取消"
      okButtonProps={{ disabled: !ready }}
    >
      <p>
        涂抹多余环境或残留亮点，标记区域将变为纯黑，不参与雕刻。可撤销最近 10
        笔。
      </p>
      <Space wrap>
        <span>画笔大小</span>
        <Slider
          ariaLabelForHandle="画笔大小"
          style={{ width: 160 }}
          min={5}
          max={120}
          value={brush}
          onChange={setBrush}
        />
        <Button
          disabled={!ready || count <= undoFloor.current}
          onClick={() => {
            history.current.pop();
            widths.current.pop();
            redraw();
            setCount(history.current.length);
          }}
        >
          撤销
        </Button>
        <Button
          disabled={!ready}
          onClick={() => {
            history.current.push(null);
            widths.current.push(0);
            undoFloor.current = Math.max(
              undoFloor.current,
              history.current.length - 10,
            );
            setCount(history.current.length);
            redraw();
          }}
        >
          清空
        </Button>
      </Space>
      <div ref={setStageElement} className="engraving-mask-stage">
        <div style={displaySize}>
          <img src={sourceUrl} alt="待擦除生成图" />
          <canvas
            ref={canvas}
            width={job.width}
            height={job.height}
            aria-label="擦除画布"
            onPointerDown={start}
            onPointerMove={(event) => {
              if (drawing.current) {
                history.current.at(-1)?.push(point(event));
                redraw();
              }
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
        </div>
      </div>
      {error ? <Alert type="error" title={error} /> : null}
    </Modal>
  );
}
