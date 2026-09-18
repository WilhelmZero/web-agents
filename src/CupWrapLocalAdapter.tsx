import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Image,
  InputNumber,
  Modal,
  Select,
  Slider,
  Space,
  Tag,
} from "antd";
import {
  geometry,
  pathData,
  type CupParams,
} from "./services/cupWrap/geometry";
import type {
  LocalAdaptation,
  LocalObject,
  LocalObjectRole,
} from "./services/cupWrap/types";
import { work } from "./services/cupWrap/client";

function Preview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url)
    return <div style={{ width: 86, height: 70, background: "#eee" }} />;
  return (
    <Image
      src={url}
      width={86}
      height={70}
      style={{ objectFit: "contain", background: "#eee" }}
    />
  );
}
function LayoutPreview({
  objects,
  layers,
  cup,
  background,
}: {
  objects: LocalObject[];
  layers: LocalAdaptation["layers"];
  cup: CupParams;
  background: string;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const o of objects) next[o.id] = URL.createObjectURL(o.blob);
    setUrls(next);
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  }, [objects]);
  const g = geometry(cup),
    byId = new Map(objects.map((o) => [o.id, o]));
  return (
    <svg
      aria-label="本地排布预览"
      viewBox={`0 0 ${g.width} ${g.height}`}
      style={{
        width: "100%",
        maxHeight: 320,
        background: "#eee",
        marginTop: 12,
      }}
    >
      <path
        d={pathData(g.points)}
        fill={background}
        stroke="#999"
        strokeDasharray="1 1"
      />
      {layers.map((l) => {
        const id = l.id.split("-copy-")[0],
          o = byId.get(id),
          url = urls[id];
        if (!o || !url) return null;
        const h = (l.width * o.rect.height) / o.rect.width;
        return (
          <image
            key={l.id}
            href={url}
            x={l.x - l.width / 2}
            y={l.y - h / 2}
            width={l.width}
            height={h}
          />
        );
      })}
    </svg>
  );
}
export default function CupWrapLocalAdapter({
  source,
  cup,
  initial,
  onClose,
  onApply,
}: {
  source: Blob;
  cup: CupParams;
  initial?: LocalAdaptation;
  onClose: () => void;
  onApply: (v: LocalAdaptation) => void;
}) {
  const [analysis, setAnalysis] = useState<Pick<
      LocalAdaptation,
      "sourceWidth" | "sourceHeight" | "background" | "confidence" | "objects"
    > | null>(initial ?? null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [fill, setFill] = useState(initial?.fill ?? 40),
    [gap, setGap] = useState(initial?.gap ?? 2),
    [scale, setScale] = useState(initial?.scale ?? 1),
    [seed, setSeed] = useState(initial?.seed ?? 1),
    [backgroundMode, setBackgroundMode] = useState(
      initial?.backgroundMode ?? "white",
    ),
    [backgroundColor, setBackgroundColor] = useState(
      initial?.backgroundColor ?? "#ffffff",
    ),
    [layers, setLayers] = useState(initial?.layers ?? []),
    [unplaced, setUnplaced] = useState<string[]>(initial?.unplaced ?? []),
    [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  const active = useMemo(
    () => analysis?.objects.filter((o) => o.role !== "excluded").length ?? 0,
    [analysis],
  );
  async function analyze() {
    setBusy("正在识别物体");
    setError("");
    try {
      setAnalysis(await work({ kind: "localAnalyze", source }));
      setLayers([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function arrange(nextSeed = seed) {
    if (!analysis) return;
    setBusy("正在计算刀模排布");
    setError("");
    try {
      const result = await work<{
        layers: LocalAdaptation["layers"];
        unplaced: string[];
      }>({
        kind: "localArrange",
        input: { ...analysis, fill, gap, scale, seed: nextSeed },
        cup,
      });
      setLayers(result.layers);
      setUnplaced(result.unplaced);
      setSeed(nextSeed);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  const role = (id: string, value: LocalObjectRole) =>
    setAnalysis((v) =>
      v
        ? {
            ...v,
            objects: v.objects.map((o) =>
              o.id === id ? { ...o, role: value } : o,
            ),
          }
        : v,
    );
  async function mergeSelected() {
    if (!analysis || selectedObjects.length < 2) return;
    const chosen = analysis.objects.filter((o) =>
        selectedObjects.includes(o.id),
      ),
      x = Math.min(...chosen.map((o) => o.rect.x)),
      y = Math.min(...chosen.map((o) => o.rect.y)),
      right = Math.max(...chosen.map((o) => o.rect.x + o.rect.width)),
      bottom = Math.max(...chosen.map((o) => o.rect.y + o.rect.height)),
      canvas = document.createElement("canvas");
    canvas.width = right - x;
    canvas.height = bottom - y;
    const ctx = canvas.getContext("2d")!;
    for (const o of chosen) {
      const image = await createImageBitmap(o.blob);
      ctx.drawImage(image, o.rect.x - x, o.rect.y - y);
      image.close();
    }
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((v) => resolve(v!), "image/png"),
    );
    setAnalysis({
      ...analysis,
      objects: [
        ...analysis.objects.filter((o) => !selectedObjects.includes(o.id)),
        {
          id: crypto.randomUUID(),
          blob,
          rect: { x, y, width: right - x, height: bottom - y },
          role: "main",
        },
      ],
    });
    setSelectedObjects([]);
    setLayers([]);
  }
  return (
    <Modal
      open
      width={1080}
      title="无损元素排版 · 分割与识别确认"
      onCancel={onClose}
      okText="采用无损排布"
      okButtonProps={{
        disabled: !analysis || !layers.length || !!unplaced.length,
      }}
      onOk={() =>
        analysis &&
        onApply({
          ...analysis,
          layers,
          fill,
          gap,
          scale,
          seed,
          backgroundMode,
          backgroundColor,
          cupKey: JSON.stringify(cup),
          unplaced,
        })
      }
    >
      <p>
        全程在浏览器本地处理，不调用生成式 AI，也不会重画或拉伸元素。请确认主体和可复制的小装饰；相互粘连的内容会作为一个完整物体。
      </p>
      <Space wrap>
        <Button loading={busy === "正在识别物体"} onClick={analyze}>
          {analysis ? "重新分析" : "分析素材"}
        </Button>
        {analysis && (
          <>
            <Tag color="blue">识别 {analysis.objects.length} 个</Tag>
            <Tag color="green">启用 {active} 个</Tag>
            <Tag>背景置信度 {Math.round(analysis.confidence * 100)}%</Tag>
          </>
        )}
      </Space>
      {error && <Alert type="error" showIcon message={error} />}{" "}
      {busy && <Alert type="info" showIcon message={busy} />}
      {analysis && (
        <>
          <Space wrap>
            <Button
              disabled={selectedObjects.length < 2}
              onClick={() => mergeSelected().catch((e) => setError(String(e)))}
            >
              合并选中的误拆区域
            </Button>
            <span>已选择 {selectedObjects.length} 个</span>
          </Space>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
              gap: 8,
              maxHeight: 330,
              overflow: "auto",
              marginTop: 12,
            }}
          >
            {analysis.objects.map((o: LocalObject, i) => (
              <div
                key={o.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: 8,
                  display: "flex",
                  gap: 8,
                }}
              >
                <Preview blob={o.blob} />
                <div>
                  <Checkbox
                    checked={selectedObjects.includes(o.id)}
                    onChange={(e) =>
                      setSelectedObjects((v) =>
                        e.target.checked
                          ? [...v, o.id]
                          : v.filter((id) => id !== o.id),
                      )
                    }
                  >
                    选择
                  </Checkbox>
                  <strong>物体 {i + 1}</strong>
                  <Select
                    size="small"
                    value={o.role}
                    onChange={(v) => role(o.id, v)}
                    options={[
                      { value: "main", label: "主体" },
                      { value: "decoration", label: "小装饰·可复制" },
                      { value: "excluded", label: "排除" },
                    ]}
                  />
                  <div style={{ fontSize: 12, color: "#777" }}>
                    {o.rect.width}×{o.rect.height}px
                  </div>
                </div>
              </div>
            ))}
          </div>
          <h4>排布参数</h4>
          <Alert
            type="info"
            showIcon
            message="中心主体优先保持，外围元素沿扇形横截面重新定位；所有对象统一等比缩放，完整外框不得进入安全边。"
          />
          <Space wrap align="start">
            <label>
              空白填充强度
              <Slider
                style={{ width: 180 }}
                min={0}
                max={100}
                value={fill}
                onChange={setFill}
              />
            </label>
            <label>
              最小间距 mm
              <InputNumber
                min={0}
                max={20}
                value={gap}
                onChange={(v) => setGap(v ?? 2)}
              />
            </label>
            <label>
              整体等比缩放
              <InputNumber
                min={0.2}
                max={2}
                step={0.05}
                value={scale}
                onChange={(v) => setScale(v ?? 1)}
              />
            </label>
            <label>
              随机种子
              <InputNumber value={seed} onChange={(v) => setSeed(v ?? 1)} />
            </label>
          </Space>
          <Space wrap>
            <Button
              type="primary"
              loading={busy === "正在计算刀模排布"}
              onClick={() => arrange()}
            >
              生成排布
            </Button>
            <Button disabled={!layers.length} onClick={() => arrange(seed + 1)}>
              换一版排布
            </Button>
            <Select
              value={backgroundMode}
              onChange={setBackgroundMode}
              options={[
                { value: "transparent", label: "透明底" },
                { value: "white", label: "纯白底" },
                { value: "color", label: "自定义颜色" },
              ]}
            />
            {backgroundMode === "color" && (
              <input
                aria-label="本地排布背景色"
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
              />
            )}
          </Space>
          {unplaced.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`${unplaced.length} 个主体无法完整放入，请降低整体缩放、间距或排除素材`}
            />
          )}{" "}
          {layers.length > 0 && !unplaced.length && (
            <Alert
              type="success"
              showIcon
              message={`已排入 ${layers.length} 个对象，可采用后在主预览检查`}
            />
          )}
          {layers.length > 0 && (
            <LayoutPreview
              objects={analysis.objects}
              layers={layers}
              cup={cup}
              background={
                backgroundMode === "transparent"
                  ? "transparent"
                  : backgroundMode === "white"
                    ? "#fff"
                    : backgroundColor
              }
            />
          )}
        </>
      )}
    </Modal>
  );
}
