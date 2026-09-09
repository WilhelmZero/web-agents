import { cloneElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode, ImgHTMLAttributes } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Image,
  InputNumber,
  Select,
  Slider,
  Space,
  Switch,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import type { RenderParams, StoredResult } from "../services/engraving/types";
import { processInWorker } from "../services/engraving/workerClient";
import { DEFAULTS } from "../services/engraving/processing.mjs";
import EngravingMaskEditor from "./EngravingMaskEditor";

export function useEngravingUrl(blob?: Blob) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) {
      setValue(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
}
export function downloadEngraving(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EngravingCompareGroup({
  original,
  children,
}: {
  original?: Blob;
  children: ReactNode;
}) {
  const originalUrl = useEngravingUrl(original),
    [compare, setCompare] = useState(false);
  return (
    <Image.PreviewGroup
      preview={{
        onOpenChange: () => setCompare(false),
        onChange: () => setCompare(false),
        imageRender: (node) =>
          cloneElement(
            node as ReactElement<ImgHTMLAttributes<HTMLImageElement>>,
            compare && originalUrl ? { src: originalUrl, alt: "原照对比" } : {},
          ),
        actionsRender: (node, info) => (
          <>
            {node}
            <Button
              icon={<DownloadOutlined />}
              onClick={() => {
                const a = document.createElement("a");
                a.href = compare && originalUrl ? originalUrl : info.image.url;
                a.download = compare ? "original.png" : "engraving-preview.png";
                a.click();
              }}
            >
              下载预览图
            </Button>
            <Button
              disabled={
                !originalUrl || (info.image.alt === "原照" && info.total < 2)
              }
              onClick={() => {
                if (info.image.alt === "原照" && !compare && info.total > 1) {
                  info.actions.onActive(1);
                  return;
                }
                setCompare((v) => !v);
              }}
            >
              {compare || info.image.alt === "原照" ? "查看生成图" : "查看原图"}
            </Button>
          </>
        ),
      }}
    >
      {children}
    </Image.PreviewGroup>
  );
}

export function DpiControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <Space.Compact>
      <Select
        aria-label="常用 DPI"
        disabled={disabled}
        value={
          [72, 96, 150, 200, 300, 600, 1200].includes(value) ? value : undefined
        }
        placeholder="常用 DPI"
        style={{ width: 110 }}
        onChange={onChange}
        options={[72, 96, 150, 200, 300, 600, 1200].map((value) => ({
          value,
          label: String(value),
        }))}
      />
      <InputNumber
        aria-label="DPI"
        disabled={disabled}
        min={72}
        max={1200}
        value={value}
        onChange={(v) => v !== null && onChange(v)}
      />
    </Space.Compact>
  );
}

