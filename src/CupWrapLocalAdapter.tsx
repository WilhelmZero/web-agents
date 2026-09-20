import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  Switch,
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
import { fixedPathDividerPoints } from "./services/cupWrap/localAdaptation";

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
  showPaths,
  pathCount,
  averageHeight,
  pathGap,
  pathOffsets,
  selectedId,
  onSelect,
  onLayersChange,
  onReplace,
  onDuplicate,
  onDelete,
}: {
  objects: LocalObject[];
  layers: LocalAdaptation["layers"];
  cup: CupParams;
  background: string;
  showPaths: boolean;
  pathCount: number;
  averageHeight: number;
  pathGap: number;
  pathOffsets: number[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onLayersChange: (layers: LocalAdaptation["layers"]) => void;
  onReplace: (layerId: string, objectId: string) => void;
  onDuplicate: (layerId: string) => void;
  onDelete: (layerId: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({}),
    [contextMenu, setContextMenu] = useState<
      { id: string; x: number; y: number } | undefined
    >();
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const o of objects) next[o.id] = URL.createObjectURL(o.blob);
    setUrls(next);
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  }, [objects]);
  const g = geometry(cup),
    byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]),
    dividers = useMemo(
      () =>
        fixedPathDividerPoints(
          cup,
          pathCount,
          averageHeight,
          pathGap,
          pathOffsets,
        ),
      [cup, pathCount, averageHeight, pathGap, pathOffsets],
    ),
    drag = useRef<
      { id: string; startX: number; startY: number; x: number; y: number } | undefined
    >(undefined);
  const point = (event: ReactPointerEvent<SVGImageElement>) => {
    const svg = event.currentTarget.ownerSVGElement!,
      p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  };
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);
  return (
    <>
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
      {showPaths &&
        dividers.map((path) => (
          <polyline
            key={path.pathIndex}
            points={path.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#1677ff"
            strokeWidth="0.35"
            strokeDasharray="2 1"
            pointerEvents="none"
          />
        ))}
      {layers.map((l) => {
        const id = l.sourceObjectId ?? l.id.split("-copy-")[0],
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
            transform={`rotate(${l.rotation} ${l.x} ${l.y})`}
            opacity={selectedId === l.id ? 0.78 : 1}
            stroke={selectedId === l.id ? "#1677ff" : undefined}
            style={{ cursor: "move", outline: selectedId === l.id ? "1px solid #1677ff" : undefined }}
            onPointerDown={(event) => {
              if (event.button === 2) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const p = point(event);
              drag.current = { id: l.id, startX: p.x, startY: p.y, x: l.x, y: l.y };
              onSelect(l.id);
            }}
            onPointerMove={(event) => {
              const state = drag.current;
              if (!state || state.id !== l.id) return;
              const p = point(event);
              onLayersChange(
                layers.map((layer) =>
                  layer.id === l.id
                    ? {
                        ...layer,
                        x: state.x + p.x - state.startX,
                        y: state.y + p.y - state.startY,
                        manual: true,
                      }
                    : layer,
                ),
              );
            }}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(l.id);
              setContextMenu({ id: l.id, x: event.clientX, y: event.clientY });
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const objectId = event.dataTransfer.getData("application/x-cup-object");
              if (objectId) onReplace(l.id, objectId);
            }}
          />
        );
      })}
    </svg>
      {contextMenu && (
        <div
          role="menu"
          aria-label="主体右键菜单"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 2100,
            minWidth: 120,
            padding: 4,
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 6px 20px rgba(0,0,0,.16)",
          }}
        >
          <Button
            type="text"
            block
            onClick={() => {
              onDuplicate(contextMenu.id);
              setContextMenu(undefined);
            }}
          >
            复制主体
          </Button>
          <Button
            type="text"
            danger
            block
            onClick={() => {
              onDelete(contextMenu.id);
              setContextMenu(undefined);
            }}
          >
            删除主体
          </Button>
        </div>
      )}
    </>
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
    [fill, setFill] = useState(
      initial?.fill === 40 ? 70 : initial?.fill ?? 70,
    ),
    [scale, setScale] = useState(initial?.scale ?? 1),
    [seed, setSeed] = useState(initial?.seed ?? 1),
    [pathMode, setPathMode] = useState<"auto" | "manual">(
      initial?.pathMode ?? "auto",
    ),
    [pathCount, setPathCount] = useState(initial?.pathCount ?? 3),
    [actualPathCount, setActualPathCount] = useState(initial?.pathCount ?? 3),
    [pathGap, setPathGap] = useState(initial?.pathGap ?? 1),
    [pathOffsets, setPathOffsets] = useState<number[]>(
      initial?.pathOffsets ?? [],
    ),
    [itemGap, setItemGap] = useState(initial?.itemGap ?? initial?.gap ?? 1),
    [showPaths, setShowPaths] = useState(initial?.showPaths ?? true),
    [averageHeight, setAverageHeight] = useState(
      initial?.pathAverageHeight ?? 10,
    ),
    [backgroundMode, setBackgroundMode] = useState(
      initial?.backgroundMode ?? "white",
    ),
    [backgroundColor, setBackgroundColor] = useState(
      initial?.backgroundColor ?? "#ffffff",
    ),
    [layers, setLayers] = useState(initial?.layers ?? []),
    [unplaced, setUnplaced] = useState<string[]>(initial?.unplaced ?? []),
    [selectedObjects, setSelectedObjects] = useState<string[]>([]),
    [selectedLayerId, setSelectedLayerId] = useState<string>();
  const active = useMemo(
    () => analysis?.objects.filter((o) => o.role !== "excluded").length ?? 0,
    [analysis],
  ),
    selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const deleteLayer = (layerId: string) => {
    setLayers((items) => items.filter((layer) => layer.id !== layerId));
    setSelectedLayerId((id) => (id === layerId ? undefined : id));
  };
  const duplicateLayer = (layerId: string) => {
    const sourceLayer = layers.find((layer) => layer.id === layerId);
    if (!sourceLayer) return;
    const copy = {
      ...sourceLayer,
      id: `manual-copy-${crypto.randomUUID()}`,
      x: sourceLayer.x + 3,
      y: sourceLayer.y + 3,
      autoX: sourceLayer.x + 3,
      autoY: sourceLayer.y + 3,
      manual: true,
    };
    setLayers((items) => [...items, copy]);
    setSelectedLayerId(copy.id);
  };
  const replaceLayer = (layerId: string, objectId: string) => {
    const object = analysis?.objects.find((item) => item.id === objectId);
    if (!object || object.role === "excluded") return;
    setLayers((items) =>
      items.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              blob: object.blob,
              sourceObjectId: object.id,
              manual: true,
            }
          : layer,
      ),
    );
    setError("已替换当前实例；请检查新主体与相邻元素是否冲突。");
  };
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
        pathCount: number;
        averageHeight: number;
      }>({
        kind: "localArrange",
        input: {
          ...analysis,
          fill,
          gap: itemGap,
          scale,
          seed: nextSeed,
          pathMode,
          pathCount,
          pathGap,
          pathOffsets,
          itemGap,
        },
        cup,
      });
      setLayers(result.layers);
      setUnplaced(result.unplaced);
      setActualPathCount(result.pathCount);
      setAverageHeight(result.averageHeight);
      setSelectedLayerId(undefined);
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
              o.id === id
                ? { ...o, role: value }
                : value === "anchor" && o.role === "anchor"
                  ? { ...o, role: "main" }
                  : o,
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
          gap: itemGap,
          scale,
          seed,
          pathMode,
          pathCount: actualPathCount,
          pathAverageHeight: averageHeight,
          pathGap,
          pathOffsets,
          itemGap,
          showPaths,
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
                draggable={o.role !== "excluded"}
                onDragStart={(event) =>
                  event.dataTransfer.setData("application/x-cup-object", o.id)
                }
                title="拖到预览中的元素上可替换该实例"
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
                      { value: "anchor", label: "中心主视觉" },
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
            message="最大主体按原图位置映射并跨行占位；其他主体按固定顺序排列在相邻同心弧辅助线之间。主体排布不使用随机数，小装饰仍可随机填缝。"
          />
          <Space wrap align="start">
            <label>
              路径数量
              <Select
                style={{ width: 120 }}
                value={pathMode}
                onChange={setPathMode}
                options={[
                  { value: "auto", label: "自动计算" },
                  { value: "manual", label: "手动设置" },
                ]}
              />
            </label>
            <label>
              路径条数
              <InputNumber
                min={1}
                max={30}
                value={pathMode === "auto" ? actualPathCount : pathCount}
                onChange={(value) => {
                  setPathCount(value ?? 1);
                  setPathMode("manual");
                }}
              />
            </label>
            <label>
              路径间距 mm
              <InputNumber
                min={0}
                max={50}
                value={pathGap}
                onChange={(value) => setPathGap(value ?? 1)}
              />
            </label>
            <label>
              同路径主体间距 mm
              <InputNumber
                min={0}
                max={50}
                value={itemGap}
                onChange={(value) => setItemGap(value ?? 1)}
              />
            </label>
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
              装饰填缝种子
              <InputNumber value={seed} onChange={(v) => setSeed(v ?? 1)} />
            </label>
            <label>
              显示路径辅助线
              <Switch checked={showPaths} onChange={setShowPaths} />
            </label>
          </Space>
          <div style={{ margin: "10px 0" }}>
            <strong>每条路径位置</strong>
            <Space wrap style={{ marginLeft: 8 }}>
              {Array.from(
                {
                  length:
                    pathMode === "auto" ? actualPathCount : pathCount,
                },
                (_unused, index) => (
                  <label key={index}>
                    路径 {index + 1} 偏移 mm
                    <InputNumber
                      min={-50}
                      max={50}
                      step={0.5}
                      value={pathOffsets[index] ?? 0}
                      onChange={(value) =>
                        setPathOffsets((current) => {
                          const next = [...current];
                          next[index] = value ?? 0;
                          return next;
                        })
                      }
                    />
                  </label>
                ),
              )}
            </Space>
          </div>
          <Space wrap>
            <Button
              type="primary"
              loading={busy === "正在计算刀模排布"}
              onClick={() => arrange()}
            >
              生成排布
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
              message={`${unplaced.length} 个主体无法完整放入，已暂停装饰填充；请降低整体缩放、间距或排除素材`}
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
            <>
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
                showPaths={showPaths}
                pathCount={actualPathCount}
                averageHeight={averageHeight}
                pathGap={pathGap}
                pathOffsets={pathOffsets}
                selectedId={selectedLayerId}
                onSelect={setSelectedLayerId}
                onLayersChange={setLayers}
                onReplace={replaceLayer}
                onDuplicate={duplicateLayer}
                onDelete={deleteLayer}
              />
              <p>
                当前使用 {actualPathCount} 条主体路径，主体位于相邻辅助线之间。拖动可实时微调；右键可复制或删除主体。
              </p>
              {selectedLayer && (
                <div className="cup-local-layer-editor">
                  <h4>当前元素微调</h4>
                  <Space wrap align="start">
                    <label>
                      X mm
                      <InputNumber
                        value={selectedLayer.x}
                        onChange={(x) =>
                          setLayers((items) =>
                            items.map((layer) =>
                              layer.id === selectedLayer.id
                                ? { ...layer, x: x ?? layer.x, manual: true }
                                : layer,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Y mm
                      <InputNumber
                        value={selectedLayer.y}
                        onChange={(y) =>
                          setLayers((items) =>
                            items.map((layer) =>
                              layer.id === selectedLayer.id
                                ? { ...layer, y: y ?? layer.y, manual: true }
                                : layer,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      宽度 mm
                      <InputNumber
                        min={0.1}
                        value={selectedLayer.width}
                        onChange={(width) =>
                          setLayers((items) =>
                            items.map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    width: width ?? layer.width,
                                    manual: true,
                                  }
                                : layer,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      旋转 °
                      <InputNumber
                        min={-180}
                        max={180}
                        value={selectedLayer.rotation}
                        onChange={(rotation) =>
                          setLayers((items) =>
                            items.map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    rotation: rotation ?? layer.rotation,
                                    manual: true,
                                  }
                                : layer,
                            ),
                          )
                        }
                      />
                    </label>
                    <Button
                      onClick={() =>
                        setLayers((items) =>
                          items.map((layer) =>
                            layer.id === selectedLayer.id
                              ? {
                                  ...layer,
                                  x: layer.autoX ?? layer.x,
                                  y: layer.autoY ?? layer.y,
                                  width: layer.autoWidth ?? layer.width,
                                  rotation: layer.autoRotation ?? layer.rotation,
                                  manual: false,
                                }
                              : layer,
                          ),
                        )
                      }
                    >
                      恢复自动位置
                    </Button>
                    <Button
                      danger
                      onClick={() => deleteLayer(selectedLayer.id)}
                    >
                      删除当前实例
                    </Button>
                  </Space>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
