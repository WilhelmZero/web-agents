import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  Slider,
  Space,
  Spin,
  Tabs,
  Upload,
} from "antd";
import { RotateRightOutlined } from "@ant-design/icons";
import {
  DEFAULT_CUP,
  geometry,
  pathData,
  dielineSvg,
  type CupParams,
} from "./services/cupWrap/geometry";
import {
  DEFAULT_PRINT,
  type ImageAdjustment,
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
import CupWrapLocalAdapter from "./CupWrapLocalAdapter";
import { adaptArtwork } from "./services/cupWrap/ai";
import type { AppSettings } from "./types";
import { arrangeLayers } from "./services/cupWrap/artwork";
import { inside } from "./services/cupWrap/geometry";
import { containFit } from "./services/cupWrap/fitting";
import {
  adaptationPrompt,
  framePlacement,
} from "./services/cupWrap/adaptation";
const SHOW_MANUAL_ARTWORK_TOOLS = false;
const CupWrapSeamPreview = lazy(() => import("./CupWrapSeamPreview"));
const PRINT_SETTINGS_KEY = "cup-wrap-print:settings:v3";
const LEGACY_PRINT_SETTINGS_KEY = "cup-wrap-print:settings:v2";
const GAP_DEFAULTS_MIGRATION_KEY = "cup-wrap-print:gap-defaults:v2";
const DEFAULT_AI_ADJUSTMENT: ImageAdjustment = {
  scale: 1,
  x: 0,
  y: 0,
  warp: 0,
};
const DEFAULT_GEOMETRY_ADJUSTMENT: ImageAdjustment = {
  scale: 1,
  x: 0,
  y: 0,
  warp: 1,
  leftGap: 0,
  rightGap: 0,
  topGap: 10,
  bottomGap: 10,
};
function BlobPreview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <Image width={140} src={url} />;
}
const layoutPreviews = new WeakMap<WrapDesign, Map<string, Promise<Blob>>>();
let layoutPreviewQueue: Promise<unknown> = Promise.resolve();
function cachedLayoutPreview(
  design: WrapDesign,
  bleed: boolean,
  cutLine: boolean,
) {
  let map = layoutPreviews.get(design);
  if (!map) {
    map = new Map();
    layoutPreviews.set(design, map);
  }
  const key = `${bleed}:${cutLine}`;
  let task = map.get(key);
  if (!task) {
    task = layoutPreviewQueue
      .catch(() => {})
      .then(() =>
        work<Blob>({
          kind: "png",
          design,
          dpi: 72,
          bleed,
          cutLine,
          preview: true,
        }),
      );
    map.set(key, task);
    layoutPreviewQueue = task;
  }
  return task;
}
function LayoutArtwork({
  design,
  bleed,
  cutLine,
}: {
  design: WrapDesign;
  bleed: boolean;
  cutLine: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let u = "";
    cachedLayoutPreview(design, bleed, cutLine)
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
  }, [design, bleed, cutLine]);
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
  adaptationMode: "geometry",
  transparentOutput: false,
  aiAdjustment: { ...DEFAULT_GEOMETRY_ADJUSTMENT },
  fit: "contain",
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  layers: [],
  quantity: 1,
  prompt:
    "保持各个角色及文字大小不变，只调整间距与位置，沿刀模轮廓重新排布；空白过大时复制原图中的小装饰填补。",
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
    [localEditor, setLocalEditor] = useState(false),
    [model, setModel] = useState(
      () =>
        localStorage.getItem("cup-wrap-print:model:v2") ||
        "gpt-image-2.5-flare",
    );
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  }>();
  useEffect(() => {
    try {
      localStorage.setItem("cup-wrap-print:model:v2", model);
    } catch {}
  }, [model]);
  const [tileOpen, setTileOpen] = useState(false),
    [overlap, setOverlap] = useState(5),
    [tileMarks, setTileMarks] = useState(true);
  const [seamOpen, setSeamOpen] = useState(false);
  const [seamTexture, setSeamTexture] = useState<Blob>();
  const [seamBusy, setSeamBusy] = useState(false);
  const [moving, setMoving] = useState<{
    page: number;
    index: number;
    value: Placement;
  }>();
  const [designs, setDesigns] = useState<WrapDesign[]>(() => [fresh()]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(""),
    [layoutBusy, setLayoutBusy] = useState(false),
    [layout, setLayout] = useState<PrintLayout>(),
    [tab, setTab] = useState("design"),
    [guide, setGuide] = useState(true);
  const [print, setPrint] = useState<PrintSettings>(() => {
    try {
      const saved = localStorage.getItem(PRINT_SETTINGS_KEY);
      if (saved) return { ...DEFAULT_PRINT, ...JSON.parse(saved) };
      const previous = localStorage.getItem(LEGACY_PRINT_SETTINGS_KEY);
      if (previous)
        return {
          ...DEFAULT_PRINT,
          ...JSON.parse(previous),
          cutLine: true,
        };
      const legacy = JSON.parse(
        localStorage.getItem("cup-wrap-print:settings:v1") || "{}",
      );
      return {
        ...DEFAULT_PRINT,
        ...legacy,
        mode: DEFAULT_PRINT.mode,
      };
    } catch {
      return DEFAULT_PRINT;
    }
  });
  const abort = useRef<AbortController | null>(null),
    saveChain = useRef(Promise.resolve());
  const d = designs[0];
  const imageAdjustment =
    d.aiAdjustment ??
    ((d.adaptationMode ?? "geometry") === "geometry"
      ? DEFAULT_GEOMETRY_ADJUSTMENT
      : DEFAULT_AI_ADJUSTMENT);
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
        const migrateOldGapDefaults = !localStorage.getItem(
          GAP_DEFAULTS_MIGRATION_KEY,
        );
        if (v.length)
          setDesigns(
            v.slice(0, 1).map((item) => ({
              ...item,
              aiAdjustment:
                migrateOldGapDefaults &&
                (item.adaptationMode ?? "geometry") === "geometry"
                  ? {
                      ...(item.aiAdjustment ?? DEFAULT_GEOMETRY_ADJUSTMENT),
                      topGap:
                        item.aiAdjustment?.topGap == null ||
                        item.aiAdjustment.topGap === 2
                          ? 10
                          : item.aiAdjustment.topGap,
                      bottomGap:
                        item.aiAdjustment?.bottomGap == null ||
                        item.aiAdjustment.bottomGap === 2
                          ? 10
                          : item.aiAdjustment.bottomGap,
                    }
                  : item.aiAdjustment,
              prompt:
                item.prompt ===
                "第一张是原始图案，第二张是目标展开轮廓引导图。输出画布构图对应第二张图，不要把红色轮廓线或其他辅助标记画进结果。保持文字内容和角色身份，不拉伸文字与角色。根据目标展开范围调整完整角色的位置、等比大小和间距，在空白区域补充风格一致的小装饰，保持脸部、眼睛和肢体完整。"
                  ? fresh().prompt
                  : item.prompt,
            })),
          );
        if (migrateOldGapDefaults)
          localStorage.setItem(GAP_DEFAULTS_MIGRATION_KEY, "1");
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
      localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(print));
    } catch (e) {
      setError(`设置保存失败：${e}`);
    }
  }, [print]);
  useEffect(() => {
    const printable = designs.filter((design) => design.source);
    if (!printable.length) {
      setLayout(undefined);
      setLayoutBusy(false);
      return;
    }
    const controller = new AbortController();
    setLayout(undefined);
    setLayoutBusy(true);
    const timer = setTimeout(() => {
      work<PrintLayout>(
        {
          kind: "pack",
          designs: printable,
          settings: print,
        },
        controller.signal,
      )
        .then(setLayout)
        .catch((e) => {
          if (e.name !== "AbortError")
            setError(`A4 自动排版失败：${e.message}`);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLayoutBusy(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [designs, print]);
  useEffect(() => {
    if (!active || !geo.g) return;
    const controller = new AbortController();
    let url = "";
    const timer = setTimeout(() => {
      work<Blob>(
        {
          kind: "png",
          design: d,
          dpi: print.dpi,
          cutLine: print.cutLine,
          preview: true,
        },
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
  }, [d, active, geo.g, print.dpi, print.cutLine]);
  const update = (patch: Partial<WrapDesign>) => {
    setDesigns((all) =>
      all.map((v) => (v.id === d.id ? { ...v, ...patch } : v)),
    );
    setLayout(undefined);
  };
  async function openSeamPreview() {
    setSeamOpen(true);
    setSeamTexture(undefined);
    if (!d.source && !d.adopted && !d.layers.length) return;
    setSeamBusy(true);
    try {
      setSeamTexture(
        await work<Blob>({
          kind: "png",
          design: structuredClone(d),
          dpi: 144,
          bleed: false,
          cutLine: false,
          preview: true,
        }),
      );
    } catch (e) {
      setError(`3D 预览纹理生成失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setSeamBusy(false);
    }
  }
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
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(c.width / g.width, c.height / g.height);
    ctx.fillStyle = "white";
    ctx.fill(new Path2D(pathData(g.points)));
    const guide = await new Promise<Blob>((resolve) =>
      c.toBlob((v) => resolve(v!), "image/png"),
    );
    const raw = await adaptArtwork(
      settings,
      model,
      snapshot.source!,
      guide,
      adaptationPrompt(
        snapshot.cup,
        snapshot.prompt.replace("位置、等比大小和间距", "位置和间距"),
        snapshot.transparentOutput,
      ),
      signal,
      {
        transparent: !!snapshot.transparentOutput,
        size: model.startsWith("gpt-image-2.5-")
          ? `${Math.max(16, Math.round((2048 * g.width) / Math.max(g.width, g.height) / 16) * 16)}x${Math.max(16, Math.round((2048 * g.height) / Math.max(g.width, g.height) / 16) * 16)}`
          : undefined,
      },
    );
    setDesigns((all) =>
      all.map((v) =>
        v.id === snapshot.id
          ? {
              ...v,
              aiResults: [...v.aiResults, raw],
              aiFrames: [
                ...v.aiResults.map((_, i) => v.aiFrames?.[i] ?? null),
                {
                  cupKey: JSON.stringify(snapshot.cup),
                  transparent: !!snapshot.transparentOutput,
                },
              ],
            }
          : v,
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
        aiFrames: [],
        adoptedFrame: undefined,
        localAdaptation: undefined,
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
      {SHOW_MANUAL_ARTWORK_TOOLS && (
        <>
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
          {number(
            "旋转 °",
            d.rotation,
            (v) => update({ rotation: v }),
            -180,
            180,
          )}
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
                update({
                  source: d.originalSource,
                  adopted: undefined,
                  layers: [],
                })
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
        </>
      )}
      <h3>图案适配方式</h3>
      <Select
        aria-label="图案适配方式"
        value={d.adaptationMode ?? "geometry"}
        onChange={(adaptationMode) => update({ adaptationMode })}
        options={[
          { value: "geometry", label: "原图几何映射（推荐）" },
          { value: "ai", label: "AI 适配" },
          { value: "local", label: "本地智能排布（免费）" },
        ]}
      />
      {(d.adaptationMode ?? "geometry") === "geometry" ? (
        <>
          <Alert
            type="success"
            showIcon
            message="确定性圆台映射 · 不调用 AI"
            description="严格按杯口径、杯底径和垂直高度计算扇形；保留原图内容与相对排版，不生成红线、文字或新角色，并自动留出安全边距防止边缘裁切。"
          />
          <Checkbox
            checked={!!d.transparentOutput}
            onChange={(e) => update({ transparentOutput: e.target.checked })}
          >
            透明底（自动移除与边界连通的纯色背景）
          </Checkbox>
          <p>
            未勾选时输出纯白底。只移除与边界连通且颜色均匀的背景；角色身体、眼睛和封闭区域中的白色或黑色会保留。
          </p>
        </>
      ) : (d.adaptationMode ?? "geometry") === "local" ? (
        <>
          <p>
            适用于透明底、白底或其他纯色底贴纸图。本地识别后先确认主体和可复制小装饰，再按真实刀模重新排布。
          </p>
          <Button
            type="primary"
            disabled={!d.source || !!busy}
            onClick={() => setLocalEditor(true)}
          >
            {d.localAdaptation ? "检查／重新排布" : "分析素材并排布"}
          </Button>
          {d.localAdaptation &&
            d.localAdaptation.cupKey !== JSON.stringify(d.cup) && (
              <Alert
                type="warning"
                showIcon
                message="杯型尺寸已改变，请重新生成本地排布"
              />
            )}
          {d.localAdaptation &&
            d.localAdaptation.cupKey === JSON.stringify(d.cup) && (
              <Alert
                type="success"
                showIcon
                message={`已采用本地排布 · ${d.localAdaptation.layers.length} 个对象 · 不产生 AI 费用`}
              />
            )}
        </>
      ) : (
        <>
          <h3>AI 适配</h3>
          <Select
            value={model}
            onChange={setModel}
            options={[
              "gpt-image-2.5-flare",
              "gpt-image-2",
              "gpt-image-2.5-sunburst",
              "gemini-3-pro-image",
              "gemini-3.1-flash-image",
            ].map((value) => ({ value, label: value }))}
          />
          <Checkbox
            checked={!!d.transparentOutput}
            onChange={(e) => update({ transparentOutput: e.target.checked })}
          >
            请求透明背景（默认纯白底）
          </Checkbox>
          <Checkbox
            checked={!!d.backgroundColor}
            disabled={!d.transparentOutput && !d.adoptedFrame?.transparent}
            onChange={(e) =>
              update({
                backgroundColor: e.target.checked ? "#ffffff" : undefined,
              })
            }
          >
            透明结果填充自定义底色
          </Checkbox>
          {d.backgroundColor && (
            <input
              aria-label="自定义背景颜色"
              type="color"
              value={d.backgroundColor}
              onChange={(e) => update({ backgroundColor: e.target.value })}
            />
          )}
          <Input.TextArea
            aria-label="AI 适配提示词"
            rows={5}
            value={d.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
          />
          <details>
            <summary>查看最终提交提示词</summary>
            <Input.TextArea
              readOnly
              rows={12}
              value={adaptationPrompt(
                d.cup,
                d.prompt.replace("位置、等比大小和间距", "位置和间距"),
                d.transparentOutput,
              )}
            />
          </details>
          <p>
            输入顺序：原图、精确刀模引导图。仅调整间距，不改变主体大小。采用后按整幅刀模画布对齐，不再缩入矩形或叠加旧图层。AI
            仍可能偏离要求，请检查后采用。自定义底色仅填充透明区域；若服务返回不透明图，请重新生成，不会删除白色角色。
          </p>
          <Button
            disabled={!d.source || !!busy || !d.prompt.trim()}
            onClick={() =>
              Modal.confirm({
                title: "将发起 1 次付费图片请求",
                content:
                  "仅调整图案，不以 AI 输出尺寸作为打印尺寸。不自动重试。",
                onOk: () => run("AI 正在适配图案", generate),
              })
            }
          >
            AI 生成候选图
          </Button>
        </>
      )}
      <h3>输出与 A4</h3>
      {d.source &&
        ((d.adaptationMode ?? "geometry") === "geometry" ||
          (d.adopted && d.adoptedFrame) ||
          d.localAdaptation) && (
          <>
            <h3>生成图片微调</h3>
            <p>
              非破坏性调整，原图保留；预览和打印同步更新。几何映射默认使用完整扇形路径（1），可调低以减弱弯曲。缩放或移动超出安全区时可能裁切。
            </p>
            {number(
              "图片缩放",
              imageAdjustment.scale,
              (scale) =>
                update({
                  aiAdjustment: {
                    ...imageAdjustment,
                    scale,
                  },
                }),
              0.2,
              2,
            )}
            <label className="cup-field cup-slider-field">
              缩放滑动条 · {Math.round(imageAdjustment.scale * 100)}%
              <Slider
                ariaLabelForHandle="图片缩放滑动条"
                min={0.2}
                max={2}
                step={0.01}
                value={imageAdjustment.scale}
                tooltip={{
                  formatter: (value) => `${Math.round((value ?? 1) * 100)}%`,
                }}
                onChange={(scale) =>
                  update({
                    aiAdjustment: {
                      ...imageAdjustment,
                      scale,
                    },
                  })
                }
              />
            </label>
            {(d.adaptationMode ?? "geometry") === "geometry" && (
              <>
                {number(
                  "图案左侧留白 mm",
                  imageAdjustment.leftGap ?? 0,
                  (leftGap) =>
                    update({
                      aiAdjustment: { ...imageAdjustment, leftGap },
                    }),
                  0,
                  geo.g ? Math.min(geo.g.topArc, geo.g.bottomArc) / 2 : 1000,
                )}
                {number(
                  "图案右侧留白 mm",
                  imageAdjustment.rightGap ?? 0,
                  (rightGap) =>
                    update({
                      aiAdjustment: { ...imageAdjustment, rightGap },
                    }),
                  0,
                  geo.g ? Math.min(geo.g.topArc, geo.g.bottomArc) / 2 : 1000,
                )}
                {number(
                  "图案上方留白 mm",
                  imageAdjustment.topGap ?? 10,
                  (topGap) =>
                    update({
                      aiAdjustment: { ...imageAdjustment, topGap },
                    }),
                  0,
                  Math.max(0, d.cup.height / 2),
                )}
                {number(
                  "图案下方留白 mm",
                  imageAdjustment.bottomGap ?? 10,
                  (bottomGap) =>
                    update({
                      aiAdjustment: { ...imageAdjustment, bottomGap },
                    }),
                  0,
                  Math.max(0, d.cup.height / 2),
                )}
                <p>
                  {
                    "四边留白直接控制图案在扇形中的起止位置；左右默认 0 mm，尽量铺满宽度。增大对应数值会压缩图案并留出空白。"
                  }
                </p>
              </>
            )}
            {number(
              "图片水平 mm",
              imageAdjustment.x,
              (x) =>
                update({
                  aiAdjustment: {
                    ...imageAdjustment,
                    x,
                  },
                }),
              -500,
              500,
            )}
            {number(
              "图片垂直 mm",
              imageAdjustment.y,
              (y) =>
                update({
                  aiAdjustment: {
                    ...imageAdjustment,
                    y,
                  },
                }),
              -500,
              500,
            )}
            {number(
              "扇形路径变形（0–1）",
              imageAdjustment.warp,
              (warp) =>
                update({
                  aiAdjustment: {
                    ...imageAdjustment,
                    warp,
                  },
                }),
              0,
              1,
            )}
            <Button
              onClick={() =>
                update({
                  aiAdjustment:
                    (d.adaptationMode ?? "geometry") === "geometry"
                      ? DEFAULT_GEOMETRY_ADJUSTMENT
                      : undefined,
                })
              }
            >
              重置图片微调
            </Button>
            {d.adopted && (
              <Button
                onClick={() => download(d.adopted!, `${d.name}-AI原始图.png`)}
              >
                下载 AI 原始图（不裁刀模）
              </Button>
            )}
          </>
        )}
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
      <Checkbox
        checked={print.cutLine}
        onChange={(e) => setting({ cutLine: e.target.checked })}
      >
        导出裁切线（黑色 0.1 mm）
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
      {print.mode === "quantity" &&
        number(
          "打印数量",
          d.quantity,
          (quantity) => update({ quantity }),
          1,
          100,
        )}
      <p>
        {
          "RGB 透明 TIF；白墨由打印软件处理。打印选择实际大小／100%，不要适合页面。先用纸样试贴。"
        }
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
      <div className="cup-action-rows">
        <Space wrap>
          <Upload
            showUploadList={false}
            beforeUpload={upload}
            accept="image/png,image/jpeg,image/webp"
          >
            <Button disabled={!ready}>上传图案</Button>
          </Upload>
        </Space>
        <Space wrap>
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
                    cutLine: print.cutLine,
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
            disabled={!layout || layoutBusy || !!busy}
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
          <Button
            type="primary"
            icon={<RotateRightOutlined />}
            aria-label="3D 模拟"
            disabled={!g || seamBusy}
            onClick={openSeamPreview}
          >
            {seamBusy ? "正在准备 3D…" : "3D 模拟"}
          </Button>
          {busy && (
            <>
              <Spin size="small" />
              {busy}
              <Button onClick={() => abort.current?.abort()}>停止</Button>
            </>
          )}
        </Space>
      </div>
      <div className="cup-body">
        <main>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "design", label: "展开预览" },
              {
                key: "a4",
                label: `A4 排版${layoutBusy ? " · 自动计算中" : layout ? ` · ${layout.pages.length} 页` : ""}`,
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
              {layoutBusy ? (
                <Space>
                  <Spin size="small" />
                  正在根据最新设计与设置自动混排…
                </Space>
              ) : !layout ? (
                <p>上传设计后将自动生成 A4 混排。</p>
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
                                cutLine={print.cutLine}
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
      {d.aiResults.length > 0 && (
        <Card title="AI 候选图（点击放大后检查，采用才用于打印）">
          <Space wrap>
            {d.aiResults.map((blob, i) => (
              <div key={i}>
                <BlobPreview blob={blob} />
                <Button
                  onClick={async () => {
                    const frame = d.aiFrames?.[i];
                    if (frame) {
                      const image = await createImageBitmap(blob);
                      try {
                        if (frame.cupKey !== JSON.stringify(d.cup))
                          throw new Error("候选图属于旧刀模尺寸，请重新生成。");
                        const g = geometry(d.cup);
                        framePlacement(
                          image.width,
                          image.height,
                          g.width,
                          g.height,
                        );
                      } catch (e) {
                        setError(String(e));
                        return;
                      } finally {
                        image.close();
                      }
                    }
                    update({
                      adopted: blob,
                      adaptationMode: "ai",
                      adoptedFrame: frame ?? undefined,
                      aiAdjustment: undefined,
                      fit: "contain",
                      scale: 1,
                      x: 0,
                      y: 0,
                      rotation: 0,
                    });
                  }}
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
      {localEditor && d.source && (
        <CupWrapLocalAdapter
          source={d.source}
          cup={d.cup}
          initial={d.localAdaptation}
          onClose={() => setLocalEditor(false)}
          onApply={(localAdaptation) => {
            update({
              localAdaptation,
              adopted: undefined,
              adoptedFrame: undefined,
              aiAdjustment: undefined,
            });
            setLocalEditor(false);
          }}
        />
      )}
      {seamOpen && (
        <Suspense fallback={null}>
          <CupWrapSeamPreview
            open
            cup={d.cup}
            texture={seamTexture}
            textureHasTransparency={!!d.transparentOutput}
            initialShowGlass
            onClose={() => setSeamOpen(false)}
          />
        </Suspense>
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
