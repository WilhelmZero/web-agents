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
  message,
  Modal,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Tabs,
  Upload,
} from "antd";
import {
  BgColorsOutlined,
  CopyOutlined,
  DeleteOutlined,
  DragOutlined,
  PlusOutlined,
  RotateRightOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  DEFAULT_CUP,
  geometry,
  pathData,
  dielineSvg,
  type CupParams,
} from "./services/cupWrap/geometry";
import {
  DEFAULT_PRINT,
  type ArtworkMaskPoint,
  type ArtworkMaskStroke,
  type ArtworkRole,
  type ImageAdjustment,
  type GeometryOutpaintCandidate,
  type GeometryOutpaintModel,
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
import { framePlacement } from "./services/cupWrap/adaptation";
import CupWrapSeamPreview from "./CupWrapSeamPreview";
import { hasUsableTransparency } from "./services/backgroundRemoval";
import { artworkSlotPlacement } from "./services/cupWrap/artworkPlacement";
import { stitchArtwork } from "./services/cupWrap/stitchArtwork";
import {
  chooseOutpaintSize,
  DEFAULT_GEOMETRY_OUTPAINT_PROMPT,
  idealOutpaintRatio,
} from "./services/cupWrap/geometryOutpaint";
const SHOW_MANUAL_ARTWORK_TOOLS = false;
const PRINT_SETTINGS_KEY = "cup-wrap-print:settings:v3";
const LEGACY_PRINT_SETTINGS_KEY = "cup-wrap-print:settings:v2";
const GAP_DEFAULTS_MIGRATION_KEY = "cup-wrap-print:gap-defaults:v2";
const DEFAULT_AI_ADJUSTMENT: ImageAdjustment = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  x: 0,
  y: 0,
  warp: 0,
};
const DEFAULT_GEOMETRY_ADJUSTMENT: ImageAdjustment = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  x: 0,
  y: 0,
  warp: 1,
  leftGap: 0,
  rightGap: 0,
  topGap: 10,
  bottomGap: 10,
};
const AI_OUTPAINT_PROMPT =
  "给图片里的图案扩图填充，使完整图案自然覆盖扇形区域，并彻底移除此图像的白色、纯色或其他背景，将背景设为真正透明。保持原图中所有文字、角色和前景主体不变、不重画、不变形且完整无损。重新排布扩展出的周围元素：凡是靠近扇形上弧、下弧或左右斜边的角色、帽子、头部、手脚、扫帚、书本、灯笼、星星、月亮及其他装饰，都必须整体向内移动并完整显示，任何元素都不得被画布边缘或扇形边界裁切、截断、遮挡或只显示一部分。所有元素的完整外轮廓与扇形边界之间保留至少图像短边 3% 的透明安全距离；宁可缩小或调整外围元素的位置，也不能裁掉任何元素。主体边缘干净、连续、平滑，无白边、无残留底色、无刀模线、无描边框，输出透明 PNG。";
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
  sourceRevision: crypto.randomUUID(),
  aiResults: [],
  geometryOutpaintPrompt: DEFAULT_GEOMETRY_OUTPAINT_PROMPT,
  geometryOutpaintModel: "gpt-image-2.5-sunburst",
  geometryOutpaintCandidates: [],
  artworkSlots: [],
  stitchGapPx: 0,
  enabled: true,
  adaptationMode: "geometry",
  transparentOutput: false,
  canvasBackground: "white",
  canvasBackgroundColor: "#ffffff",
  aiAdjustment: { ...DEFAULT_GEOMETRY_ADJUSTMENT },
  fit: "contain",
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  layers: [],
  quantity: 1,
  prompt:
    "保持中央主体、文字、角色和已有小图案的大小及比例不变，沿刀模轮廓只向外围空白扩展同风格背景和小装饰，并自然连接正面与背面图案。",
});
const hasArtwork = (design: WrapDesign) =>
  Boolean(
    design.source ||
    design.adopted ||
    design.layers.length ||
    design.artworkSlots?.some((slot) => slot.enabled),
  );
