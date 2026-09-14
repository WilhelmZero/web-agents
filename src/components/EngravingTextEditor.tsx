import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Upload,
} from "antd";
import type { StoredResult } from "../services/engraving/types";
import type {
  EngravingLayout,
  TextBlock,
} from "../services/engraving/layout-types";
import { validateLayout } from "../services/engraving/layout-types";
import {
  FONT_CATALOG,
  ensureLayoutFont,
  importFont,
  localFonts,
} from "../services/engraving/layout-fonts";
import { drawLayout } from "../services/engraving/layout-draw";
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
      <span style={{ fontFamily: family || "inherit", fontSize: 22 }}>
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
  const [layout, setLayout] = useState<EngravingLayout>(() => {
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
  useEffect(() => {
    const el = viewport.current;
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
  }, [zoom, pan]);
  const latest = useRef(layout);
  latest.current = layout;
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
          over = await drawLayout(ctx, layout, image);
        } finally {
          image.close();
        }
        if (alive && canvas.current) {
          canvas.current.width = off.width;
          canvas.current.height = off.height;
          canvas.current.getContext("2d")!.drawImage(off, 0, 0);
          setOverflow(over);
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
  const patch = (value: Partial<TextBlock>) =>
    setLayout((l) => ({
      ...l,
      texts: l.texts.map((t) => (t.id === selected ? { ...t, ...value } : t)),
    }));
  const num = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min = -32768,
    max = 32768,
  ) => (
    <label>
      {label}
      <InputNumber
        precision={2}
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(v) => v !== null && onChange(v)}
      />
    </label>
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
                  ...b,
                  width: Math.max(1, b.width + dx),
                  height: Math.max(1, b.height + dy),
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
              onClick={() => setPanMode((v) => !v)}
            >
              拖动画布
            </Button>
            <span>{Math.round(zoom * 100)}% · 尺寸单位：设计像素</span>
          </Space>
          <div
            className="text-layout-viewport"
            ref={viewport}
            onPointerDown={(e) => start(e, "image", "pan")}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
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
              {overlay("image", layout.image)}
              {layout.texts.map((t) => overlay(t.id, t))}
            </div>
          </div>
          <p role="status">
            {busy || preview.computing ? "正在更新排版…" : "排版预览已更新"} ·
            编辑保留彩色，雕刻输出转换为灰度或黑白点阵。
          </p>
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
              8192,
            )}
            {num(
              "画布高度",
              layout.height,
              (v) => setLayout((l) => ({ ...l, height: v })),
              1,
              8192,
            )}
          </div>
          <h4>图片</h4>
          <Button onClick={() => setSelected("image")}>选择图片</Button>
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
          <h4>文字块</h4>
          <Space wrap>
            <Button
              onClick={() => {
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
            >
              添加文字块
            </Button>
            {text && (
              <>
                <Button
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
                <Button
                  danger
                  onClick={() => {
                    setLayout((l) => ({
                      ...l,
                      texts: l.texts.filter((t) => t.id !== selected),
                    }));
                    setSelected("image");
                  }}
                >
                  删除文字
                </Button>
              </>
            )}
          </Space>
          <Select
            aria-label="选择文字块"
            value={text?.id}
            placeholder="选择文字块"
            style={{ width: "100%", marginTop: 8 }}
            options={layout.texts.map((t, i) => ({
              value: t.id,
              label: `${i + 1}. ${t.text || "空文字"}`,
            }))}
            onChange={setSelected}
          />
          {text && (
            <>
              <Input.TextArea
                aria-label="文字内容"
                value={text.text}
                maxLength={5000}
                rows={3}
                onChange={(e) => patch({ text: e.target.value })}
              />
              <div className="text-layout-grid">
                {num("文字 X", text.x, (x) => patch({ x }))}
                {num("文字 Y", text.y, (y) => patch({ y }))}
                {num("文本框宽度", text.width, (width) => patch({ width }), 1)}
                {num(
                  "文本框高度",
                  text.height,
                  (height) => patch({ height }),
                  1,
                )}
                {num(
                  "字号",
                  text.fontSize,
                  (fontSize) => patch({ fontSize }),
                  1,
                  4096,
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
                )}
                {num(
                  "描边宽度",
                  text.strokeWidth,
                  (strokeWidth) => patch({ strokeWidth }),
                  0,
                  500,
                )}
                <label>
                  文字颜色
                  <input
                    aria-label="文字颜色"
                    type="color"
                    value={text.color}
                    onChange={(e) => patch({ color: e.target.value })}
                  />
                </label>
                <label>
                  描边颜色
                  <input
                    aria-label="描边颜色"
                    type="color"
                    value={text.strokeColor}
                    onChange={(e) => patch({ strokeColor: e.target.value })}
                  />
                </label>
              </div>
              <Select
                aria-label="内部对齐"
                value={text.align}
                options={[
                  { value: "left", label: "左对齐" },
                  { value: "center", label: "居中对齐" },
                  { value: "right", label: "右对齐" },
                ]}
                onChange={(align) => patch({ align })}
              />
              <Button
                onClick={() => patch({ x: (layout.width - text.width) / 2 })}
              >
                文字水平居中
              </Button>
              <Space>
                <Button
                  onClick={() =>
                    setLayout((l) => ({
                      ...l,
                      texts: [
                        ...l.texts.filter((t) => t.id !== selected),
                        text,
                      ],
                    }))
                  }
                >
                  移到最前
                </Button>
                <Button
                  onClick={() =>
                    setLayout((l) => ({
                      ...l,
                      texts: [
                        text,
                        ...l.texts.filter((t) => t.id !== selected),
                      ],
                    }))
                  }
                >
                  移到最后
                </Button>
              </Space>
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
