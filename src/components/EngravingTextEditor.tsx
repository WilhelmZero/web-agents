import {
  DeleteOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  BoldOutlined,
  FontColorsOutlined,
  BorderOutlined,
  AlignCenterOutlined,
  UndoOutlined,
  DragOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Slider,
  Space,
  Upload,
} from "antd";
import type { StoredResult } from "../services/engraving/types";
import type {
  EngravingLayout,
  BrushStroke,
  TextBlock,
} from "../services/engraving/layout-types";
import { validateLayout } from "../services/engraving/layout-types";
import {
  FONT_CATALOG,
  ensureLayoutFont,
  importFont,
  localFonts,
} from "../services/engraving/layout-fonts";
import {
  resizeText,
  reorderTextLayers,
} from "../services/engraving/layout-edit";
import {
  drawLayout,
  fitLayoutTexts,
  drawBrushStrokes,
} from "../services/engraving/layout-draw";
import { useEngravingPreview } from "../services/engraving/preview";
import { cropPixels } from "../services/engraving/processing.mjs";
import "./EngravingTextEditor.css";
function FontExample({
  id,
  name,
  text,
}: {
  id: string;
  name: string;
  text: string;
}) {
  const [family, setFamily] = useState("");
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let alive = true;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void ensureLayoutFont(id)
          .then((f) => alive && setFamily(f))
          .catch(() => {});
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [id]);
  return (
    <span ref={ref}>
      <small>{name}</small>
      <br />
      <span translate={family ? "no" : undefined} style={{ fontFamily: family || "inherit", fontSize: 22 }}>
        {family ? (text || "Memory 2026").slice(0, 35) : "加载字体样例…"}
      </span>
    </span>
  );
}
export default function EngravingTextEditor({
  result,
  onApply,
  onClose,
}: {
  result: StoredResult;
  onApply: (layout: EngravingLayout | undefined) => void;
  onClose: () => void;
}) {
  const [layout, setLayoutRaw] = useState<EngravingLayout>(() => {
    const crop = cropPixels(
      result.job.width,
      result.job.height,
      result.params.crop,
    );
    return structuredClone(
      result.params.layout || {
        version: 1,
        width: crop.width,
        height: crop.height,
        image: { x: 0, y: 0, width: crop.width, height: crop.height },
        texts: [],
      },
    );
  });
  const latest = useRef(layout);
  const history = useRef<EngravingLayout[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const gesture = useRef({ active: false, recorded: false });
  const updateLayout = (
    update: (value: EngravingLayout) => EngravingLayout,
    record = true,
  ) => {
    const before = latest.current,
      next = update(before);
    if (next === before) return;
    if (record && (!gesture.current.active || !gesture.current.recorded)) {
      history.current = [...history.current.slice(-49), before];
      setUndoCount(history.current.length);
      if (gesture.current.active) gesture.current.recorded = true;
    }
    latest.current = next;
    setLayoutRaw(next);
  };
  const setLayout = (update: (value: EngravingLayout) => EngravingLayout) =>
    updateLayout(update);
  const [tool, setTool] = useState<"select" | "black" | "white" | "erase">(
    "select",
  );
  const [brushSize, setBrushSize] = useState(30);
  const [eraserSize, setEraserSize] = useState(30);
  const [draftStroke, setDraftStroke] = useState<BrushStroke | null>(null);
  const draftRef = useRef<BrushStroke | null>(null);
  const brushCanvas = useRef<HTMLCanvasElement>(null);
  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    gesture.current = { active: false, recorded: false };
    latest.current = previous;
    setLayoutRaw(previous);
    setUndoCount(history.current.length);
    setSelected((current) =>
      previous.texts.some((t) => t.id === current) ? current : "image",
    );
  };
  const [renderedLayout, setRenderedLayout] = useState<EngravingLayout | null>(
    null,
  );
  const [selected, setSelected] = useState("image"),
    [error, setError] = useState(""),
    [overflow, setOverflow] = useState<string[]>([]),
    [busy, setBusy] = useState(true),
    [panMode, setPanMode] = useState(false);
  const [zoom, setZoom] = useState(
      Math.min(1, 650 / layout.width, 500 / layout.height),
    ),
    [pan, setPan] = useState({ x: 20, y: 20 });
  const [extra, setExtra] = useState<
      { id: string; name: string; group: string }[]
    >([]),
    [category, setCategory] = useState("all");
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const initialBounds = useRef({ width: layout.width, height: layout.height });
  const attachViewport = useCallback((el: HTMLDivElement | null) => {
    viewport.current = el;
    setViewportNode(el);
    if (el && el.clientWidth && el.clientHeight) {
      const { width, height } = initialBounds.current;
      const z =
        Math.min(el.clientWidth / width, el.clientHeight / height) * 0.9;
      setZoom(z);
      setPan({
        x: (el.clientWidth - width * z) / 2,
        y: (el.clientHeight - height * z) / 2,
      });
    }
  }, []);
  useEffect(() => {
    const el = viewportNode;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      const z = Math.max(0.02, Math.min(8, zoom * Math.exp(-e.deltaY * 0.001)));
      setPan({
        x: x - ((x - pan.x) * z) / zoom,
        y: y - ((y - pan.y) * z) / zoom,
      });
      setZoom(z);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [viewportNode, zoom, pan]);
  const baseParams = useMemo(
    () => ({
      ...result.params,
      layout: undefined,
      mode: "grayscale" as const,
      preview: true,
    }),
    [result.params],
  );
  const preview = useEngravingPreview(result.job.blob, baseParams);
  const text = layout.texts.find((t) => t.id === selected);
  useEffect(() => {
    if (text && !text.autoSize)
      updateLayout(
        (l) => ({
          ...l,
          texts: l.texts.map((t) =>
            t.id === selected ? { ...t, autoSize: true } : t,
          ),
        }),
        false,
      );
  }, [selected, text?.autoSize]);
  useEffect(() => {
    void localFonts()
      .then(setExtra)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!preview.blob) return;
    let alive = true;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      void (async () => {
        const measure = document.createElement("canvas").getContext("2d")!;
        const fitted = await fitLayoutTexts(measure, layout);
        if (!alive) return;
        if (fitted !== layout) {
          updateLayout(
            (current) => (current === layout ? fitted : current),
            false,
          );
          return;
        }
        validateLayout(layout);
        const image = await createImageBitmap(preview.blob!);
        const ratio = Math.min(1, 1200 / Math.max(layout.width, layout.height));
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.round(layout.width * ratio));
        off.height = Math.max(1, Math.round(layout.height * ratio));
        const ctx = off.getContext("2d")!;
        ctx.scale(ratio, ratio);
        let over: string[];
        try {
          over = await drawLayout(ctx, layout, image, false);
        } finally {
          image.close();
        }
        if (alive && canvas.current) {
          canvas.current.width = off.width;
          canvas.current.height = off.height;
          canvas.current.getContext("2d")!.drawImage(off, 0, 0);
          setOverflow(over);
          setRenderedLayout(layout);
        }
      })()
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setBusy(false));
    }, 100);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [layout, preview.blob]);
  useEffect(() => {
    const target = brushCanvas.current;
    if (!target) return;
    const ratio = Math.min(1, 1200 / Math.max(layout.width, layout.height));
    target.width = Math.max(1, Math.round(layout.width * ratio));
    target.height = Math.max(1, Math.round(layout.height * ratio));
    const ctx = target.getContext("2d")!;
    ctx.scale(ratio, ratio);
    drawBrushStrokes(
      ctx,
      {
        ...layout,
        strokes: [
          ...(layout.strokes || []),
          ...(draftStroke ? [draftStroke] : []),
        ],
      },
      true,
    );
  }, [layout.width, layout.height, layout.strokes, draftStroke, viewportNode]);
  const pointAt = (e: React.PointerEvent) => {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: Math.max(
        -32768,
        Math.min(32768, (e.clientX - rect.left - pan.x) / zoom),
      ),
      y: Math.max(
        -32768,
        Math.min(32768, (e.clientY - rect.top - pan.y) / zoom),
      ),
    };
  };
  const finishGesture = (cancel = false) => {
    const stroke = draftRef.current;
    if (stroke && !cancel) {
      const next = {
        ...latest.current,
        strokes: [...(latest.current.strokes || []), stroke],
      };
      try {
        validateLayout(next);
        setLayout(() => next);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    draftRef.current = null;
    setDraftStroke(null);
    drag.current = null;
    gesture.current = { active: false, recorded: false };
  };
  const patch = (value: Partial<TextBlock>) =>
    setLayout((l) => ({
      ...l,
      texts: l.texts.map((t) =>
        t.id === selected ? { ...t, autoSize: true, ...value } : t,
      ),
    }));
  const num = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min = -32768,
    max = 32768,
    sliderMin = min,
    sliderMax = max,
  ) => (
    <div className="text-layout-number">
      <span>{label}</span>
      <div className="text-layout-number-controls">
        <Slider
          ariaLabelForHandle={label + "滑动条"}
          min={sliderMin}
          max={sliderMax}
          step={0.01}
          value={Math.max(sliderMin, Math.min(sliderMax, value))}
          onChange={onChange}
        />
        <InputNumber
          precision={2}
          aria-label={label}
          value={value}
          min={min}
          max={max}
          onChange={(v) => v !== null && Number.isFinite(v) && onChange(v)}
        />
      </div>
    </div>
  );
  const fit = () => {
    const w = viewport.current?.clientWidth || 700,
      h = viewport.current?.clientHeight || 520;
    const z = Math.min(w / layout.width, h / layout.height) * 0.9;
    setZoom(z);
    setPan({ x: (w - layout.width * z) / 2, y: (h - layout.height * z) / 2 });
  };
  const drag = useRef<{
    id: string;
    kind: string;
    x: number;
    y: number;
    layout: EngravingLayout;
    pan: { x: number; y: number };
  } | null>(null);
  const start = (e: React.PointerEvent, id: string, kind = "move") => {
    e.preventDefault();
    e.stopPropagation();
    if (draftRef.current || drag.current) return;
    gesture.current = { active: true, recorded: false };
    if (tool !== "select" && !panMode && e.button !== 1) {
      const point = pointAt(e);
      if (
        point.x < 0 ||
        point.y < 0 ||
        point.x > layout.width ||
        point.y > layout.height
      ) {
        gesture.current.active = false;
        return;
      }
      const stroke: BrushStroke = {
        mode: tool === "erase" ? "erase" : "paint",
        color: tool === "black" ? "#000000" : "#ffffff",
        size: tool === "erase" ? eraserSize : brushSize,
        points: [point],
      };
      draftRef.current = stroke;
      setDraftStroke(stroke);
      viewport.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (!panMode) setSelected(id);
    drag.current = {
      id,
      kind: panMode || e.button === 1 ? "pan" : kind,
      x: e.clientX,
      y: e.clientY,
      layout: structuredClone(layout),
      pan,
    };
    viewport.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (draftRef.current) {
      const stroke = draftRef.current,
        point = pointAt(e),
        last = stroke.points[stroke.points.length - 1];
      if (
        Math.hypot(point.x - last.x, point.y - last.y) < 0.5 ||
        stroke.points.length >= 100000
      )
        return;
      const next = { ...stroke, points: [...stroke.points, point] };
      draftRef.current = next;
      setDraftStroke(next);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / zoom,
      dy = (e.clientY - d.y) / zoom;
    if (d.kind === "pan") {
      setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
      return;
    }
    if (d.id === "image") {
      const b = d.layout.image;
      if (d.kind === "resize") {
        const width = Math.max(1, Math.min(32768, b.width + dx));
        setLayout((l) => ({
          ...l,
          image: { ...b, width, height: (b.height * width) / b.width },
        }));
      } else
        setLayout((l) => ({ ...l, image: { ...b, x: b.x + dx, y: b.y + dy } }));
    } else {
      const b = d.layout.texts.find((t) => t.id === d.id)!;
      setLayout((l) => ({
        ...l,
        texts: l.texts.map((t) =>
          t.id !== d.id
            ? t
            : d.kind === "resize"
              ? {
                  ...resizeText(
                    b,
                    1 +
                      (dx * b.width + dy * b.height) /
                        (b.width * b.width + b.height * b.height),
                  ),
                }
              : { ...b, x: b.x + dx, y: b.y + dy },
        ),
      }));
    }
  };
  const importOne = async (file: Blob, name: string) => {
    try {
      const f = await importFont(file, name);
      setExtra(await localFonts());
      if (text) patch({ font: f.id });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const readLocal = async () => {
    try {
      const api = window as unknown as {
        queryLocalFonts?: () => Promise<
          { family: string; fullName: string; blob: () => Promise<Blob> }[]
        >;
      };
      if (!api.queryLocalFonts) {
        setError("此浏览器不支持读取本机字体，请上传字体文件。");
        return;
      }
      const fonts = await api.queryLocalFonts();
      setLocalChoices(fonts);
    } catch {
      setError("未获准读取本机字体，可上传字体文件。");
    }
  };
  const [localChoices, setLocalChoices] = useState<
    { family: string; fullName: string; blob: () => Promise<Blob> }[]
  >([]);
  const fonts = [...FONT_CATALOG, ...extra].filter(
    (f) => category === "all" || f.group === category,
  );
  const layerDrag = useRef<string | null>(null);
  const [layerTarget, setLayerTarget] = useState<string | null>(null);
  const reorder = (source: string, target: string) =>
    setLayout((l) => ({
      ...l,
      texts: reorderTextLayers(l.texts, source, target),
    }));
  const targetLayer = (e: React.PointerEvent) =>
    document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-text-layer]")?.dataset.textLayer;
  const layers = (
    <div className="text-layout-layers" role="group" aria-label="图层列表">
      {[...layout.texts].reverse().map((t) => (
        <div
          key={t.id}
          data-text-layer={t.id}
          className={
            "text-layout-layer " +
            (selected === t.id ? "active " : "") +
            (layerTarget === t.id ? "drop-target" : "")
          }
        >
          <button
            type="button"
            className="text-layer-grip"
            aria-label={"拖动图层 " + (t.text || "空文字")}
            title="上下拖动排序，也可用方向键调整"
            onPointerDown={(e) => {
              e.preventDefault();
              layerDrag.current = t.id;
              setSelected(t.id);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (layerDrag.current) setLayerTarget(targetLayer(e) || null);
            }}
            onPointerUp={(e) => {
              const target = targetLayer(e);
              if (layerDrag.current && target)
                reorder(layerDrag.current, target);
              layerDrag.current = null;
              setLayerTarget(null);
            }}
            onPointerCancel={() => {
              layerDrag.current = null;
              setLayerTarget(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const index = layout.texts.findIndex((b) => b.id === t.id),
                target = layout.texts[index + (e.key === "ArrowUp" ? 1 : -1)];
              if (target) reorder(t.id, target.id);
            }}
          >
            ⠿
          </button>
          <button
            type="button"
            className="text-layer-select"
            aria-pressed={selected === t.id}
            onClick={() => {
              setTool("select");
              setPanMode(false);
              setSelected(t.id);
            }}
          >
            <span aria-hidden="true">T</span>
            <span translate={t.text ? "no" : undefined}>{t.text || "空文字"}</span>
          </button>
          <Button
            className="text-layer-delete"
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label={"删除文本图层 " + (t.text || "空文字")}
            title="删除文本图层"
            onClick={() => {
              setLayout((l) => ({
                ...l,
                texts: l.texts.filter((item) => item.id !== t.id),
              }));
              setSelected((current) => (current === t.id ? "image" : current));
            }}
          />
        </div>
      ))}
      <div
        className={
          "text-layout-layer " + (selected === "image" ? "active" : "")
        }
      >
        <button
          type="button"
          className="text-layer-select"
          aria-pressed={selected === "image"}
          onClick={() => {
            setTool("select");
            setPanMode(false);
            setSelected("image");
          }}
        >
          图片图层 <small>底层</small>
        </button>
      </div>
    </div>
  );
  const overlay = (
    id: string,
    b: { x: number; y: number; width: number; height: number },
  ) => (
    <div
      key={id}
      aria-label={id === "image" ? "图片位置" : "文字位置"}
      className={"text-layout-box " + (selected === id ? "selected" : "")}
      style={{
        left: b.x,
        top: b.y,
        width: b.width,
        height: b.height,
        borderWidth: 1 / zoom,
      }}
      onPointerDown={(e) => start(e, id)}
    >
      {selected === id && (
        <span
          aria-label={id === "image" ? "缩放图片" : "缩放文字"}
          className="text-layout-handle"
          style={{ width: 12 / zoom, height: 12 / zoom }}
          onPointerDown={(e) => start(e, id, "resize")}
        />
      )}
    </div>
  );
  return (
    <Modal
      open
      width={1400}
      title="添加文字与画布排版"
      onCancel={onClose}
      footer={
        <Space>
          <Button aria-label="取消" onClick={onClose}>
            取消
          </Button>
          <Button
            danger
            onClick={() => {
              onApply(undefined);
              onClose();
            }}
          >
            清除文字与排版
          </Button>
          <Button
            aria-label="应用"
            type="primary"
            disabled={
              busy ||
              renderedLayout !== layout ||
              !!error ||
              !!preview.error ||
              !preview.blob ||
              overflow.length > 0
            }
            onClick={() => {
              try {
                onApply(validateLayout(latest.current));
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            应用
          </Button>
        </Space>
      }
    >
      <div className="text-layout-editor">
        <div>
          <Space wrap>
            <Button
              aria-label="撤销"
              icon={<UndoOutlined />}
              disabled={!undoCount || !!draftStroke}
              onClick={undo}
            >
              撤销
            </Button>
            <Button onClick={fit}>适应窗口</Button>
            <Button
              onClick={() => {
                setZoom(1);
                setPan({ x: 20, y: 20 });
              }}
            >
              100%
            </Button>
            <Button
              type={panMode ? "primary" : "default"}
              onClick={() => {
                setTool("select");
                setPanMode((v) => !v);
              }}
            >
              拖动画布
            </Button>
            <span data-testid="layout-zoom">
              {Math.round(zoom * 100)}% · 尺寸单位：设计像素
            </span>
          </Space>
          <div className="text-layout-stage">
            <div
              className="text-layout-tools"
              role="toolbar"
              aria-label="画布工具"
            >
              <Button
                aria-label="选择与移动"
                title="选择与移动"
                icon={<DragOutlined />}
                type={tool === "select" && !panMode ? "primary" : "default"}
                onClick={() => {
                  setTool("select");
                  setPanMode(false);
                }}
              />
              <Button
                aria-label="添加文本图层"
                title="添加文本图层"
                icon={<FontSizeOutlined />}
                onClick={() => {
                  setTool("select");
                  setPanMode(false);
                  const id = crypto.randomUUID();
                  setLayout((l) => ({
                    ...l,
                    texts: [
                      ...l.texts,
                      {
                        id,
                        text: "Memory 2026",
                        x: l.width * 0.05,
                        y: l.height * 0.8,
                        width: l.width * 0.9,
                        height: l.height * 0.18,
                        autoSize: true,
                        bold: false,
                        font: "great-vibes",
                        fontSize: Math.max(12, l.width * 0.07),
                        color: "#ffffff",
                        align: "center",
                        lineHeight: 1.2,
                        letterSpacing: 0,
                        strokeWidth: 0,
                        strokeColor: "#000000",
                      },
                    ],
                  }));
                  setSelected(id);
                }}
                disabled={layout.texts.length >= 100}
              ></Button>
              {(["black", "white"] as const).map((value) => (
                <Button
                  key={value}
                  aria-label={value === "black" ? "黑色画笔" : "白色画笔"}
                  title={value === "black" ? "黑色画笔" : "白色画笔"}
                  icon={
                    <HighlightOutlined
                      style={{
                        color: value === "black" ? "#111" : "#fff",
                        filter:
                          value === "white"
                            ? "drop-shadow(0 0 1px #000)"
                            : undefined,
                      }}
                    />
                  }
                  type={tool === value ? "primary" : "default"}
                  aria-pressed={tool === value}
                  onClick={() => {
                    setTool(value);
                    setPanMode(false);
                  }}
                />
              ))}
              <Button
                aria-label="橡皮擦"
                title="橡皮擦（仅擦除画笔）"
                icon={<ClearOutlined />}
                aria-pressed={tool === "erase"}
                type={tool === "erase" ? "primary" : "default"}
                onClick={() => {
                  setTool("erase");
                  setPanMode(false);
                }}
              />
            </div>
            <div
              className={
                "text-layout-viewport " +
                (tool !== "select" ? "is-painting" : "")
              }
              ref={attachViewport}
              aria-label="排版画布"
              onPointerDown={(e) => start(e, "image", "pan")}
              onPointerMove={move}
              onPointerUp={() => finishGesture()}
              onPointerCancel={() => finishGesture(true)}
              onLostPointerCapture={() => finishGesture()}
            >
              <div
                style={{
                  position: "absolute",
                  left: pan.x,
                  top: pan.y,
                  width: layout.width,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "0 0",
                  background: "#000",
                }}
              >
                <canvas
                  ref={canvas}
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
                <canvas
                  ref={brushCanvas}
                  className="text-layout-paint"
                  aria-hidden="true"
                />
                {overlay("image", layout.image)}
                {layout.texts.map((t) => overlay(t.id, t))}
              </div>
            </div>
          </div>
          <div className="text-layout-bottom" aria-label="画布下方设置">
            {tool === "erase"
              ? num("橡皮擦大小", eraserSize, setEraserSize, 1, 1000, 1, 300)
              : tool !== "select" &&
                num("画笔大小", brushSize, setBrushSize, 1, 1000, 1, 300)}
            {text && (
              <div className="text-layout-text-row">
                <Input.TextArea
                  aria-label="文字内容"
                  value={text.text}
                  maxLength={5000}
                  rows={1}
                  className="text-layout-content-input"
                  onChange={(e) => patch({ text: e.target.value })}
                />

                <Space
                  className="text-layout-text-tools"
                  role="toolbar"
                  aria-label="文字工具"
                >
                  <label className="text-layout-color" title="文字颜色">
                    <FontColorsOutlined />
                    <span style={{ background: text.color }} />
                    <input
                      type="color"
                      aria-label="文字颜色"
                      value={text.color}
                      onChange={(e) => patch({ color: e.target.value })}
                    />
                  </label>
                  <label className="text-layout-color" title="描边颜色">
                    <BorderOutlined />
                    <span style={{ background: text.strokeColor }} />
                    <input
                      type="color"
                      aria-label="描边颜色"
                      value={text.strokeColor}
                      onChange={(e) => patch({ strokeColor: e.target.value })}
                    />
                  </label>
                  <Button
                    icon={<BoldOutlined />}
                    aria-label="文字加粗"
                    title="文字加粗"
                    aria-pressed={!!text.bold}
                    type={text.bold ? "primary" : "default"}
                    onClick={() => patch({ bold: !text.bold })}
                  />
                  <Button
                    icon={<AlignCenterOutlined />}
                    aria-label="文字水平居中"
                    title="文字水平居中"
                    disabled={busy || renderedLayout !== layout}
                    onClick={() =>
                      patch({ x: (layout.width - text.width) / 2 })
                    }
                  />
                </Space>
              </div>
            )}
          </div>
          {(error || preview.error) && (
            <Alert type="error" title={error || preview.error} />
          )}{" "}
          {!!overflow.length && (
            <Alert
              type="warning"
              title="文字超出文本框，请扩大文本框或减小字号后应用。"
            />
          )}
        </div>
        <div className="text-layout-settings">
          <h4>画布</h4>
          <div className="text-layout-grid">
            {num(
              "画布宽度",
              layout.width,
              (v) => setLayout((l) => ({ ...l, width: v })),
              1,
              Number.POSITIVE_INFINITY,
              100,
              4096,
            )}
            {num(
              "画布高度",
              layout.height,
              (v) => setLayout((l) => ({ ...l, height: v })),
              1,
              Number.POSITIVE_INFINITY,
              100,
              4096,
            )}
          </div>
          <h4>图层</h4>

          <small>从上到下为从前到后；拖动文字图层左侧手柄排序。</small>
          {layers}
          {selected === "image" && (
            <>
              <h4>图片参数</h4>
              <div className="text-layout-grid">
                {num("图片 X", layout.image.x, (x) =>
                  setLayout((l) => ({ ...l, image: { ...l.image, x } })),
                )}
                {num("图片 Y", layout.image.y, (y) =>
                  setLayout((l) => ({ ...l, image: { ...l.image, y } })),
                )}
                {num(
                  "图片宽度",
                  layout.image.width,
                  (width) =>
                    setLayout((l) => ({
                      ...l,
                      image: {
                        ...l.image,
                        width,
                        height: (l.image.height * width) / l.image.width,
                      },
                    })),
                  1,
                )}
              </div>
              <Button
                onClick={() =>
                  setLayout((l) => ({
                    ...l,
                    image: { ...l.image, x: (l.width - l.image.width) / 2 },
                  }))
                }
              >
                图片水平居中
              </Button>
            </>
          )}
          {text && <h4>文字参数</h4>}
          <Space wrap style={{ display: "none" }}>
            {text && (
              <>
                <Button
                  hidden
                  aria-label="复制"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setLayout((l) => ({
                      ...l,
                      texts: [
                        ...l.texts,
                        { ...text, id, x: text.x + 20, y: text.y + 20 },
                      ],
                    }));
                    setSelected(id);
                  }}
                  disabled={layout.texts.length >= 100}
                >
                  复制
                </Button>
              </>
            )}
          </Space>
          {text && (
            <>
              <div className="text-layout-grid">
                {num(
                  "文字 X",
                  text.x,
                  (x) => patch({ x }),
                  -32768,
                  32768,
                  -layout.width,
                  layout.width,
                )}
                {num(
                  "文字 Y",
                  text.y,
                  (y) => patch({ y }),
                  -32768,
                  32768,
                  -layout.height,
                  layout.height,
                )}
                {num(
                  "文字宽度",
                  text.width,
                  (width) => patch(resizeText(text, width / text.width)),
                  1,
                  32768,
                  1,
                  2000,
                )}
                {num(
                  "文字高度",
                  text.height,
                  (height) => patch(resizeText(text, height / text.height)),
                  1,
                )}
                {num(
                  "字号",
                  text.fontSize,
                  (fontSize) => patch({ fontSize }),
                  1,
                  4096,
                  1,
                  300,
                )}
                {num(
                  "行距倍数",
                  text.lineHeight,
                  (lineHeight) => patch({ lineHeight }),
                  0.5,
                  5,
                )}
                {num(
                  "字距",
                  text.letterSpacing,
                  (letterSpacing) => patch({ letterSpacing }),
                  -200,
                  200,
                  -20,
                  50,
                )}
                {num(
                  "描边宽度",
                  text.strokeWidth,
                  (strokeWidth) => patch({ strokeWidth }),
                  0,
                  500,
                  0,
                  50,
                )}
              </div>
              <h4>字体</h4>
              <Select
                aria-label="字体分类"
                value={category}
                onChange={setCategory}
                options={[
                  { value: "all", label: "全部字体" },
                  { value: "Handwriting", label: "手写" },
                  { value: "Serif", label: "衬线" },
                  { value: "Sans", label: "无衬线" },
                  { value: "Display", label: "标题" },
                  { value: "Mono", label: "等宽" },
                  { value: "Local", label: "本机导入" },
                ]}
              />
              <Select
                aria-label="字体"
                showSearch
                optionFilterProp="search"
                value={text.font}
                style={{ width: "100%" }}
                onChange={(font) => patch({ font })}
                options={fonts.map((f) => ({
                  value: f.id,
                  search: f.name,
                  label: (
                    <FontExample id={f.id} name={f.name} text={text.text} />
                  ),
                }))}
                listHeight={320}
              />
            </>
          )}
          <Space wrap>
            <Button onClick={() => void readLocal()}>读取本机字体</Button>
            <Upload
              accept=".ttf,.otf,.woff,.woff2"
              showUploadList={false}
              beforeUpload={(file) => {
                void importOne(file, file.name);
                return false;
              }}
            >
              <Button>上传字体</Button>
            </Upload>
          </Space>
          {localChoices.length > 0 && (
            <Select
              aria-label="本机字体"
              showSearch
              optionFilterProp="label"
              placeholder="选择需要缓存的本机字体"
              style={{ width: "100%" }}
              options={localChoices.map((f, i) => ({
                value: i,
                label: f.fullName,
              }))}
              onChange={(i) =>
                void localChoices[i]
                  .blob()
                  .then((blob) => importOne(blob, localChoices[i].fullName))
                  .catch((e) => setError(e.message))
              }
            />
          )}
          <small>
            内置字体可免费商用；本机字体请确认使用许可。字体仅保存在本机。
          </small>
        </div>
      </div>
    </Modal>
  );
}