export default function EngravingResultCard({
  result,
  original,
  disabled,
  onAdopt,
  onChange,
}: {
  result: StoredResult;
  original?: Blob;
  disabled: boolean;
  onAdopt: () => void;
  onChange: (patch: Partial<RenderParams>) => void;
}) {
  const [blob, setBlob] = useState<Blob>(),
    [computing, setComputing] = useState(false),
    [error, setError] = useState(""),
    [mask, setMask] = useState(false),
    [exporting, setExporting] = useState(false);
  const rawUrl = useEngravingUrl(result.job.blob),
    previewUrl = useEngravingUrl(blob),
    referenceUrl = useEngravingUrl(result.reference);
  useEffect(() => {
    const controller = new AbortController();
    setComputing(true);
    const timer = setTimeout(() => {
      processInWorker(
        result.job.blob,
        { ...result.params, preview: true },
        controller.signal,
      )
        .then((r) => {
          if (!controller.signal.aborted) {
            setBlob(r.buffer);
            setError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setComputing(false);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [result.job.blob, result.params]);
  const latest = result.reviews.at(-1);
  return (
    <Card
      className="engraving-result-card"
      size="small"
      title={`生成结果 · ${new Date(result.createdAt).toLocaleTimeString()}${latest ? ` · ${latest.score} 分` : " · 未审核"}`}
    >
      <EngravingCompareGroup original={original}>
        {previewUrl ? (
          <Image src={previewUrl} alt="单张雕刻结果" />
        ) : (
          <div className="engraving-result-loading">正在计算预览…</div>
        )}
        {error ? <Alert type="error" title={error} /> : null}
        {computing && blob ? <span>正在更新单张预览…</span> : null}
        {latest ? (
          <Alert
            type={latest.passed ? "success" : "warning"}
            title={
              latest.passed ? "达到目标评分，自动生成已停止" : "审核修改意见"
            }
            description={
              latest.suggestions ||
              latest.issueLabels.join("；") ||
              "请查看各维度评分"
            }
          />
        ) : null}
        <Space wrap>
          <Button disabled={disabled} onClick={onAdopt}>
            在中间查看此图
          </Button>
          <Button
            loading={exporting}
            disabled={disabled}
            onClick={async () => {
              setExporting(true);
              try {
                const out = await processInWorker(result.job.blob, {
                  ...result.params,
                  preview: false,
                });
                downloadEngraving(out.buffer, `engraving-${result.job.id}.png`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            下载完整尺寸
          </Button>
        </Space>
        <Collapse
          items={[
            {
              key: "details",
              label: "展开 AI 原始返回图与单张参数",
              children: (
                <>
                  <div className="engraving-raw-images">
                    <div>
                      <p>AI 原始返回图（未调参）</p>
                      <Image src={rawUrl} alt="AI 原始返回图" />
                    </div>
                    {referenceUrl ? (
                      <div>
                        <p>本次风格参考</p>
                        <Image src={referenceUrl} alt="本次风格参考" />
                      </div>
                    ) : null}
                  </div>
                  {(
                    [
                      "texture",
                      "contrast",
                      "shadow",
                      "brightness",
                      "blackPoint",
                    ] as const
                  ).map((key, i) => (
                    <label key={key}>
                      {["纹理", "对比度", "暗部细节", "亮度", "黑底清理"][i]} ·{" "}
                      {result.params[key]}
                      <Slider
                        ariaLabelForHandle={`单张${["纹理", "对比度", "暗部细节", "亮度", "黑底清理"][i]}`}
                        disabled={disabled}
                        min={0}
                        max={key === "blackPoint" ? 40 : 100}
                        value={result.params[key]}
                        onChange={(v) => onChange({ [key]: v })}
                      />
                    </label>
                  ))}
                  <Space wrap>
                    <span>主体反相</span>
                    <Switch
                      disabled={disabled}
                      checked={result.params.invert}
                      onChange={(invert) => onChange({ invert })}
                    />
                    <Button
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          texture: DEFAULTS.texture,
                          contrast: DEFAULTS.contrast,
                          shadow: DEFAULTS.shadow,
                          brightness: DEFAULTS.brightness,
                          blackPoint: DEFAULTS.blackPoint,
                          invert: false,
                        })
                      }
                    >
                      重置雕刻参数
                    </Button>
                    <Button
                      disabled={disabled || !rawUrl}
                      onClick={() => setMask(true)}
                    >
                      擦除校正
                    </Button>
                  </Space>
                  <Space wrap>
                    <label>
                      DPI
                      <DpiControl
                        value={result.params.dpi}
                        disabled={disabled}
                        onChange={(dpi) => onChange({ dpi })}
                      />
                    </label>
                    <label>
                      宽度 mm
                      <InputNumber
                        min={10}
                        max={300}
                        disabled={disabled}
                        value={result.params.widthMm}
                        onChange={(v) => v !== null && onChange({ widthMm: v })}
                      />
                    </label>
                    <label>
                      边距 mm
                      <InputNumber
                        min={0}
                        max={15}
                        disabled={disabled}
                        value={result.params.margin}
                        onChange={(v) => v !== null && onChange({ margin: v })}
                      />
                    </label>
                    <Select
                      disabled={disabled}
                      value={result.params.mode}
                      onChange={(mode) => onChange({ mode })}
                      options={[
                        { value: "grayscale", label: "灰度" },
                        { value: "dither", label: "二值点阵" },
                      ]}
                    />
                  </Space>
                  <Collapse
                    items={[
                      {
                        key: "audit",
                        label: "查看生成提示词、初始参数和各轮审核",
                        children: (
                          <>
                            <pre>
                              {result.prompt || "旧任务未记录实际提示词"}
                            </pre>
                            <pre>
                              {JSON.stringify(result.initialParams, null, 2)}
                            </pre>
                            {result.reviews.map((r) => (
                              <div key={r.round}>
                                <p>
                                  第 {r.round} 轮 · {r.score} 分 ·{" "}
                                  {r.action === "adjust"
                                    ? "本地调参"
                                    : "AI 生图"}
                                </p>
                                <p>
                                  {r.suggestions || r.issueLabels.join("；")}
                                </p>
                                <pre>
                                  {JSON.stringify(
                                    { scores: r.scores, params: r.params },
                                    null,
                                    2,
                                  )}
                                </pre>
                              </div>
                            ))}
                          </>
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </EngravingCompareGroup>
      {mask && rawUrl ? (
        <EngravingMaskEditor
          job={result.job}
          sourceUrl={rawUrl}
          value={result.params.eraseMask}
          onClose={() => setMask(false)}
          onSave={(eraseMask) => {
            onChange({ eraseMask });
            setMask(false);
          }}
        />
      ) : null}
    </Card>
  );
}
