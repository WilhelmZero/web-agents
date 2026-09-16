import {
  DeleteOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Image,
  InputNumber,
  Progress,
  Radio,
  Segmented,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeBorderMatte,
  restoreTransparentBackground,
} from "./services/transparentImageEdit";
import { hasUsableTransparency } from "./services/backgroundRemoval";
import {
  DEFAULT_SPOT_PLACEMENT,
  SPOT_TIFF_HEIGHT,
  SPOT_TIFF_WIDTH,
  clampSpotPlacement,
  containSpotLayer,
  type SpotPlacement,
  type SpotRgbMode,
} from "./services/spotColorTiff";
import type {
  SpotTiffWorkerRequest,
  SpotTiffWorkerResponse,
} from "./services/spotColorTiff.worker";
import {
  pickWritableDirectory,
  supportsDirectoryExport,
  writeUniqueFile,
} from "./services/directoryExport";
import { reportTaskProgress } from "./services/taskProgress";
import { createId, sanitizeFileName } from "./utils";

const { Paragraph, Text, Title } = Typography;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

type ItemStatus = "preparing" | "ready" | "exporting" | "success" | "failed" | "invalid";
interface LogoItem {
  id: string;
  file: File;
  processedBlob?: Blob;
  sourceUrl: string;
  processedUrl?: string;
  width?: number;
  height?: number;
  background: "transparent" | "black" | "unknown";
  status: ItemStatus;
  progress: number;
  stage?: string;
  outputName?: string;
  error?: string;
}

interface DragState {
  mode: "move" | "resize";
  pointerId: number;
  clientX: number;
  clientY: number;
  placement: SpotPlacement;
}

function sourceTiffName(name: string) {
  return `${sanitizeFileName(name.replace(/\.[^.]+$/, ""))}.tif`;
}

function workerEncode(request: SpotTiffWorkerRequest, onProgress: (stage: string, percent: number) => void) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(new URL("./services/spotColorTiff.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<SpotTiffWorkerResponse>) => {
      if (data.id !== request.id) return;
      if (data.type === "progress") onProgress(data.stage, data.percent);
      else if (data.type === "success") {
        worker.terminate();
        resolve(data.buffer);
      } else {
        worker.terminate();
        reject(new Error(data.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "TIFF Worker 执行失败"));
    };
    worker.postMessage(request);
  });
}

