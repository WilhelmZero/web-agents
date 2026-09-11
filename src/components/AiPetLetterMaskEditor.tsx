import { DeleteOutlined, EditOutlined, UndoOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Segmented, Slider, Space } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("蒙版编码失败")), "image/png"));
}

export default function AiPetLetterMaskEditor({ open, referenceUrl, mask, onCancel, onApply }: {
  open: boolean;
  referenceUrl?: string;
  mask?: Blob;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
}) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<"add" | "erase">("add");
  const [brush, setBrush] = useState(36);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [painting, setPainting] = useState(false);
  const paintingRef = useRef(false);

  const redraw = useCallback(async () => {
    const view = viewRef.current;
    const layer = maskRef.current;
    if (!view || !layer || !referenceUrl) return;
    const context = view.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.src = referenceUrl;
    await image.decode();
    context.clearRect(0, 0, view.width, view.height);
    context.drawImage(image, 0, 0, view.width, view.height);
    context.save();
    context.globalAlpha = 0.4;
    context.drawImage(layer, 0, 0);
    context.restore();
  }, [referenceUrl]);

  useEffect(() => {
    if (!open || !mask) return;
    const layer = document.createElement("canvas");
    layer.width = 960; layer.height = 540;
    maskRef.current = layer;
    const url = URL.createObjectURL(mask);
    const image = new Image();
    image.src = url;
    image.onload = () => {
      const context = layer.getContext("2d");
      context?.drawImage(image, 0, 0, layer.width, layer.height);
      setHistory([]);
      URL.revokeObjectURL(url);
      void redraw();
    };
    return () => URL.revokeObjectURL(url);
  }, [mask, open, redraw]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };
  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current || !maskRef.current) return;
    const { x, y } = point(event);
    const context = maskRef.current.getContext("2d");
    if (!context) return;
    context.save();
    context.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out";
    context.fillStyle = "white";
    context.beginPath(); context.arc(x, y, brush / 2, 0, Math.PI * 2); context.fill(); context.restore();
    void redraw();
  };
  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layer = maskRef.current;
    if (!layer) return;
    const data = layer.getContext("2d")?.getImageData(0, 0, layer.width, layer.height);
    if (data) setHistory((items) => [...items.slice(-9), data]);
    paintingRef.current = true; setPainting(true); event.currentTarget.setPointerCapture(event.pointerId);
    paint(event);
  };
  const undo = () => {
    const previous = history.at(-1); const layer = maskRef.current;
    if (!previous || !layer) return;
    layer.getContext("2d")?.putImageData(previous, 0, 0);
    setHistory((items) => items.slice(0, -1)); void redraw();
  };
  const clear = () => {
    const layer = maskRef.current; if (!layer) return;
    const context = layer.getContext("2d");
    const data = context?.getImageData(0, 0, layer.width, layer.height);
    if (data) setHistory((items) => [...items.slice(-9), data]);
    context?.clearRect(0, 0, layer.width, layer.height); void redraw();
  };

  return <Modal title="确认 AI 编辑范围" width={1040} open={open} onCancel={onCancel} destroyOnHidden footer={<Space><Button onClick={onCancel}>取消</Button><Button type="primary" onClick={async () => maskRef.current && onApply(await toBlob(maskRef.current))}>确认蒙版</Button></Space>}>
    <Alert type="info" showIcon message="白色半透明区域允许 AI 修改；区域外在返回后会强制恢复为参考图。确认后才可开始付费生成。" />
    <div className="ai-pet-mask-tools">
      <Segmented value={mode} onChange={(value) => setMode(value as "add" | "erase")} options={[{ label: "添加范围", value: "add", icon: <EditOutlined /> }, { label: "擦除范围", value: "erase", icon: <DeleteOutlined /> }]} />
      <span>画笔</span><Slider min={8} max={160} value={brush} onChange={setBrush} style={{ width: 180 }} />
      <Button icon={<UndoOutlined />} disabled={!history.length} onClick={undo}>撤销</Button>
      <Button onClick={clear}>清空</Button>
    </div>
    <canvas ref={viewRef} width={960} height={540} className="ai-pet-mask-canvas" data-painting={painting} onPointerDown={begin} onPointerMove={paint} onPointerUp={() => { paintingRef.current = false; setPainting(false); }} onPointerCancel={() => { paintingRef.current = false; setPainting(false); }} />
  </Modal>;
}