const migrateDesign = (design: WrapDesign): WrapDesign => ({
  ...design,
  sourceRevision: design.sourceRevision ?? crypto.randomUUID(),
  geometryOutpaintPrompt:
    design.geometryOutpaintPrompt ?? DEFAULT_GEOMETRY_OUTPAINT_PROMPT,
  geometryOutpaintModel:
    design.geometryOutpaintModel ?? "gpt-image-2.5-sunburst",
  // A single uploaded image uses the same unified source pipeline as a
  // stitched pair. Legacy one-slot projects are upgraded automatically so
  // geometry mapping is not bypassed by the old front/back placement branch.
  stitchedSource:
    design.stitchedSource ??
    Boolean(design.source && (design.artworkSlots?.length ?? 0) <= 1),
  stitchGapPx: design.stitchGapPx ?? 0,
  enabled: design.enabled ?? true,
  canvasBackground:
    design.canvasBackground ??
    (design.transparentOutput ? "transparent" : "white"),
  canvasBackgroundColor: design.canvasBackgroundColor ?? "#ffffff",
  artworkSlots:
    design.artworkSlots?.length || !design.source
      ? (design.artworkSlots ?? [])
      : [
          {
            id: crypto.randomUUID(),
            role: "front",
            blob: design.source,
            enabled: true,
            scale: 1,
            x: 0,
            y: 0,
            rotation: 0,
          },
        ],
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
  const [slotSizes, setSlotSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
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
    [activeDesignId, setActiveDesignId] = useState(""),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(""),
    [geometryBusy, setGeometryBusy] = useState<string | null>(null),
    [layoutBusy, setLayoutBusy] = useState(false),
    [layout, setLayout] = useState<PrintLayout>(),
    [tab, setTab] = useState("design"),
    [guide, setGuide] = useState(true),
    [previewTool, setPreviewTool] = useState<"move" | "erase" | "restore">(
      "move",
    ),
    [brushSize, setBrushSize] = useState(0.045),
    [liveStroke, setLiveStroke] = useState<ArtworkMaskPoint[]>([]),
    [liveMove, setLiveMove] = useState<ArtworkMaskPoint>();
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
    geometryJob = useRef<AbortController | null>(null),
    saveChain = useRef(Promise.resolve()),
    previewSvg = useRef<SVGSVGElement | null>(null),
    previewInteraction = useRef<
      | {
          kind: "move";
          start: ArtworkMaskPoint;
          adjustment: ImageAdjustment;
          delta: ArtworkMaskPoint;
        }
      | { kind: "paint"; pointerId: number }
      | undefined
    >(undefined),
    stitchTimer = useRef<number | undefined>(undefined),
    stitchRevision = useRef(0);
  const d =
    designs.find((design) => design.id === activeDesignId) ?? designs[0];
  const imageAdjustment =
    d.aiAdjustment ??
    (["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry")
      ? DEFAULT_GEOMETRY_ADJUSTMENT
      : DEFAULT_AI_ADJUSTMENT);
  useEffect(() => {
    let cancelled = false;
    const applied = d.geometryOutpaintCandidates?.find(
      (candidate) => candidate.id === d.appliedGeometryCandidateId &&
        candidate.cupKey === JSON.stringify(d.cup) &&
        candidate.sourceRevision === d.sourceRevision,
    );
    const blob = d.adaptationMode === "ai-geometry"
      ? applied?.blob ?? d.source
      : d.adopted || (d.stitchedSource
        ? d.source
        : d.artworkSlots?.find((slot) => slot.enabled)?.blob || d.source);
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
  }, [d.source, d.adopted, d.artworkSlots, d.adaptationMode,
    d.appliedGeometryCandidateId, d.geometryOutpaintCandidates, d.cup, d.sourceRevision]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      (d.artworkSlots ?? []).map(async (slot) => {
        const image = await createImageBitmap(slot.blob);
        const result = {
          id: slot.id,
          width: image.width,
          height: image.height,
        };
        image.close();
        return result;
      }),
    )
      .then((items) => {
        if (!cancelled)
          setSlotSizes(
            Object.fromEntries(
              items.map(({ id, width, height }) => [id, { width, height }]),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setSlotSizes({});
      });
    return () => {
      cancelled = true;
    };
  }, [d.artworkSlots]);
  const geo = useMemo(() => {
    try {
      return { g: geometry(d.cup), error: "" };
    } catch (e) {
      return { g: null, error: String(e) };
    }
  }, [d.cup]);
  const geometryOutpaintSize = useMemo(() => {
    try {
      if (!geo.g) return { value: null, error: geo.error };
      return {
        value: chooseOutpaintSize(
          idealOutpaintRatio(geo.g, d.cup.safe, imageAdjustment),
        ),
        error: "",
      };
    } catch (e) {
      return { value: null, error: String(e) };
    }
  }, [geo, d.cup.safe, imageAdjustment]);
  useEffect(() => {
    loadDesigns()
      .then((v) => {
        const migrateOldGapDefaults = !localStorage.getItem(
          GAP_DEFAULTS_MIGRATION_KEY,
        );
        if (v.length) {
          const restored = v.map((item) =>
            migrateDesign({
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
            }),
          );
          setDesigns(restored);
          setActiveDesignId(restored[0].id);
        } else setActiveDesignId((current) => current || designs[0].id);
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
    const printable = designs.filter(
      (design) => design.enabled !== false && hasArtwork(design),
    );
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
  useEffect(
    () => () => {
      if (stitchTimer.current !== undefined)
        window.clearTimeout(stitchTimer.current);
    },
    [],
  );
  const changeStitchGap = (value: number) => {
    const gap = Math.round(value),
      slots = (d.artworkSlots ?? []).filter((slot) => slot.enabled),
      designId = d.id,
      revision = ++stitchRevision.current;
    update({
      stitchGapPx: gap,
      sourceRevision: crypto.randomUUID(),
      adopted: undefined,
      appliedGeometryCandidateId: undefined,
      layers: [],
      aiResults: [],
      aiFrames: [],
      adoptedFrame: undefined,
      localAdaptation: undefined,
    });
    if (stitchTimer.current !== undefined)
      window.clearTimeout(stitchTimer.current);
    if (slots.length < 2) return;
    stitchTimer.current = window.setTimeout(() => {
      stitchArtwork(
        slots.map((slot) => slot.blob),
        gap,
      )
        .then((source) => {
          if (stitchRevision.current !== revision) return;
          setDesigns((all) =>
            all.map((design) =>
              design.id === designId
                ? { ...design, source, originalSource: source, sourceRevision: crypto.randomUUID() }
                : design,
            ),
          );
          setLayout(undefined);
        })
        .catch((cause) => setError(String(cause)));
    }, 150);
  };
  async function openSeamPreview() {
    setSeamOpen(true);
    setSeamTexture(undefined);
    if (!hasArtwork(d)) return;
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
    if (!hasArtwork(d)) return;
    const snapshot = structuredClone(d),
      g = geometry(snapshot.cup);
    const composite = await work<Blob>(
      {
        kind: "png",
        // Send the exact current dieline preview: all placement, scale and
        // black/white mask edits are already baked into this image. The AI
        // receives one white-filled sector image and is asked to remove it.
        design: {
          ...snapshot,
          transparentOutput: false,
          adoptedFrame: snapshot.adoptedFrame
            ? { ...snapshot.adoptedFrame, transparent: false }
            : undefined,
        },
        dpi: 144,
        bleed: false,
        cutLine: false,
        preview: true,
      },
      signal,
    );
    const raw = await adaptArtwork(
      settings,
      model,
      composite,
      AI_OUTPAINT_PROMPT,
      signal,
      {
        transparent: true,
        size: model.startsWith("gpt-image-2.5-")
          ? `${Math.max(16, Math.round((2048 * g.width) / Math.max(g.width, g.height) / 16) * 16)}x${Math.max(16, Math.round((2048 * g.height) / Math.max(g.width, g.height) / 16) * 16)}`
          : undefined,
      },
    );
    const returned = await createImageBitmap(raw);
    try {
      framePlacement(returned.width, returned.height, g.width, g.height);
    } finally {
      returned.close();
    }
    const frame = {
      cupKey: JSON.stringify(snapshot.cup),
      transparent: true,
    };
    setDesigns((all) =>
      all.map((v) =>
        v.id === snapshot.id
          ? {
              ...v,
              aiResults: [...v.aiResults, raw],
              aiFrames: [
                ...v.aiResults.map((_, i) => v.aiFrames?.[i] ?? null),
                frame,
              ],
              adopted: raw,
              adoptedFrame: frame,
              adaptationMode: "ai",
              aiAdjustment: { ...DEFAULT_AI_ADJUSTMENT },
              maskStrokes: [],
              transparentOutput: true,
              backgroundColor: undefined,
              fit: "contain",
              scale: 1,
              x: 0,
              y: 0,
              rotation: 0,
            }
          : v,
      ),
    );
  }
  function confirmGeometryGenerate() {
    const size = geometryOutpaintSize.value;
    if (!size || !d.originalSource && !d.source) return;
    Modal.confirm({
      title: "将发起 1 次付费矩形扩图请求",
      content: `模型：${d.geometryOutpaintModel ?? "gpt-image-2.5-sunburst"}；质量：high；尺寸：${size.width} × ${size.height} px。仅发送原始拼接图，完成后不会自动应用；该尺寸属于实验性高分辨率范围。`,
      onOk: () => { void generateGeometryCandidate(); },
    });
  }
  async function generateGeometryCandidate() {
    if (geometryJob.current || !geometryOutpaintSize.value) return;
    const input = d.originalSource ?? d.source;
    if (!input) return;
    const snapshot = {
      id: d.id,
      cupKey: JSON.stringify(d.cup),
      sourceRevision: d.sourceRevision ?? "",
      prompt: d.geometryOutpaintPrompt?.trim() || DEFAULT_GEOMETRY_OUTPAINT_PROMPT,
      model: d.geometryOutpaintModel ?? "gpt-image-2.5-sunburst",
      adjustment: { ...imageAdjustment, warp: 1 },
      size: geometryOutpaintSize.value,
    };
    const controller = new AbortController();
    geometryJob.current = controller;
    setGeometryBusy(snapshot.id);
    setError("");
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 180_000);
    try {
      const blob = await adaptArtwork(
        settings,
        snapshot.model,
        input,
        snapshot.prompt,
        controller.signal,
        {
          transparent: true,
          size: `${snapshot.size.width}x${snapshot.size.height}`,
          requestSummary: "杯身矩形扩图 · 原始拼接图 · 单次请求，无自动重试",
        },
      );
      const image = await createImageBitmap(blob);
      const candidate: GeometryOutpaintCandidate = {
        id: crypto.randomUUID(),
        blob,
        cupKey: snapshot.cupKey,
        sourceRevision: snapshot.sourceRevision,
        width: image.width,
        height: image.height,
        requestedWidth: snapshot.size.width,
        requestedHeight: snapshot.size.height,
        model: snapshot.model,
        prompt: snapshot.prompt,
        adjustment: snapshot.adjustment,
      };
      image.close();
      setDesigns((all) => all.map((item) => item.id === snapshot.id
        ? { ...item, geometryOutpaintCandidates: [...(item.geometryOutpaintCandidates ?? []), candidate] }
        : item));
      message.success("矩形扩图已完成，请查看对应杯型的候选图并手动应用");
    } catch (e) {
      if (timedOut) setError("矩形扩图超过 3 分钟，请检查请求记录后重试；当前设计未改变。");
      else if (!controller.signal.aborted)
        setError(`矩形扩图失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      window.clearTimeout(timer);
      geometryJob.current = null;
      setGeometryBusy(null);
    }
  }
  useEffect(() => () => geometryJob.current?.abort(), []);
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
  async function upload(file: File, role: ArtworkRole = "front") {
    try {
      stitchRevision.current++;
      if (stitchTimer.current !== undefined)
        window.clearTimeout(stitchTimer.current);
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
      const sourceHasTransparency = await hasUsableTransparency(file);
      const existingSlots = d.artworkSlots ?? [];
      const slot = {
        id: crypto.randomUUID(),
        role,
        blob: file,
        enabled: true,
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
      };
      const artworkSlots = [
        ...existingSlots.filter((item) => item.role !== role),
        slot,
      ].sort((a) => (a.role === "front" ? -1 : 1));
      const source = await stitchArtwork(
        artworkSlots.filter((item) => item.enabled).map((item) => item.blob),
        d.stitchGapPx ?? 0,
      );
      update({
        source,
        originalSource: source,
        sourceRevision: crypto.randomUUID(),
        artworkSlots,
        stitchedSource: true,
        transparentOutput: Boolean(
          d.transparentOutput || sourceHasTransparency,
        ),
        backgroundColor:
          sourceHasTransparency || d.transparentOutput
            ? undefined
            : d.backgroundColor,
        adopted: undefined,
        appliedGeometryCandidateId: undefined,
        layers: [],
        aiResults: [],
        aiFrames: [],
        adoptedFrame: undefined,
        localAdaptation: undefined,
        name: role === "front" ? file.name.replace(/\.[^.]+$/, "") : d.name,
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
      <h3>杯型名称</h3>
      <Input
        aria-label="杯型名称"
        value={d.name}
        onChange={(event) => update({ name: event.target.value })}
      />
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
                  sourceRevision: crypto.randomUUID(),
                  adopted: undefined,
                  appliedGeometryCandidateId: undefined,
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
      <h3>设计图拼接</h3>
      <Alert
        type="info"
        showIcon
        message="默认使用一张图；上传两张时按顺序横向拼接"
        description="系统保持两张图的宽高比，将第一张右边与第二张左边调整为相同高度后连接。负间隙会让第二张图覆盖第一张图；拼接完成后，后续操作均将其视为一张图。"
      />
      {(["front", "back"] as ArtworkRole[]).map((role) => {
        const slot = d.artworkSlots?.find((item) => item.role === role);
        const label =
          role === "front" ? "第 1 张图（左侧）" : "第 2 张图（右侧）";
        return (
          <Card
            key={role}
            size="small"
            title={label}
            className="cup-artwork-slot"
          >
            <Space wrap>
              <Upload
                showUploadList={false}
                accept="image/png,image/jpeg,image/webp"
                beforeUpload={(file) => upload(file as File, role)}
              >
                <Button>{slot ? `替换${label}` : `上传${label}`}</Button>
              </Upload>
              {slot ? (
                <>
                  <Button
                    danger
                    size="small"
                    onClick={() => {
                      const artworkSlots = (d.artworkSlots ?? []).filter(
                        (item) => item.role !== role,
                      );
                      const remaining = artworkSlots.map((item) => item.blob);
                      if (!remaining.length) {
                        update({
                          artworkSlots: [],
                          source: undefined,
                          originalSource: undefined,
                          sourceRevision: crypto.randomUUID(),
                          adopted: undefined,
                          appliedGeometryCandidateId: undefined,
                          stitchedSource: false,
                        });
                      } else
                        stitchArtwork(remaining, d.stitchGapPx ?? 0)
                          .then((source) =>
                            update({
                              artworkSlots,
                              source,
                              originalSource: source,
                              sourceRevision: crypto.randomUUID(),
                              adopted: undefined,
                              appliedGeometryCandidateId: undefined,
                              stitchedSource: true,
                            }),
                          )
                          .catch((error) => setError(String(error)));
                    }}
                  >
                    删除
                  </Button>
                </>
              ) : null}
            </Space>
          </Card>
        );
      })}
      {(d.artworkSlots ?? []).filter((slot) => slot.enabled).length > 1 && (
        <div className="cup-stitch-gap">
          <strong>图与图之间的间隙 px</strong>
          <div className="cup-stitch-gap-controls">
            <Slider
              ariaLabelForHandle="图与图之间的间隙滑动条"
              min={-1000}
              max={1000}
              step={1}
              value={d.stitchGapPx ?? 0}
              onChange={changeStitchGap}
            />
            <InputNumber
              aria-label="图与图之间的间隙 px"
              min={-10000}
              max={10000}
              step={1}
              value={d.stitchGapPx ?? 0}
              onChange={(value) => changeStitchGap(value ?? 0)}
            />
          </div>
          <small>0 为无缝连接；负数时第 2 张图位于顶层并覆盖第 1 张图。</small>
        </div>
      )}
      <h3>图案适配方式</h3>
      <Select
        aria-label="图案适配方式"
        value={d.adaptationMode ?? "geometry"}
        onChange={(adaptationMode) => update({
          adaptationMode,
          ...(adaptationMode === "ai-geometry" &&
          !["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry")
            ? { aiAdjustment: { ...DEFAULT_GEOMETRY_ADJUSTMENT } }
            : {}),
        })}
        options={[
          { value: "original", label: "原图（手动调整）" },
          { value: "geometry", label: "原图几何映射（推荐）" },
          { value: "ai-geometry", label: "AI 扩图 + 几何映射" },
          { value: "ai", label: "AI 扩图" },
          { value: "local", label: "无损元素排版（程序化）" },
        ]}
      />
      {d.adaptationMode === "original" ? (
        <Alert
          type="info"
          showIcon
          message="原图模式 · 不变形、不重排"
          description="保留上传图片的原始内容与宽高比，只将整张图片居中放入刀模。请直接在预览中拖动，并使用缩放滑动条调整大小。"
        />
      ) : (d.adaptationMode ?? "geometry") === "geometry" ? (
        <>
          <Alert
            type="success"
            showIcon
            message="确定性圆台映射 · 不调用 AI"
            description="严格按杯口径、杯底径和垂直高度计算扇形；保留原图内容与相对排版，不生成红线、文字或新角色，并自动留出安全边距防止边缘裁切。"
          />
          <Space>
            <Switch
              aria-label="保留透明底"
              checked={!!d.transparentOutput}
              onChange={(checked) => update({ transparentOutput: checked })}
            />
            <span>保留透明底</span>
          </Space>
          <p>
            上传透明图片时自动开启；关闭时输出纯白底。对于不透明图片，开启后只移除与边界连通且颜色均匀的背景；角色身体、眼睛和封闭区域中的白色或黑色会保留。
          </p>
        </>
      ) : d.adaptationMode === "ai-geometry" ? (
        <>
          <Alert
            type="info"
            showIcon
            title="原始拼接图扩成矩形 · 确认后才映射"
            description="AI 只接收上传的原始拼接图。结果作为候选保存，不会自动替换当前预览；应用后使用下方几何映射参数和刀模裁切。"
          />
          {d.appliedGeometryCandidateId && !d.geometryOutpaintCandidates?.some(
            (candidate) => candidate.id === d.appliedGeometryCandidateId &&
              candidate.cupKey === JSON.stringify(d.cup) &&
              candidate.sourceRevision === d.sourceRevision,
          ) && <Alert type="warning" title="原图或杯型已变化，已暂时回到原图映射；请重新应用匹配的候选图。" />}
          <Space wrap>
            <span>模型</span>
            <Select
              aria-label="矩形扩图模型"
              value={d.geometryOutpaintModel ?? "gpt-image-2.5-sunburst"}
              onChange={(geometryOutpaintModel: GeometryOutpaintModel) =>
                update({ geometryOutpaintModel })}
              options={[
                { value: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
                { value: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
              ]}
            />
            <span>质量 high · 透明 PNG</span>
          </Space>
          <Input.TextArea
            aria-label="矩形扩图提示词"
            rows={3}
            value={d.geometryOutpaintPrompt ?? DEFAULT_GEOMETRY_OUTPAINT_PROMPT}
            onChange={(event) => update({ geometryOutpaintPrompt: event.target.value })}
          />
          {geometryOutpaintSize.value ? (
            <p>
              最合适矩形比例 {geometryOutpaintSize.value.idealRatio.toFixed(3)}；
              请求尺寸 {geometryOutpaintSize.value.width} × {geometryOutpaintSize.value.height} px。
              {geometryOutpaintSize.value.ratioClamped &&
                " 杯型比例超过模型的 1:3–3:1 范围，边缘仍会有剩余几何变形。"}
              {" 高于 2560×1440 的尺寸属于模型实验范围。"}
            </p>
          ) : <Alert type="warning" title={geometryOutpaintSize.error} />}
          <Space wrap>
            <Button
              type="primary"
              disabled={!(d.originalSource ?? d.source) || !geometryOutpaintSize.value || !!geometryBusy}
              onClick={confirmGeometryGenerate}
            >
              生成矩形扩图候选
            </Button>
            {geometryBusy === d.id && <><Spin size="small" />后台生成中；可切换站内页面<Button onClick={() => geometryJob.current?.abort()}>停止</Button></>}
            {geometryBusy && geometryBusy !== d.id && <span>其他杯型正在后台生成；完成后可切回查看</span>}
          </Space>
        </>
      ) : (d.adaptationMode ?? "geometry") === "local" ? (
        <>
          <Alert
            type="success"
            showIcon
            message="元素分割 + 等比排版 + 弧形安全检测 · 不调用生成式 AI"
            description="保留中央约 60% 的原始组合关系，中心文字、邻近角色与装饰作为整体固定；只扩展外围 20%–30% 的角色，并沿扇形上下弧线排列。最后才用小装饰填补主体之间的空隙，不重画、不拉伸元素。"
          />
          <p>
            适用于透明底、白底或均匀纯色底图片。相互粘连的对象可在确认窗口中手动合并或重新分类。
          </p>
          <Button
            type="primary"
            disabled={!d.source || !!busy}
            onClick={() => setLocalEditor(true)}
          >
            {d.localAdaptation ? "检查／重新无损排布" : "识别元素并无损排布"}
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
          <h3>AI 扩图</h3>
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
          <Checkbox checked disabled>
            AI 扩图结果固定为透明背景
          </Checkbox>
          <Input.TextArea
            aria-label="AI 扩图提示词"
            rows={4}
            readOnly
            value={AI_OUTPAINT_PROMPT}
          />
          <p>
            仅发送当前裁切包围盒中的扇形彩图，不再发送第二张刀模引导图。返回图会直接替换当前彩图，并由本地刀模路径再次精确裁切。
          </p>
          <Button
            disabled={!hasArtwork(d) || !!busy}
            onClick={() =>
              Modal.confirm({
                title: "将发起 1 次付费图片请求",
                content:
                  "将只发送当前已调整好的扇形刀模彩图。AI 返回后会直接替换当前彩图，并自动设为透明背景；不自动重试。",
                onOk: () => run("AI 正在沿刀模扩图", generate),
              })
            }
          >
            AI 扩图生成候选
          </Button>
        </>
      )}
      <h3>刀模底色</h3>
      <Select
        aria-label="刀模底色"
        value={d.canvasBackground ?? "white"}
        onChange={(canvasBackground) => update({ canvasBackground })}
        options={[
          { value: "white", label: "白色（默认）" },
          { value: "transparent", label: "透明" },
          { value: "color", label: "自定义颜色" },
        ]}
      />
      {d.canvasBackground === "color" && (
        <Space>
          <input
            aria-label="刀模自定义底色"
            type="color"
            value={d.canvasBackgroundColor || "#ffffff"}
            onChange={(event) =>
              update({ canvasBackgroundColor: event.target.value })
            }
          />
          <span>{d.canvasBackgroundColor || "#ffffff"}</span>
        </Space>
      )}
      <p>底色只填充刀模内部；刀模外始终透明。</p>
      <h3>输出与 A4</h3>
      {hasArtwork(d) &&
        ((["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry") &&
          (!d.artworkSlots?.length || d.stitchedSource)) ||
          d.stitchedSource ||
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
            {number(
              "水平单轴缩放",
              imageAdjustment.scaleX ?? 1,
              (scaleX) =>
                update({
                  aiAdjustment: { ...imageAdjustment, scaleX },
                }),
              0.2,
              3,
            )}
            {number(
              ["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry")
                ? "沿斜边方向缩放"
                : "垂直单轴缩放",
              imageAdjustment.scaleY ?? 1,
              (scaleY) =>
                update({
                  aiAdjustment: { ...imageAdjustment, scaleY },
                }),
              0.2,
              3,
            )}
            {["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry") && (
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
                    ["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry")
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
          disabled={!hasArtwork(d) || !!busy}
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
  const previewPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = previewSvg.current;
    if (!svg || !g) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };
  const normalizedPreviewPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = previewPoint(event);
    return {
      x: Math.max(0, Math.min(1, point.x / g!.width)),
      y: Math.max(0, Math.min(1, point.y / g!.height)),
    };
  };
  const finishPreviewInteraction = (
    event: React.PointerEvent<SVGSVGElement>,
  ) => {
    const interaction = previewInteraction.current;
    if (!interaction) return;
    if (interaction.kind === "paint" && liveStroke.length) {
      const stroke: ArtworkMaskStroke = {
        id: crypto.randomUUID(),
        mode: previewTool === "restore" ? "restore" : "erase",
        points: liveStroke,
        size: brushSize,
      };
      update({ maskStrokes: [...(d.maskStrokes ?? []), stroke] });
    } else if (interaction.kind === "move") {
      update({
        aiAdjustment: {
          ...interaction.adjustment,
          x: interaction.adjustment.x + interaction.delta.x,
          y: interaction.adjustment.y + interaction.delta.y,
        },
      });
    }
    if (previewSvg.current?.hasPointerCapture(event.pointerId))
      previewSvg.current.releasePointerCapture(event.pointerId);
    previewInteraction.current = undefined;
    setLiveStroke([]);
    setLiveMove(undefined);
  };
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
  const legacySourceOverflow = !!(
    g &&
    sourceSize &&
    !d.artworkSlots?.length &&
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
  const enabledSlots = (d.artworkSlots ?? []).filter((slot) => slot.enabled);
  const slotOverflow = Boolean(
    g &&
    !d.stitchedSource &&
    enabledSlots.some((slot) => {
      const size = slotSizes[slot.id];
      if (!size) return false;
      const placement =
        d.adaptationMode === "original" && enabledSlots.length === 1
          ? (() => {
              const fit = containFit(g, size.width, size.height);
              return {
                x: fit.cx + slot.x,
                y: fit.cy + slot.y,
                width: size.width * fit.scale * slot.scale,
                height: size.height * fit.scale * slot.scale,
                rotation: (slot.rotation * Math.PI) / 180,
              };
            })()
          : artworkSlotPlacement(
              g,
              slot,
              enabledSlots.length,
              size.width,
              size.height,
              d.cup.safe,
              d.cup.coverage,
            );
      const c = Math.cos(placement.rotation),
        s = Math.sin(placement.rotation);
      return [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].some(([sx, sy]) => {
        const x = (sx * placement.width) / 2,
          y = (sy * placement.height) / 2;
        return !inside(
          {
            x: placement.x + x * c - y * s,
            y: placement.y + x * s + y * c,
          },
          g.points,
        );
      });
    }),
  );
  const sourceOverflow = legacySourceOverflow || slotOverflow;
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
      <div className="cup-design-list" aria-label="杯型列表">
        {designs.map((design, index) => (
          <Card
            key={design.id}
            size="small"
            className={
              design.id === d.id ? "cup-design-card active" : "cup-design-card"
            }
            onClick={() => setActiveDesignId(design.id)}
          >
            <Space direction="vertical" size={4}>
              <strong>{design.name || `杯型 ${index + 1}`}</strong>
              <span>
                口径 {design.cup.top} · 底径 {design.cup.bottom} · 高{" "}
                {design.cup.height} mm
              </span>
              <Space onClick={(event) => event.stopPropagation()}>
                <Switch
                  size="small"
                  aria-label={`加入A4混排 ${design.name}`}
                  checked={design.enabled !== false}
                  onChange={(enabled) =>
                    setDesigns((items) =>
                      items.map((item) =>
                        item.id === design.id ? { ...item, enabled } : item,
                      ),
                    )
                  }
                />
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label={`复制杯型 ${design.name}`}
                  onClick={() => {
                    const copy = structuredClone(design);
                    copy.id = crypto.randomUUID();
                    copy.name = `${design.name} 副本`;
                    copy.artworkSlots = copy.artworkSlots?.map((slot) => ({
                      ...slot,
                      id: crypto.randomUUID(),
                    }));
                    setDesigns((items) => [...items, copy]);
                    setActiveDesignId(copy.id);
                  }}
                />
                <Button
                  size="small"
                  danger
                  disabled={designs.length === 1}
                  icon={<DeleteOutlined />}
                  aria-label={`删除杯型 ${design.name}`}
                  onClick={() => {
                    const next = designs.filter(
                      (item) => item.id !== design.id,
                    );
                    setDesigns(next);
                    if (d.id === design.id) setActiveDesignId(next[0].id);
                  }}
                />
              </Space>
            </Space>
          </Card>
        ))}
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            const design = fresh();
            design.name = `杯型 ${designs.length + 1}`;
            setDesigns((items) => [...items, design]);
            setActiveDesignId(design.id);
          }}
        >
          新增杯型
        </Button>
      </div>
      <div className="cup-action-rows">
        <Space wrap>
          <Upload
            showUploadList={false}
            beforeUpload={(file) => upload(file as File, "front")}
            accept="image/png,image/jpeg,image/webp"
          >
            <Button disabled={!ready}>上传／替换第 1 张图</Button>
          </Upload>
          <Upload
            showUploadList={false}
            beforeUpload={(file) => upload(file as File, "back")}
            accept="image/png,image/jpeg,image/webp"
          >
            <Button disabled={!ready}>上传／替换第 2 张图</Button>
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
              <div className="cup-preview-tools">
                <Space wrap>
                  <Button
                    type={previewTool === "move" ? "primary" : "default"}
                    icon={<DragOutlined />}
                    onClick={() => setPreviewTool("move")}
                  >
                    拖动图案
                  </Button>
                  <Button
                    type={previewTool === "erase" ? "primary" : "default"}
                    icon={<BgColorsOutlined />}
                    onClick={() => setPreviewTool("erase")}
                  >
                    黑色擦除
                  </Button>
                  <Button
                    type={previewTool === "restore" ? "primary" : "default"}
                    icon={<BgColorsOutlined />}
                    onClick={() => setPreviewTool("restore")}
                  >
                    白色还原
                  </Button>
                  <Button
                    icon={<UndoOutlined />}
                    disabled={!d.maskStrokes?.length}
                    onClick={() =>
                      update({ maskStrokes: d.maskStrokes?.slice(0, -1) })
                    }
                  >
                    撤销画笔
                  </Button>
                  <Button
                    disabled={!d.maskStrokes?.length}
                    onClick={() => update({ maskStrokes: [] })}
                  >
                    清除蒙版
                  </Button>
                </Space>
                <div className="cup-preview-sliders">
                  <label>
                    图案缩放 {Math.round(imageAdjustment.scale * 100)}%
                    <Slider
                      min={25}
                      max={300}
                      value={Math.round(imageAdjustment.scale * 100)}
                      onChange={(value) =>
                        update({
                          aiAdjustment: {
                            ...imageAdjustment,
                            scale: value / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    水平缩放 {Math.round((imageAdjustment.scaleX ?? 1) * 100)}%
                    <Slider
                      min={20}
                      max={300}
                      value={Math.round((imageAdjustment.scaleX ?? 1) * 100)}
                      onChange={(value) =>
                        update({
                          aiAdjustment: {
                            ...imageAdjustment,
                            scaleX: value / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    {["geometry", "ai-geometry"].includes(d.adaptationMode ?? "geometry")
                      ? "斜边方向缩放"
                      : "垂直缩放"}{" "}
                    {Math.round((imageAdjustment.scaleY ?? 1) * 100)}%
                    <Slider
                      min={20}
                      max={300}
                      value={Math.round((imageAdjustment.scaleY ?? 1) * 100)}
                      onChange={(value) =>
                        update({
                          aiAdjustment: {
                            ...imageAdjustment,
                            scaleY: value / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    画笔大小 {Math.round(brushSize * 100)}%
                    <Slider
                      min={1}
                      max={20}
                      value={Math.round(brushSize * 100)}
                      onChange={(value) => setBrushSize(value / 100)}
                    />
                  </label>
                </div>
                <span className="cup-preview-help">
                  拖动时会实时显示位置；大小请使用缩放滑动条。黑色擦除内容，白色恢复被擦除区域。
                </span>
              </div>
              <div className="cup-canvas">
                <svg
                  ref={previewSvg}
                  viewBox={`-5 -5 ${g.width + 10} ${g.height + 10}`}
                  aria-label="杯身展开刀模"
                  className={`cup-preview-${previewTool}`}
                  onPointerDown={(event) => {
                    if (!preview) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (previewTool === "move") {
                      previewInteraction.current = {
                        kind: "move",
                        start: previewPoint(event),
                        adjustment: { ...imageAdjustment },
                        delta: { x: 0, y: 0 },
                      };
                    } else {
                      previewInteraction.current = {
                        kind: "paint",
                        pointerId: event.pointerId,
                      };
                      setLiveStroke([normalizedPreviewPoint(event)]);
                    }
                  }}
                  onPointerMove={(event) => {
                    const interaction = previewInteraction.current;
                    if (!interaction) return;
                    if (interaction.kind === "move") {
                      const point = previewPoint(event);
                      interaction.delta = {
                        x: point.x - interaction.start.x,
                        y: point.y - interaction.start.y,
                      };
                      setLiveMove(interaction.delta);
                    } else {
                      const point = normalizedPreviewPoint(event);
                      setLiveStroke((points) => [...points, point]);
                    }
                  }}
                  onPointerUp={finishPreviewInteraction}
                  onPointerCancel={finishPreviewInteraction}
                >
                  <image
                    href={preview || undefined}
                    width={g.width}
                    height={g.height}
                    transform={
                      liveMove
                        ? `translate(${liveMove.x} ${liveMove.y})`
                        : undefined
                    }
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
                  {liveStroke.length > 0 && (
                    <polyline
                      points={liveStroke
                        .map(
                          (point) =>
                            `${point.x * g.width},${point.y * g.height}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke={previewTool === "erase" ? "#000" : "#fff"}
                      strokeWidth={brushSize * Math.min(g.width, g.height)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="cup-live-mask-stroke"
                    />
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
              {sourceSize && (!d.artworkSlots?.length || d.stitchedSource) && (
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
                              {!hasArtwork(design) && (
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
      {!!d.geometryOutpaintCandidates?.length && (
        <Card title="矩形扩图候选（手动应用）">
          <Space wrap align="start">
            {d.geometryOutpaintCandidates.map((candidate, index) => {
              const current = candidate.cupKey === JSON.stringify(d.cup) &&
                candidate.sourceRevision === d.sourceRevision;
              const sizeValid = candidate.width === candidate.requestedWidth &&
                candidate.height === candidate.requestedHeight;
              return (
                <div key={candidate.id} className="cup-geometry-candidate">
                  <BlobPreview blob={candidate.blob} />
                  <p>候选 {index + 1} · {candidate.model}<br />{candidate.width} × {candidate.height} px</p>
                  {!current && <p>原图或杯型已变化，不能直接应用</p>}
                  {!sizeValid && <p>返回尺寸与请求不符，不能直接应用</p>}
                  <Button
                    type={d.appliedGeometryCandidateId === candidate.id ? "primary" : "default"}
                    disabled={!current || !sizeValid}
                    onClick={() => update({
                      adopted: candidate.blob,
                      adoptedFrame: undefined,
                      appliedGeometryCandidateId: candidate.id,
                      adaptationMode: "ai-geometry",
                      aiAdjustment: { ...candidate.adjustment },
                      maskStrokes: [],
                      transparentOutput: true,
                    })}
                  >应用并几何映射</Button>
                </div>
              );
            })}
            <Space orientation="vertical">
              <Button disabled={!!geometryBusy} onClick={confirmGeometryGenerate}>重试（使用当前提示词）</Button>
              <Button onClick={() => update({
                adopted: undefined,
                appliedGeometryCandidateId: undefined,
                adaptationMode: "ai-geometry",
              })}>使用原图</Button>
            </Space>
          </Space>
        </Card>
      )}
      {d.aiResults.length > 0 && (
        <Card title="AI 扩图历史（最新结果已直接替换当前图）">
          <Space wrap>
            {preview ? (
              <div>
                <Image width={140} src={preview} alt="原始正背拼接" />
                <p>原始正背拼接</p>
              </div>
            ) : null}
            {d.aiResults.map((blob, i) => (
              <div key={i}>
                <BlobPreview blob={blob} />
                <p>AI 扩图候选 {i + 1}</p>
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
        <CupWrapSeamPreview
          open
          cup={d.cup}
          texture={seamTexture}
          textureHasTransparency={!!d.transparentOutput}
          initialShowGlass
          onClose={() => setSeamOpen(false)}
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
