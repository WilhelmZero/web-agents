import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileZipOutlined,
  ReloadOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Progress,
  Segmented,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ICON_VECTOR_SPLIT_SETTINGS,
  detectIconRegions,
  extractIconRaster,
  type IconDetectionResult,
  type IconVectorSplitSettings,
} from "./services/iconVectorSplit";
import { readLocalStorage } from "./storage";
import { downloadBlob, sanitizeFileName } from "./utils";

const { Title, Text, Paragraph } = Typography;
const SETTINGS_KEY = "scene-studio.icon-vector-split-settings.v1";

interface VectorIconItem {
  id: string;
  name: string;
  pngBlob: Blob;
  svgBlob: Blob;
  previewUrl: string;
  selected: boolean;
}

function revokeItems(items: VectorIconItem[]) {
  items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
}

export default function IconVectorSplitComposer() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<IconVectorSplitSettings>(() =>
    readLocalStorage(SETTINGS_KEY, DEFAULT_ICON_VECTOR_SPLIT_SETTINGS),
  );
  const [sourceFile, setSourceFile] = useState<File>();
  const [sourceUrl, setSourceUrl] = useState("");
  const [detection, setDetection] = useState<IconDetectionResult>();
  const [items, setItems] = useState<VectorIconItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(0);
  const itemRef = useRef<VectorIconItem[]>([]);
  const sourceUrlRef = useRef("");

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    itemRef.current = items;
  }, [items]);
  useEffect(() => {
    sourceUrlRef.current = sourceUrl;
  }, [sourceUrl]);
  useEffect(
    () => () => {
      revokeItems(itemRef.current);
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    },
    [],
  );

  const patchSettings = (patch: Partial<IconVectorSplitSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  const clearResults = useCallback(() => {
    setItems((current) => {
      revokeItems(current);
      return [];
    });
    setDetection(undefined);
    setCompleted(0);
  }, []);

  const processFile = useCallback(
    async (file: File, activeSettings = settings) => {
      setProcessing(true);
      clearResults();
      const generated: VectorIconItem[] = [];
      let committed = false;
      try {
        const nextDetection = await detectIconRegions(file, activeSettings);
        if (!nextDetection.regions.length)
          throw new Error("没有识别到可拆分图标，请调整前景颜色、阈值或分组间距");
        setDetection(nextDetection);
        const { vectorizeImageToSvg } = await import(
          "./services/trueVectorExport"
        );
        const baseName = sanitizeFileName(file.name);
        for (let index = 0; index < nextDetection.regions.length; index += 1) {
          const pngBlob = await extractIconRaster(
            file,
            nextDetection.regions[index],
            activeSettings,
            nextDetection.resolvedMode,
          );
          const svgBlob = await vectorizeImageToSvg(
            pngBlob,
            2,
            "imagetracer",
          );
          generated.push({
            id: nextDetection.regions[index].id,
            name: `${baseName}_图标_${String(index + 1).padStart(2, "0")}`,
            pngBlob,
            svgBlob,
            previewUrl: URL.createObjectURL(pngBlob),
            selected: true,
          });
          setCompleted(index + 1);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        setItems(generated);
        committed = true;
        message.success(`已拆分并矢量化 ${generated.length} 个图标`);
      } catch (error) {
        if (!committed) revokeItems(generated);
        message.error(error instanceof Error ? error.message : "图标拆分失败");
      } finally {
        setProcessing(false);
      }
    },
    [clearResults, message, settings],
  );

  const loadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      message.error("请选择 PNG、JPEG 或 WebP 图片");
      return false;
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    const nextUrl = URL.createObjectURL(file);
    setSourceFile(file);
    setSourceUrl(nextUrl);
    await processFile(file);
    return false;
  };

  const selectedItems = useMemo(
    () => items.filter((item) => item.selected),
    [items],
  );
  const setAllSelected = (selected: boolean) =>
    setItems((current) => current.map((item) => ({ ...item, selected })));
  const patchItem = (id: string, patch: Partial<VectorIconItem>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );

  const downloadZip = async (format: "svg" | "png") => {
    if (!selectedItems.length) return void message.warning("请至少选择一个图标");
    const zip = new JSZip();
    selectedItems.forEach((item) =>
      zip.file(
        `${sanitizeFileName(item.name)}.${format}`,
        format === "svg" ? item.svgBlob : item.pngBlob,
      ),
    );
    downloadBlob(
      await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
      `${sanitizeFileName(sourceFile?.name || "icons")}_${format.toUpperCase()}_${selectedItems.length}个.zip`,
    );
  };

  const settingsPanel = (
    <Card className="icon-vector-settings" title="识别与输出设置">
      <Form layout="vertical">
        <Form.Item
          label="图标前景"
          extra="自动会分别尝试浅色与深色图标，并选择更合理的结果"
        >
          <Segmented
            block
            value={settings.foregroundMode}
            onChange={(foregroundMode) =>
              patchSettings({
                foregroundMode:
                  foregroundMode as IconVectorSplitSettings["foregroundMode"],
              })
            }
            options={[
              { value: "auto", label: "自动" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Form.Item>
        <Form.Item label="前景阈值" extra="背景被带入时调高；细线缺失时调低">
          <InputNumber
            min={120}
            max={250}
            value={settings.threshold}
            onChange={(threshold) => patchSettings({ threshold: threshold || 205 })}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="允许色差" extra="调低可排除彩色编号和装饰文字">
          <InputNumber
            min={8}
            max={128}
            value={settings.maxChroma}
            onChange={(maxChroma) => patchSettings({ maxChroma: maxChroma || 56 })}
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="图形分组间距" extra="同一图标被拆开时调高；相邻图标粘连时调低">
          <InputNumber
            min={2}
            max={120}
            value={settings.groupingGap}
            onChange={(groupingGap) => patchSettings({ groupingGap: groupingGap || 28 })}
            addonAfter="px"
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Flex gap={10}>
          <Form.Item label="最小宽度 %" style={{ flex: 1 }}>
            <InputNumber
              min={0.5}
              max={30}
              step={0.5}
              value={settings.minimumWidthPercent}
              onChange={(minimumWidthPercent) =>
                patchSettings({ minimumWidthPercent: minimumWidthPercent || 4 })
              }
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label="最小高度 %" style={{ flex: 1 }}>
            <InputNumber
              min={0.5}
              max={30}
              step={0.5}
              value={settings.minimumHeightPercent}
              onChange={(minimumHeightPercent) =>
                patchSettings({ minimumHeightPercent: minimumHeightPercent || 4 })
              }
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Flex>
        <Form.Item label="裁切留白 %">
          <InputNumber
            min={0}
            max={12}
            step={0.2}
            value={settings.paddingPercent}
            onChange={(paddingPercent) =>
              patchSettings({ paddingPercent: paddingPercent ?? 1.2 })
            }
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item label="矢量颜色">
          <Segmented
            block
            value={settings.outputColor}
            onChange={(outputColor) =>
              patchSettings({
                outputColor:
                  outputColor as IconVectorSplitSettings["outputColor"],
              })
            }
            options={[
              { value: "black", label: "黑色" },
              { value: "white", label: "白色" },
            ]}
          />
        </Form.Item>
        <Button
          block
          type="primary"
          icon={<ReloadOutlined />}
          loading={processing}
          disabled={!sourceFile}
          onClick={() => sourceFile && void processFile(sourceFile, settings)}
        >
          按当前设置重新识别
        </Button>
      </Form>
    </Card>
  );

  return (
    <div className="icon-vector-split-page">
      <section className="hero-strip icon-vector-hero">
        <div>
          <Text className="eyebrow">ICON SHEET VECTORIZER</Text>
          <Title level={2}>图片图标自动拆分与矢量化</Title>
          <Paragraph className="hero-description">
            本地识别一张排版图中的多个独立图标，去除背景与编号，分别生成透明 PNG 和真实 SVG Path。
          </Paragraph>
        </div>
        <div className="hero-orb" />
      </section>

      <div className="icon-vector-layout">
        <div className="icon-vector-main">
          <Card
            className="workflow-card"
            title={
              <Space>
                <span className="step-badge">1</span>
                导入图标排版图片
              </Space>
            }
            extra={
              sourceFile ? (
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
                    setSourceFile(undefined);
                    setSourceUrl("");
                    clearResults();
                  }}
                >
                  清空
                </Button>
              ) : null
            }
          >
            {!sourceFile ? (
              <Upload.Dragger
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                beforeUpload={(file) => {
                  void loadFile(file as File);
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon">
                  <FileImageOutlined />
                </p>
                <p className="ant-upload-text">拖拽或点击选择图标排版图</p>
                <p className="ant-upload-hint">
                  PNG / JPEG / WebP；图片仅在本地处理，不会上传
                </p>
              </Upload.Dragger>
            ) : (
              <div className="icon-sheet-source-wrap">
                <div className="icon-sheet-source">
                  <img src={sourceUrl} alt="待拆分图标排版图" />
                  {detection?.regions.map((region, index) => (
                    <span
                      key={region.id}
                      className="icon-sheet-region"
                      style={{
                        left: `${(region.x / detection.width) * 100}%`,
                        top: `${(region.y / detection.height) * 100}%`,
                        width: `${(region.width / detection.width) * 100}%`,
                        height: `${(region.height / detection.height) * 100}%`,
                      }}
                    >
                      {index + 1}
                    </span>
                  ))}
                </div>
                <Flex justify="space-between" align="center" gap={10} wrap>
                  <Text strong>{sourceFile.name}</Text>
                  {detection ? (
                    <Space wrap>
                      <Tag color="success" icon={<CheckOutlined />}>
                        已识别 {detection.regions.length} 个
                      </Tag>
                      <Tag>{detection.resolvedMode === "light" ? "浅色前景" : "深色前景"}</Tag>
                    </Space>
                  ) : null}
                </Flex>
              </div>
            )}
            {processing && detection ? (
              <Progress
                style={{ marginTop: 16 }}
                percent={Math.round((completed / detection.regions.length) * 100)}
                status="active"
                format={() => `${completed}/${detection.regions.length}`}
              />
            ) : null}
          </Card>

          <Card
            className="workflow-card"
            title={
              <Space>
                <span className="step-badge">2</span>
                独立矢量文件
              </Space>
            }
            extra={
              items.length ? (
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() => setAllSelected(selectedItems.length !== items.length)}
                  >
                    {selectedItems.length === items.length ? "取消全选" : "全选"}
                  </Button>
                  <Button
                    size="small"
                    icon={<FileZipOutlined />}
                    disabled={!selectedItems.length}
                    onClick={() => void downloadZip("png")}
                  >
                    PNG ZIP
                  </Button>
                  <Button
                    type="primary"
                    size="small"
                    icon={<FileZipOutlined />}
                    disabled={!selectedItems.length}
                    onClick={() => void downloadZip("svg")}
                  >
                    SVG ZIP
                  </Button>
                </Space>
              ) : null
            }
          >
            {items.length ? (
              <div className="icon-vector-results">
                {items.map((item, index) => (
                  <Card
                    key={item.id}
                    size="small"
                    className={item.selected ? "is-selected" : ""}
                    title={
                      <Checkbox
                        checked={item.selected}
                        onChange={(event) =>
                          patchItem(item.id, { selected: event.target.checked })
                        }
                      >
                        #{String(index + 1).padStart(2, "0")}
                      </Checkbox>
                    }
                  >
                    <div className="icon-vector-preview transparent-grid">
                      <Image src={item.previewUrl} alt={`${item.name} 预览`} />
                    </div>
                    <Input
                      value={item.name}
                      aria-label={`图标 ${index + 1} 文件名`}
                      onChange={(event) =>
                        patchItem(item.id, { name: event.target.value })
                      }
                    />
                    <Flex className="icon-vector-download-actions" gap={6} style={{ marginTop: 8 }}>
                      <Button
                        block
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          downloadBlob(
                            item.pngBlob,
                            `${sanitizeFileName(item.name)}.png`,
                          )
                        }
                      >
                        PNG
                      </Button>
                      <Button
                        block
                        size="small"
                        type="primary"
                        ghost
                        icon={<ScissorOutlined />}
                        onClick={() =>
                          downloadBlob(
                            item.svgBlob,
                            `${sanitizeFileName(item.name)}.svg`,
                          )
                        }
                      >
                        SVG
                      </Button>
                    </Flex>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={processing ? "正在拆分并矢量化图标" : "导入图片后，独立图标会显示在这里"}
              />
            )}
          </Card>
        </div>
        {settingsPanel}
      </div>
      <Alert
        showIcon
        type="info"
        title="适合高对比度图标排版图"
        description="白色图标配深色背景、黑色图标配浅色背景的效果最好。复杂彩色图标、相互重叠图标或没有明显间距的排版，仍可能需要手动调整阈值与分组间距。"
      />
    </div>
  );
}
