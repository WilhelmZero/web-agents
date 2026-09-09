import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Image,
  Modal,
  Select,
  Slider,
  Space,
  Switch,
  InputNumber,
  Tag,
} from "antd";
import type { RenderParams, StoredResult } from "../services/engraving/types";
import { DEFAULTS } from "../services/engraving/processing.mjs";
import { useEngravingPreview } from "../services/engraving/preview";
import EngravingMaskEditor from "./EngravingMaskEditor";
import EngravingCropEditor from "./EngravingCropEditor";
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
          [72, 96, 150, 200, 300, 600, 800, 1200].includes(value) ? value : undefined
        }
        placeholder="常用 DPI"
        style={{ width: 110 }}
        onChange={onChange}
        options={[72, 96, 150, 200, 300, 600, 800, 1200].map((value) => ({
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

export function EngravingResultEditor({
  result,
  onChange,
  onClose,
  onDownload,
  onPreview,
}: {
  result: StoredResult;
  onChange: (patch: Partial<RenderParams>) => void;
  onClose: () => void;
  onDownload: () => void;
  onPreview: () => void;
}) {
  const preview = useEngravingPreview(result.job.blob, result.params);
  const url = useEngravingUrl(preview.blob),
    rawUrl = useEngravingUrl(result.job.blob);
  const [cropping, setCropping] = useState(false),
    [mask, setMask] = useState(false);
  const latest = result.reviews.at(-1);
  return (
    <Modal
      open
      width={1200}
      className="engraving-edit-modal"
      title="调节单张参数"
      onCancel={onClose}
      footer={
        <Space>
          <span>参数自动保存</span>
          <Button onClick={onDownload}>下载</Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      <div className="engraving-editor-layout">
        <div className="engraving-editor-preview">
          {cropping && rawUrl ? (
            <EngravingCropEditor
              url={rawUrl}
              width={result.job.width}
              height={result.job.height}
              value={result.params.crop}
              onApply={(crop) => {
                onChange({ crop });
                setCropping(false);
              }}
              onCancel={() => setCropping(false)}
            />
          ) : (
            <>
              <button
                className="engraving-preview-button"
                disabled={!url}
                onClick={onPreview}
                aria-label="放大实时预览"
              >
                {url ? (
                  <img src={url} alt="单张实时预览" />
                ) : (
                  <span>正在计算预览…</span>
                )}
              </button>
              <Space wrap>
                <Button onClick={() => setCropping(true)}>裁剪</Button>
                <Button
                  disabled={!result.params.crop}
                  onClick={() => onChange({ crop: null })}
                >
                  重置裁剪
                </Button>
                <Button onClick={onDownload}>下载</Button>
              </Space>
            </>
          )}
          <div aria-live="polite">
            {preview.computing ? "正在更新预览…" : "预览已更新"}
          </div>
          {preview.error ? (
            <Alert type="warning" title={preview.error} />
          ) : null}
        </div>
        <div className="engraving-editor-params" aria-label="单张参数设置">
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
              checked={result.params.invert}
              onChange={(invert) => onChange({ invert })}
            />
            <Button
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
            <Button disabled={!rawUrl} onClick={() => setMask(true)}>
              擦除校正
            </Button>
            <Select
              aria-label="单张输出模式"
              value={result.params.mode}
              onChange={(mode) => onChange({ mode })}
              options={[
                { value: "grayscale", label: "灰度" },
                { value: "dither", label: "二值点阵" },
              ]}
            />
          </Space>
          {latest ? (
            <Alert
              type={latest.passed ? "success" : "warning"}
              title={latest.passed ? "达到目标评分" : "审核修改意见"}
              description={
                latest.suggestions ||
                latest.issueLabels.join("；") ||
                "无额外修改意见"
              }
            />
          ) : null}
          {result.job.warnings.map((warning, i) => (
            <Alert key={i} type="warning" title={warning} />
          ))}
          <Collapse
            items={[
              {
                key: "details",
                label: "AI 原始返回图、提示词与审核详情",
                children: (
                  <>
                    <p>AI 原始返回图（未调参）</p>
                    <Image src={rawUrl} alt="AI 原始返回图" />
                    <p>实际提示词</p>
                    <pre>{result.prompt || "旧任务未记录实际提示词"}</pre>
                    <p>初始参数</p>
                    <pre>
                      {JSON.stringify(
                        result.initialParams,
                        (key, value) =>
                          key === "eraseMask"
                            ? value
                              ? "已保存蒙版"
                              : undefined
                            : value,
                        2,
                      )}
                    </pre>
                    {result.reviews.map((r) => (
                      <div key={r.round}>
                        <p>
                          第 {r.round} 轮 · {r.score} 分 ·{" "}
                          {r.action === "adjust" ? "本地调参" : "AI 生图"}
                        </p>
                        <p>{r.suggestions || r.issueLabels.join("；")}</p>
                        <pre>
                          {JSON.stringify(
                            { scores: r.scores, params: r.params },
                            (key, value) =>
                              key === "eraseMask"
                                ? value
                                  ? "已保存蒙版"
                                  : undefined
                                : value,
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
        </div>
      </div>
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
    </Modal>
  );
}
export default function EngravingResultCard({
  result,
  index,
  selected,
  onSelect,
  onEdit,
  onDownload,
  onPreview,
}: {
  result: StoredResult;
  index: number;
  selected: boolean;
  onSelect: (value: boolean) => void;
  onEdit: () => void;
  onDownload: () => void;
  onPreview: () => void;
}) {
  const preview = useEngravingPreview(result.job.blob, result.params, 400),
    url = useEngravingUrl(preview.blob);
  const latest = result.reviews.at(-1);
  return (
    <Card className="engraving-result-card" size="small">
      <div className="engraving-result-heading">
        <Checkbox
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`选择图片 ${index + 1}`}
        >
          #{index + 1}
        </Checkbox>
        <Tag color={latest?.passed ? "green" : undefined}>
          {latest ? `${latest.score} 分` : "未审核"}
        </Tag>
      </div>
      <button
        className="engraving-preview-button"
        aria-label={`放大图片 ${index + 1}`}
        onClick={onPreview}
      >
        {url ? (
          <img src={url} alt={`生成结果 ${index + 1}`} />
        ) : (
          <span>{preview.error ? "预览失败，点击查看" : "正在计算预览…"}</span>
        )}
      </button>
      <Space wrap size={4}>
        <Button size="small" onClick={onEdit}>
          调节参数
        </Button>
        <Button size="small" onClick={onDownload}>
          下载
        </Button>
      </Space>
    </Card>
  );
}