export default function SpotColorTiffComposer() {
  const { message } = App.useApp();
  const [items, setItems] = useState<LogoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [placement, setPlacement] = useState<SpotPlacement>({ ...DEFAULT_SPOT_PLACEMENT });
  const [rgbMode, setRgbMode] = useState<SpotRgbMode>("color");
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patchItem = (id: string, patch: Partial<LogoItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
      });
    },
    [],
  );

  const readyItems = items.filter((item) => item.status === "ready" || item.status === "success" || item.status === "failed");
  const selectedCandidate = items.find((item) => item.id === selectedId);
  const selected = selectedCandidate?.processedBlob ? selectedCandidate : readyItems.find((item) => item.processedBlob);
  const completed = items.filter((item) => item.status === "success" || item.status === "failed").length;
  const failed = items.filter((item) => item.status === "failed" || item.status === "invalid").length;
  useEffect(() => {
    reportTaskProgress({ id: "spot-color-tiff", label: "专色 TIFF 制作", completed, total: items.length, failed, running: busy });
  }, [busy, completed, failed, items.length]);

  const displayedBounds = useMemo(
    () =>
      selected?.width && selected.height
        ? containSpotLayer(selected.width, selected.height, placement)
        : undefined,
    [placement, selected?.height, selected?.width],
  );

  const prepareFile = async (file: File) => {
    const id = createId();
    const sourceUrl = URL.createObjectURL(file);
    const initial: LogoItem = {
      id,
      file,
      sourceUrl,
      status: "preparing",
      progress: 5,
      stage: "正在检查透明通道",
      background: "unknown",
    };
    setItems((current) => [...current, initial]);
    setSelectedId((current) => current || id);
    try {
      const transparent = await hasUsableTransparency(file);
      let processedBlob: Blob = file;
      let background: LogoItem["background"] = "transparent";
      if (!transparent) {
        patchItem(id, { stage: "正在验证黑色背景", progress: 25 });
        const analysis = await analyzeBorderMatte(file);
        if (!analysis.isBlack || analysis.confidence < 0.65) {
          throw new Error(`仅支持透明底或均匀黑底；当前边缘背景置信度 ${Math.round(analysis.confidence * 100)}%`);
        }
        processedBlob = await restoreTransparentBackground(file, analysis.matte);
        background = "black";
      }
      const bitmap = await createImageBitmap(processedBlob);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const processedUrl = URL.createObjectURL(processedBlob);
      patchItem(id, {
        processedBlob,
        processedUrl,
        width,
        height,
        background,
        status: "ready",
        progress: 100,
        stage: background === "black" ? "黑底已通过 HSV 透明化" : "已保留原透明通道",
      });
    } catch (error) {
      patchItem(id, {
        status: "invalid",
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
        stage: "素材不可用",
      });
    }
  };

  const addFiles = (files: File[]) => {
    const valid = files.filter((file) => {
      if (!ACCEPTED.includes(file.type) || !file.size || file.size > 50 * 1024 * 1024) {
        message.error(`${file.name}：仅支持 50MB 内的 PNG、JPEG、WebP`);
        return false;
      }
      return true;
    });
    void Promise.all(valid.map(prepareFile));
    return false;
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.sourceUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
      }
      return current.filter((entry) => entry.id !== id);
    });
    if (selectedId === id) setSelectedId(undefined);
  };

  const updatePlacement = (patch: Partial<SpotPlacement>) =>
    setPlacement((current) => clampSpotPlacement({ ...current, ...patch }));

  const resetPlacement = () => setPlacement({ ...DEFAULT_SPOT_PLACEMENT });
  const onPointerDown = (event: React.PointerEvent<HTMLElement>, mode: DragState["mode"]) => {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      placement,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const node = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !node) return;
    const rect = node.getBoundingClientRect();
    const dx = ((event.clientX - drag.clientX) / rect.width) * SPOT_TIFF_WIDTH;
    const dy = ((event.clientY - drag.clientY) / rect.height) * SPOT_TIFF_HEIGHT;
    if (drag.mode === "move") {
      setPlacement(
        clampSpotPlacement({
          ...drag.placement,
          centerX: drag.placement.centerX + dx,
          centerY: drag.placement.centerY + dy,
        }),
      );
    } else {
      const ratio = Math.max(
        0.05,
        1 + Math.max(dx / drag.placement.frameWidth, dy / drag.placement.frameHeight),
      );
      setPlacement(
        clampSpotPlacement({
          ...drag.placement,
          frameWidth: drag.placement.frameWidth * ratio,
          frameHeight: drag.placement.frameHeight * ratio,
        }),
      );
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      canvasRef.current?.releasePointerCapture(event.pointerId);
      dragRef.current = undefined;
    }
  };

  const exportAll = async () => {
    const targets = items.filter((item) => item.processedBlob && item.status !== "invalid");
    if (!targets.length || busy) return;
    try {
      const directory = await pickWritableDirectory();
      setBusy(true);
      for (const item of targets) {
        patchItem(item.id, { status: "exporting", progress: 1, stage: "正在排队编码", error: undefined });
        try {
          const buffer = await workerEncode(
            {
              id: item.id,
              blob: item.processedBlob!,
              sourceName: item.file.name,
              placement,
              rgbMode,
            },
            (stage, percent) => patchItem(item.id, { stage, progress: percent }),
          );
          patchItem(item.id, { stage: "正在写入输出文件", progress: 97 });
          const outputName = await writeUniqueFile(directory, sourceTiffName(item.file.name), buffer);
          patchItem(item.id, { status: "success", stage: "导出完成", progress: 100, outputName });
        } catch (error) {
          patchItem(item.id, {
            status: "failed",
            progress: 0,
            stage: "导出失败",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      message.success("批量 TIFF 已写入所选文件夹");
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError")
        message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const scalePercent = Math.round((placement.frameWidth / DEFAULT_SPOT_PLACEMENT.frameWidth) * 100);
  const readyCount = items.filter((item) => item.processedBlob).length;

  return (
    <div className="spot-tiff-page">
      <section className="hero-strip spot-tiff-hero">
        <div>
          <Title level={2}>批量制作可编辑专色 TIFF</Title>
          <Paragraph className="hero-description">
            自动识别透明底或黑底 Logo，生成 800 DPI、智能对象图层与双专色通道的印刷文件。
          </Paragraph>
        </div>
        <div className="spot-tiff-hero-mark" aria-hidden="true">TIF</div>
      </section>

      {!supportsDirectoryExport() ? (
        <Alert
          showIcon
          type="warning"
          title="当前浏览器不支持文件夹写入"
          description="请使用最新版 Chrome 或 Edge 打开本工具；大尺寸 TIFF 不会降级为高内存 ZIP。"
        />
      ) : null}

      <Card className="workflow-card" title="1. 导入 Logo 素材" extra={<Text type="secondary">{items.length} 张</Text>}>
        <Upload.Dragger
          accept={ACCEPTED.join(",")}
          multiple
          showUploadList={false}
          beforeUpload={(file, files) => (files[0]?.uid === file.uid ? addFiles(files as File[]) : false)}
        >
          <FileImageOutlined style={{ fontSize: 32 }} />
          <p>拖拽或点击批量上传 PNG / JPEG / WebP</p>
          <Text type="secondary">透明底直接使用；不透明素材仅接受均匀黑底，并使用 HSV 本地透明化</Text>
        </Upload.Dragger>
        {items.length ? (
          <div className="spot-tiff-source-list">
            {items.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`spot-tiff-source-item${selected?.id === item.id ? " is-selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedId(item.id);
                }}
              >
                <Image preview={false} src={item.processedUrl || item.sourceUrl} />
                <span className="spot-tiff-source-copy">
                  <Text ellipsis>{item.file.name}</Text>
                  <span>
                    <Tag color={item.status === "invalid" || item.status === "failed" ? "error" : item.status === "success" ? "success" : item.status === "exporting" || item.status === "preparing" ? "processing" : "blue"}>
                      {item.status === "preparing" ? "检测中" : item.status === "invalid" ? "不支持" : item.status === "exporting" ? "导出中" : item.status === "success" ? "已完成" : item.status === "failed" ? "失败" : item.background === "black" ? "黑底已透明化" : "透明底"}
                    </Tag>
                    {item.outputName ? <Text type="secondary">{item.outputName}</Text> : null}
                  </span>
                  {item.error ? <Text type="danger">{item.error}</Text> : null}
                  {item.status === "preparing" || item.status === "exporting" ? <Progress size="small" percent={item.progress} /> : null}
                </span>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeItem(item.id);
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="spot-tiff-editor-grid">
        <Card className="spot-tiff-canvas-card" title="2. 调整共用版式" extra={<Text type="secondary">7717 × 4346 px · 800 DPI</Text>}>
          {selected?.processedUrl && displayedBounds ? (
            <div
              ref={canvasRef}
              className="spot-tiff-canvas"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className="spot-tiff-logo-frame"
                style={{
                  left: `${(displayedBounds.left / SPOT_TIFF_WIDTH) * 100}%`,
                  top: `${(displayedBounds.top / SPOT_TIFF_HEIGHT) * 100}%`,
                  width: `${(displayedBounds.width / SPOT_TIFF_WIDTH) * 100}%`,
                  height: `${(displayedBounds.height / SPOT_TIFF_HEIGHT) * 100}%`,
                }}
                onPointerDown={(event) => onPointerDown(event, "move")}
              >
                <img
                  src={selected.processedUrl}
                  alt={`${selected.file.name} 版式预览`}
                  draggable={false}
                  style={rgbMode === "black" ? { filter: "grayscale(1) brightness(0)" } : undefined}
                />
                <button
                  type="button"
                  className="spot-tiff-resize-handle"
                  aria-label="等比缩放 Logo"
                  onPointerDown={(event) => onPointerDown(event, "resize")}
                />
              </div>
            </div>
          ) : (
            <Empty description="导入有效 Logo 后在这里调整位置和大小" />
          )}
          <Text type="secondary" className="spot-tiff-canvas-hint">拖动 Logo 调整位置，拖动右下角控制点等比缩放；参数应用于整批素材。</Text>
        </Card>

        <Card className="spot-tiff-settings-card" title="版式与输出设置">
          <Form layout="vertical">
            <Form.Item label="RGB 合成图">
              <Radio.Group value={rgbMode} onChange={(event) => setRgbMode(event.target.value)} optionType="button" buttonStyle="solid">
                <Radio.Button value="color">保留原色</Radio.Button>
                <Radio.Button value="black">统一纯黑</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Flex gap={12}>
              <Form.Item label="中心 X">
                <InputNumber min={0} max={SPOT_TIFF_WIDTH} value={placement.centerX} onChange={(value) => updatePlacement({ centerX: value || 0 })} />
              </Form.Item>
              <Form.Item label="中心 Y">
                <InputNumber min={0} max={SPOT_TIFF_HEIGHT} value={placement.centerY} onChange={(value) => updatePlacement({ centerY: value || 0 })} />
              </Form.Item>
            </Flex>
            <Flex gap={12}>
              <Form.Item label="目标框宽">
                <InputNumber min={64} max={SPOT_TIFF_WIDTH} value={placement.frameWidth} onChange={(value) => updatePlacement({ frameWidth: value || 64 })} />
              </Form.Item>
              <Form.Item label="目标框高">
                <InputNumber min={64} max={SPOT_TIFF_HEIGHT} value={placement.frameHeight} onChange={(value) => updatePlacement({ frameHeight: value || 64 })} />
              </Form.Item>
            </Flex>
            <Form.Item label="相对附件默认尺寸">
              <Segmented
                block
                value={scalePercent}
                options={[50, 75, 100, 125, 150].map((value) => ({ value, label: `${value}%` }))}
                onChange={(value) =>
                  updatePlacement({
                    frameWidth: (DEFAULT_SPOT_PLACEMENT.frameWidth * Number(value)) / 100,
                    frameHeight: (DEFAULT_SPOT_PLACEMENT.frameHeight * Number(value)) / 100,
                  })
                }
              />
            </Form.Item>
            <Button block icon={<ReloadOutlined />} onClick={resetPlacement}>恢复 A.tif 默认版式</Button>
          </Form>
          <div className="spot-tiff-channel-summary">
            <Text strong>固定输出结构</Text>
            <Text>背景图层 + 智能对象 A</Text>
            <Text>专色 1 拷贝（灰度细节）</Text>
            <Text>专色 1 拷贝 2（实心覆盖）</Text>
          </div>
        </Card>
      </div>

      <Card className="action-card">
        <Flex justify="space-between" align="center" gap={16} wrap>
          <div>
            <Title level={4} style={{ margin: 0 }}>准备导出 {readyCount} 个 TIFF</Title>
            <Text type="secondary">逐张编码并写入所选文件夹；已有同名文件会自动追加 _2、_3。</Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<FolderOpenOutlined />}
            loading={busy}
            disabled={!readyCount || !supportsDirectoryExport()}
            onClick={() => void exportAll()}
          >
            选择文件夹并批量导出
          </Button>
        </Flex>
      </Card>
    </div>
  );
}
