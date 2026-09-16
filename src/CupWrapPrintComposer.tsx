import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Upload,
} from "antd";
import {
  DEFAULT_CUP,
  geometry,
  pathData,
  dielineSvg,
  type CupParams,
} from "./services/cupWrap/geometry";
import {
  DEFAULT_PRINT,
  type PrintSettings,
  type WrapDesign,
} from "./services/cupWrap/types";
import { work } from "./services/cupWrap/client";
import { loadDesigns, saveDesigns } from "./services/cupWrap/storage";
import {
  placementError,
  type PrintLayout,
  type Placement,
} from "./services/cupWrap/packing";
import { exportPdf, calibrationPdf, tiledPdf } from "./services/cupWrap/pdf";
import "./cup-wrap-print.css";
import CupWrapArtworkEditor from "./CupWrapArtworkEditor";
import { adaptArtwork } from "./services/cupWrap/ai";
import type { AppSettings } from "./types";
import { arrangeLayers } from "./services/cupWrap/artwork";
import { inside } from "./services/cupWrap/geometry";
import { containFit } from "./services/cupWrap/fitting";
function BlobPreview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <Image width={140} src={url} />;
}
const layoutPreviews = new WeakMap<WrapDesign, Map<boolean, Promise<Blob>>>();
let layoutPreviewQueue: Promise<unknown> = Promise.resolve();
function cachedLayoutPreview(design: WrapDesign, bleed: boolean) {
  let map = layoutPreviews.get(design);
  if (!map) {
    map = new Map();
    layoutPreviews.set(design, map);
  }
  let task = map.get(bleed);
  if (!task) {
    task = layoutPreviewQueue
      .catch(() => {})
      .then(() =>
        work<Blob>({ kind: "png", design, dpi: 72, bleed, preview: true }),
      );
    map.set(bleed, task);
    layoutPreviewQueue = task;
  }
  return task;
}
function LayoutArtwork({
  design,
  bleed,
}: {
  design: WrapDesign;
  bleed: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let u = "";
    cachedLayoutPreview(design, bleed)
      .then((b) => {
        if (cancelled) return;
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [design, bleed]);
  const g = geometry(design.cup),
    b = bleed ? design.cup.bleed : 0;
  return (
    <image
      href={url || undefined}
      x={-b}
      y={-b}
      width={g.width + 2 * b}
      height={g.height + 2 * b}
    />
  );
}
const fresh = (): WrapDesign => ({
  id: crypto.randomUUID(),
  name: "杯身设计",
  cup: { ...DEFAULT_CUP },
  aiResults: [],
  fit: "contain",
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  layers: [],
  quantity: 1,
  prompt:
    "第一张是原始图案，第二张是目标展开轮廓引导图。输出画布构图对应第二张图，不要把红色轮廓线或其他辅助标记画进结果。保持文字内容和角色身份，不拉伸文字与角色。根据目标展开范围调整完整角色的位置、等比大小和间距，在空白区域补充风格一致的小装饰，保持脸部、眼睛和肢体完整。",
});
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export default function CupWrapPrintComposer({
  active,
  settingsHost,
  settings,
}: {
  active: boolean;
  settingsHost: HTMLElement | null;
  settings: AppSettings;
}) {
  const [editor, setEditor] = useState(false),
    [model, setModel] = useState(
      () => localStorage.getItem("cup-wrap-print:model:v1") || "gpt-image-2",
    );
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  }>();
  useEffect(() => {
    try {
      localStorage.setItem("cup-wrap-print:model:v1", model);
    } catch {}
  }, [model]);
  const [tileOpen, setTileOpen] = useState(false),
    [overlap, setOverlap] = useState(5),
    [tileMarks, setTileMarks] = useState(true);
  const [moving, setMoving] = useState<{
    page: number;
    index: number;
    value: Placement;
  }>();
  const [designs, setDesigns] = useState<WrapDesign[]>(() => [fresh()]),
    [selected, setSelected] = useState(""),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(""),
    [layout, setLayout] = useState<PrintLayout>(),
    [tab, setTab] = useState("design"),
    [guide, setGuide] = useState(true);
  const [print, setPrint] = useState<PrintSettings>(() => {
    try {
      return {
        ...DEFAULT_PRINT,
        ...JSON.parse(
          localStorage.getItem("cup-wrap-print:settings:v1") || "{}",
        ),
      };
    } catch {
      return DEFAULT_PRINT;
    }
  });
  const abort = useRef<AbortController | null>(null),
    saveChain = useRef(Promise.resolve());
  const d = designs.find((v) => v.id === selected) || designs[0];
  useEffect(() => {
    let cancelled = false;
    const blob = d.adopted || d.source;
    if (!blob) {
      setSourceSize(undefined);
      return;
    }
    createImageBitmap(blob)
      .then((img) => {
        if (!cancelled) setSourceSize({ width: img.width, height: img.height });
        img.close();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [d.source, d.adopted]);
  const geo = useMemo(() => {
    try {
      return { g: geometry(d.cup), error: "" };
    } catch (e) {
      return { g: null, error: String(e) };
    }
  }, [d.cup]);
  useEffect(() => {
    loadDesigns()
      .then((v) => {
        if (v.length) setDesigns(v);
      })
      .catch((e) => setError(`恢复失败：${e}`))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(() => saveDesigns(designs))
        .catch((e) => setError(`保存失败：${e}`));
    }, 350);
    return () => clearTimeout(timer);
  }, [designs, ready]);
  useEffect(() => {
    try {
      localStorage.setItem("cup-wrap-print:settings:v1", JSON.stringify(print));
    } catch (e) {
      setError(`设置保存失败：${e}`);
    }
  }, [print]);
  useEffect(() => {
    if (!active || !geo.g) return;
    const controller = new AbortController();
    let url = "";
    const timer = setTimeout(() => {
      work<Blob>(
        { kind: "png", design: d, dpi: print.dpi, preview: true },
        controller.signal,
      )
        .then((blob) => {
          url = URL.createObjectURL(blob);
          setPreview(url);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [d, active, geo.g, print.dpi]);
  const update = (patch: Partial<WrapDesign>) => {
    setDesigns((all) =>
      all.map((v) => (v.id === d.id ? { ...v, ...patch } : v)),
    );
    setLayout(undefined);
  };
  const setting = (patch: Partial<PrintSettings>) => {
    setPrint((v) => ({ ...v, ...patch }));
    setLayout(undefined);
  };
  async function generate(signal: AbortSignal) {
    if (!d.source) return;
    const snapshot = structuredClone(d),
      g = geometry(snapshot.cup);
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = Math.max(1, Math.round((1600 * g.height) / g.width));
    if (c.height > 8000) throw new Error("展开比例过于狭长，暂不支持 AI 适配");
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(c.width / g.width, c.height / g.height);
    ctx.fillStyle = "#e6f4ff";
    ctx.fill(new Path2D(pathData(g.points)));
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 0.3;
    ctx.stroke(new Path2D(pathData(g.points)));
    const guide = await new Promise<Blob>((resolve) =>
      c.toBlob((v) => resolve(v!), "image/png"),
    );
    const raw = await adaptArtwork(
      settings,
      model,
      snapshot.source!,
      guide,
      snapshot.prompt,
      signal,
    );
    setDesigns((all) =>
      all.map((v) =>
        v.id === snapshot.id ? { ...v, aiResults: [...v.aiResults, raw] } : v,
      ),
    );
  }
  async function run(label: string, fn: (s: AbortSignal) => Promise<void>) {
    if (abort.current) return;
    const c = new AbortController();
    abort.current = c;
    setBusy(label);
    setError("");
    try {
      await fn(c.signal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setBusy("");
    }
  }
  async function upload(file: File) {
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 40 * 1024 * 1024
      )
        throw new Error("请上传 40MB 以内的 PNG、JPEG 或 WebP");
      const image = await createImageBitmap(file);
      if (image.width * image.height > 60_000_000) {
        image.close();
        throw new Error("原图超过 6000 万像素");
      }
      image.close();
      update({
        source: file,
        originalSource: file,
        adopted: undefined,
        layers: [],
        aiResults: [],
        name: file.name.replace(/\.[^.]+$/, ""),
      });
    } catch (e) {
      setError(String(e));
    }
    return false;
  }
  const number = (
    label: string,
    value: number,
    change: (v: number) => void,
    min = 0,
    max = 1000,
  ) => (
    <label className="cup-field">
      {label}
      <InputNumber
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(v) => {
          if (v !== null) change(v);
        }}
      />
    </label>
  );
  const panel = (
    <div className="cup-settings">
      <h3>杯身尺寸 · mm</h3>
      {(
        [
          "top",
          "bottom",
          "height",
          "topInset",
          "bottomInset",
        ] as (keyof CupParams)[]
      ).map((k, i) => (
        <div key={k}>
          {number(
            ["口径", "底径", "垂直高度", "距杯口留白", "距杯底留白"][i],
            d.cup[k],
            (v) => update({ cup: { ...d.cup, [k]: v } }),
            i < 3 ? 0.1 : 0,
          )}
        </div>
      ))}
      {number(
        "覆盖角度 °",
        d.cup.coverage,
        (v) => update({ cup: { ...d.cup, coverage: v } }),
        1,
        360,
      )}
      {number(
        "接缝 mm（负数留缝／正数搭接）",
        d.cup.seam,
        (v) => update({ cup: { ...d.cup, seam: v } }),
        -20,
        20,
      )}
      {number(
        "出血",
        d.cup.bleed,
        (v) => update({ cup: { ...d.cup, bleed: v } }),
        0,
        10,
      )}
      {number(
        "安全线",
        d.cup.safe,
        (v) => update({ cup: { ...d.cup, safe: v } }),
        0,
        10,
      )}
      <h3>图案 · 不拉伸</h3>
      <Select
        aria-label="图案适配"
        value={d.fit}
        onChange={(fit) => update({ fit })}
        options={[
          { value: "contain", label: "完整放入（允许留白）" },
          { value: "cover", label: "等比铺满（裁切越界）" },
          { value: "tile", label: "等比平铺" },
        ]}
      />
      {number("等比缩放", d.scale, (v) => update({ scale: v }), 0.05, 10)}
      {number("水平移动 mm", d.x, (v) => update({ x: v }), -1000)}
      {number("垂直移动 mm", d.y, (v) => update({ y: v }), -1000)}
      {number("旋转 °", d.rotation, (v) => update({ rotation: v }), -180, 180)}
      <h3>独立素材／保护图层</h3>
      <Button
        disabled={!d.layers.length || !!busy}
        onClick={() =>
          run("正在重排素材", async () => {
            const result = await arrangeLayers(d);
            update({ layers: result.layers });
            if (result.unplaced)
              setError(
                `${result.unplaced} 个素材未找到完整放置位置，保留原位置，请手动调整。`,
              );
          })
        }
      >
        自动排列已确认素材
      </Button>
      <Button disabled={!d.source} onClick={() => setEditor(true)}>
        提取素材／修正背景
      </Button>
      {d.originalSource && (
        <Button
          onClick={() =>
            update({ source: d.originalSource, adopted: undefined, layers: [] })
          }
        >
          恢复原始上传图
        </Button>
      )}
      {d.layers.map((layer, i) => (
        <div key={layer.id}>
          <strong>
            图层 {i + 1}
            {layer.locked ? " · 已保护" : ""}
          </strong>
          {number(
            "X mm",
            layer.x,
            (x) =>
              update({
                layers: d.layers.map((v) =>
                  v.id === layer.id ? { ...v, x } : v,
                ),
              }),
            -1000,
          )}
          {number(
            "Y mm",
            layer.y,
            (y) =>
              update({
                layers: d.layers.map((v) =>
                  v.id === layer.id ? { ...v, y } : v,
                ),
              }),
            -1000,
          )}
          {number(
            "宽度 mm",
            layer.width,
            (width) =>
              update({
                layers: d.layers.map((v) =>
                  v.id === layer.id ? { ...v, width } : v,
                ),
              }),
            0.1,
          )}
          {number(
            "角度 °",
            layer.rotation,
            (rotation) =>
              update({
                layers: d.layers.map((v) =>
                  v.id === layer.id ? { ...v, rotation } : v,
                ),
              }),
            -180,
            180,
          )}
          <Button
            danger
            size="small"
            onClick={() =>
              update({ layers: d.layers.filter((v) => v.id !== layer.id) })
            }
          >
            删除图层
          </Button>
        </div>
      ))}
      <h3>AI 适配（可选）</h3>
      <Select
        value={model}
        onChange={setModel}
        options={[
          "gpt-image-2",
          "gpt-image-2.5-sunburst",
          "gemini-3-pro-image",
          "gemini-3.1-flash-image",
        ].map((value) => ({ value, label: value }))}
      />
      <Input.TextArea
        aria-label="AI 适配提示词"
        rows={5}
        value={d.prompt}
        onChange={(e) => update({ prompt: e.target.value })}
      />
      <p>
        输入顺序：原图、目标轮廓引导图。返回后请检查文字和身体结构再采用；受保护图层会叠加在结果上。
      </p>
      <Button
        disabled={!d.source || !!busy || !d.prompt.trim()}
        onClick={() =>
          Modal.confirm({
            title: "将发起 1 次付费图片请求",
            content: "仅调整图案，不以 AI 输出尺寸作为打印尺寸。不自动重试。",
            onOk: () => run("AI 正在适配图案", generate),
          })
        }
      >
        AI 生成候选图
      </Button>
      <h3>输出与 A4</h3>
      {number("DPI", print.dpi, (v) => setting({ dpi: v }), 72, 2400)}
      <Space wrap>
        <Button
          disabled={!d.source || !!busy}
          onClick={() => setTileOpen(true)}
        >
          1:1 多页拼接
        </Button>
        {[300, 600, 800, 1200].map((dpi) => (
          <Button key={dpi} size="small" onClick={() => setting({ dpi })}>
            {dpi}
          </Button>
        ))}
      </Space>
      <Checkbox
        checked={print.bleed}
        onChange={(e) => setting({ bleed: e.target.checked })}
      >
        彩图包含出血
      </Checkbox>
      {number(
        "A4 打印边距 mm",
        print.margin,
        (v) => setting({ margin: v }),
        0,
        30,
      )}
      {number("图案间距 mm", print.gap, (v) => setting({ gap: v }), 0, 20)}
      <Checkbox
        checked={print.landscape}
        onChange={(e) => setting({ landscape: e.target.checked })}
      >
        横向 A4
      </Checkbox>
      <Checkbox
        checked={print.rotate}
        onChange={(e) => setting({ rotate: e.target.checked })}
      >
        允许旋转
      </Checkbox>
      <Select
        aria-label="排版模式"
        value={print.mode}
        onChange={(mode) => setting({ mode })}
        options={[
          { value: "quantity", label: "按数量自动分页" },
          { value: "fill", label: "单页尽量填满" },
        ]}
      />
      <p>
        RGB 透明
        TIF；白墨由打印软件处理。打印选择实际大小／100%，不要适合页面。先用纸样试贴。
      </p>
    </div>
  );
  const g = geo.g;
  const contained = useMemo(
    () =>
      g && sourceSize
        ? containFit(g, sourceSize.width, sourceSize.height)
        : null,
    [g, sourceSize],
  );
  const sourceFactor =
    g && sourceSize
      ? (d.fit === "contain"
          ? contained!.scale
          : (d.fit === "cover" ? Math.max : Math.min)(
              g.width / sourceSize.width,
              g.height / sourceSize.height,
            )) * d.scale
      : 0;
  const sourceOverflow = !!(
    g &&
    sourceSize &&
    d.fit !== "tile" &&
    [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ].some(([sx, sy]) => {
      const x = (sx * sourceSize.width * sourceFactor) / 2,
        y = (sy * sourceSize.height * sourceFactor) / 2,
        t = (d.rotation * Math.PI) / 180;
      return !inside(
        {
          x:
            (d.fit === "contain" ? contained!.cx : g.width / 2) +
            d.x +
            x * Math.cos(t) -
            y * Math.sin(t),
          y:
            (d.fit === "contain" ? contained!.cy : g.height / 2) +
            d.y +
            x * Math.sin(t) +
            y * Math.cos(t),
        },
        g.points,
      );
    })
  );
  return (
    <div className="cup-workbench">
      <header>
        <h2>杯身刀模与打印排版</h2>
        <p>毫米级展开 · 图案不拉伸 · 1:1 输出</p>
      </header>
      <Alert
        type="info"
        showIcon
        title="仅适用于直壁圆柱／圆台杯；输入外表面尺寸。鼓肚、收腰和实物公差需要另行测量。"
      />
      {(error || geo.error) && (
        <Alert
          closable
          onClose={() => setError("")}
          type="error"
          title={error || geo.error}
        />
      )}
      <Space wrap>
        <Upload
          showUploadList={false}
          beforeUpload={upload}
          accept="image/png,image/jpeg,image/webp"
        >
          <Button disabled={!ready}>上传图案</Button>
        </Upload>
        <Button
          onClick={() => {
            const v = fresh();
            setDesigns((a) => [...a, v]);
            setSelected(v.id);
            setLayout(undefined);
          }}
        >
          新增设计
        </Button>
        <Button
          disabled={!g || !!busy}
          onClick={() =>
            g &&
            download(
              new Blob([dielineSvg(g)], { type: "image/svg+xml" }),
              "dieline.svg",
            )
          }
        >
          SVG 刀模
        </Button>
        <Button
          disabled={!g || !!busy}
          onClick={() =>
            run("正在导出 TIF", async (signal) => {
              const bytes = await work<ArrayBuffer>(
                {
                  kind: "tiff",
                  design: structuredClone(d),
                  dpi: print.dpi,
                  bleed: print.bleed,
                },
                signal,
              );
              download(
                new Blob([bytes], { type: "image/tiff" }),
                `${d.name}.tif`,
              );
            })
          }
        >
          1:1 TIF
        </Button>
        <Button
          disabled={!g || !!busy}
          onClick={() =>
            run("正在导出 PDF", async (signal) =>
              download(
                await exportPdf(
                  [structuredClone(d)],
                  { ...print },
                  undefined,
                  signal,
                ),
                `${d.name}.pdf`,
              ),
            )
          }
        >
          1:1 PDF
        </Button>
        <Button
          disabled={!!busy || designs.every((v) => !v.source)}
          onClick={() =>
            run("正在搜索 A4 排版", async (signal) => {
              const result = await work<PrintLayout>(
                {
                  kind: "pack",
                  designs: designs.filter((v) => v.source),
                  settings: print,
                },
                signal,
              );
              setLayout(result);
              setTab("a4");
            })
          }
        >
          计算 A4 混排
        </Button>
        <Button
          disabled={!layout || !!busy}
          onClick={() =>
            run("正在导出 A4", async (signal) =>
              download(
                await exportPdf(
                  structuredClone(designs),
                  { ...print },
                  layout,
                  signal,
                ),
                "A4-print.pdf",
              ),
            )
          }
        >
          下载 A4 PDF
        </Button>
        <Button
          onClick={() =>
            run("校准页", async () =>
              download(await calibrationPdf(), "calibration-100mm.pdf"),
            )
          }
        >
          校准页
        </Button>
        {busy && (
          <>
            <Spin size="small" />
            {busy}
            <Button onClick={() => abort.current?.abort()}>停止</Button>
          </>
        )}
      </Space>
      <div className="cup-body">
        <main>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "design", label: "展开预览" },
              {
                key: "a4",
                label: `A4 排版${layout ? ` · ${layout.pages.length} 页` : ""}`,
              },
            ]}
          />
          {tab === "design" && g && (
            <>
              <Space wrap>
                <Checkbox
                  checked={guide}
                  onChange={(e) => setGuide(e.target.checked)}
                >
                  辅助线（不进入彩图）
                </Checkbox>
                <span>
                  上弧 {g.topArc.toFixed(3)} / 下弧 {g.bottomArc.toFixed(3)} /
                  斜高 {g.slant.toFixed(3)} mm
                </span>
              </Space>
              <div className="cup-canvas">
                <svg
                  viewBox={`-5 -5 ${g.width + 10} ${g.height + 10}`}
                  aria-label="杯身展开刀模"
                >
                  <image
                    href={preview || undefined}
                    width={g.width}
                    height={g.height}
                  />
                  {guide && (
                    <>
                      <defs>
                        <clipPath id={`cup-cut-${d.id}`}>
                          <path d={pathData(g.points)} />
                        </clipPath>
                      </defs>
                      <path
                        d={pathData(g.points)}
                        fill="none"
                        stroke="#faad14"
                        strokeWidth={d.cup.bleed * 2}
                        opacity=".12"
                      />
                      <path
                        d={pathData(g.points)}
                        fill="none"
                        stroke="#e5484d"
                        strokeWidth="0.3"
                      />
                      <path
                        d={pathData(g.points)}
                        fill="none"
                        stroke="#1677ff"
                        strokeWidth={d.cup.safe * 2}
                        clipPath={`url(#cup-cut-${d.id})`}
                        opacity=".15"
                      />
                    </>
                  )}
                </svg>
              </div>
              <p>
                裁切包围盒 {g.width.toFixed(3)} × {g.height.toFixed(3)} mm ·{" "}
                {Math.round(
                  ((g.width + (print.bleed ? 2 * d.cup.bleed : 0)) *
                    print.dpi) /
                    25.4,
                )}{" "}
                ×{" "}
                {Math.round(
                  ((g.height + (print.bleed ? 2 * d.cup.bleed : 0)) *
                    print.dpi) /
                    25.4,
                )}{" "}
                px
              </p>
              {sourceSize && (
                <p>
                  原图有效清晰度约 {(25.4 / sourceFactor).toFixed(0)} DPI；输出
                  DPI 不会增加原图细节。像素取整误差不超过{" "}
                  {(12.7 / print.dpi).toFixed(4)} mm／边。
                </p>
              )}
              {sourceOverflow && (
                <Alert
                  type="warning"
                  title="图案外框有部分超出刀模，导出会裁切越界像素。请检查文字和完整角色，必要时缩小或移动。"
                />
              )}
              {preview && <Image width={100} src={preview} />}
            </>
          )}
          {tab === "a4" && (
            <>
              {!layout ? (
                <p>请上传设计后计算排版。修改设计或设置会使旧排版失效。</p>
              ) : (
                <>
                  <p>
                    轮廓搜索排版，不保证数学最优。未排入 {layout.omitted.length}{" "}
                    项；超大贴纸不会自动缩小。
                  </p>
                  {layout.pages.map((page, i) => (
                    <div key={i} className="cup-paper">
                      <svg viewBox={`0 0 ${layout.width} ${layout.height}`}>
                        <rect
                          width={layout.width}
                          height={layout.height}
                          fill="white"
                        />
                        {page.map((p, j) => {
                          const design = designs.find((v) => v.id === p.id)!,
                            shape = geometry(design.cup);
                          const b = print.bleed ? design.cup.bleed : 0;
                          const tx =
                              p.x +
                              b +
                              (p.rotation === 90 || p.rotation === 180
                                ? p.rotation === 90
                                  ? shape.height
                                  : shape.width
                                : 0),
                            ty =
                              p.y +
                              b +
                              (p.rotation === 180 || p.rotation === 270
                                ? p.rotation === 180
                                  ? shape.height
                                  : shape.width
                                : 0);
                          return (
                            <g
                              key={j}
                              role="button"
                              tabIndex={0}
                              aria-label={`移动图案 ${j + 1}`}
                              style={{ cursor: "move" }}
                              onClick={() =>
                                setMoving({
                                  page: i,
                                  index: j,
                                  value: { ...p },
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  setMoving({
                                    page: i,
                                    index: j,
                                    value: { ...p },
                                  });
                              }}
                              transform={`translate(${tx} ${ty}) rotate(${p.rotation})`}
                            >
                              <LayoutArtwork
                                design={design}
                                bleed={print.bleed}
                              />
                              <path
                                d={pathData(shape.points)}
                                fill="none"
                                stroke="#1677ff"
                                strokeWidth=".2"
                              />
                              {!design.source && (
                                <text
                                  x={shape.width / 2}
                                  y={shape.height / 2}
                                  textAnchor="middle"
                                  fontSize="3"
                                >
                                  {design.name}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </svg>
                      <p>
                        第 {i + 1} 页 · {page.length} 张 · 利用率{" "}
                        {(
                          (page.reduce(
                            (sum, p) =>
                              sum +
                              geometry(designs.find((v) => v.id === p.id)!.cup)
                                .area,
                            0,
                          ) /
                            ((layout.width - 2 * print.margin) *
                              (layout.height - 2 * print.margin))) *
                          100
                        ).toFixed(1)}
                        % · 点击轮廓手动调整 ·{" "}
                        {page
                          .map((p) => designs.find((d) => d.id === p.id)?.name)
                          .join("、")}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </main>
        {!settingsHost && <aside>{panel}</aside>}
      </div>
      <div className="cup-designs">
        {designs.map((v) => (
          <Card
            key={v.id}
            size="small"
            title={
              <Button
                type={v.id === d.id ? "primary" : "text"}
                onClick={() => setSelected(v.id)}
              >
                {v.name}
              </Button>
            }
          >
            <Input
              aria-label="设计名称"
              value={v.name}
              onChange={(e) => {
                setDesigns((a) =>
                  a.map((x) =>
                    x.id === v.id ? { ...x, name: e.target.value } : x,
                  ),
                );
                setLayout(undefined);
              }}
            />
            <label>
              打印数量{" "}
              <InputNumber
                min={1}
                max={100}
                value={v.quantity}
                onChange={(n) => {
                  setDesigns((a) =>
                    a.map((x) =>
                      x.id === v.id ? { ...x, quantity: n || 1 } : x,
                    ),
                  );
                  setLayout(undefined);
                }}
              />
            </label>
            <Button
              danger
              disabled={designs.length === 1}
              onClick={() =>
                Modal.confirm({
                  title: "删除该设计？",
                  onOk: () => {
                    setDesigns((a) => a.filter((x) => x.id !== v.id));
                    setLayout(undefined);
                  },
                })
              }
            >
              删除
            </Button>
          </Card>
        ))}
      </div>
      {d.aiResults.length > 0 && (
        <Card title="AI 候选图（点击放大后检查，采用才用于打印）">
          <Space wrap>
            {d.aiResults.map((blob, i) => (
              <div key={i}>
                <BlobPreview blob={blob} />
                <Button
                  onClick={() =>
                    update({
                      adopted: blob,
                      fit: "contain",
                      scale: 1,
                      x: 0,
                      y: 0,
                      rotation: 0,
                    })
                  }
                >
                  采用第 {i + 1} 张
                </Button>
              </div>
            ))}
            <Button onClick={() => update({ adopted: undefined })}>
              使用原图
            </Button>
          </Space>
        </Card>
      )}
      {editor && (
        <CupWrapArtworkEditor
          key={d.id}
          design={d}
          onClose={() => setEditor(false)}
          onApply={(source, layers) => {
            update({
              source,
              originalSource: d.originalSource || d.source,
              adopted: undefined,
              layers,
            });
            setEditor(false);
          }}
        />
      )}
      <Modal
        open={tileOpen}
        title="1:1 多页拼接（不缩小图案）"
        onCancel={() => setTileOpen(false)}
        onOk={() => {
          setTileOpen(false);
          run("正在导出拼接 PDF", async (signal) =>
            download(
              await tiledPdf(
                structuredClone(d),
                { ...print },
                overlap,
                tileMarks,
                signal,
              ),
              "A4-tiled.pdf",
            ),
          );
        }}
      >
        <label>
          重叠 mm{" "}
          <InputNumber
            min={0}
            max={30}
            value={overlap}
            onChange={(n) => setOverlap(n ?? 5)}
          />
        </label>
        <Checkbox
          checked={tileMarks}
          onChange={(e) => setTileMarks(e.target.checked)}
        >
          显示拼接标记
        </Checkbox>
      </Modal>
      <Modal
        open={!!moving}
        title="移动／旋转排版图案（不缩放）"
        onCancel={() => setMoving(undefined)}
        onOk={() => {
          if (!moving || !layout) return;
          const msg = placementError(
            moving.value,
            layout.pages[moving.page].filter((_, i) => i !== moving.index),
            designs,
            print,
          );
          if (msg) {
            setError(msg);
            return;
          }
          setLayout({
            ...layout,
            pages: layout.pages.map((p, i) =>
              i === moving.page
                ? p.map((v, j) => (j === moving.index ? moving.value : v))
                : p,
            ),
          });
          setMoving(undefined);
        }}
      >
        {moving && (
          <Space direction="vertical">
            {number(
              "X mm",
              moving.value.x,
              (x) => setMoving({ ...moving, value: { ...moving.value, x } }),
              0,
              297,
            )}
            {number(
              "Y mm",
              moving.value.y,
              (y) => setMoving({ ...moving, value: { ...moving.value, y } }),
              0,
              297,
            )}
            <Select
              value={moving.value.rotation}
              options={[0, 90, 180, 270].map((value) => ({
                value,
                label: `${value}°`,
              }))}
              onChange={(rotation) => {
                const p = moving.value,
                  swap = p.rotation % 180 !== rotation % 180;
                setMoving({
                  ...moving,
                  value: {
                    ...p,
                    rotation,
                    width: swap ? p.height : p.width,
                    height: swap ? p.width : p.height,
                  },
                });
              }}
            />
            <p>
              {layout
                ? placementError(
                    moving.value,
                    layout.pages[moving.page].filter(
                      (_, i) => i !== moving.index,
                    ),
                    designs,
                    print,
                  )
                : ""}
            </p>
          </Space>
        )}
      </Modal>
      {settingsHost && active ? createPortal(panel, settingsHost) : null}
    </div>
  );
}
