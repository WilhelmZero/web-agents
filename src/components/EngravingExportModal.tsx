import { useState } from "react";
import JSZip from "jszip";
import {
  Alert,
  Button,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
} from "antd";
import type { StoredResult } from "../services/engraving/types";
import {
  exportDimensions,
  loadExportSettings,
  renderExportBatch,
  saveExportSettings,
  snapshotExport,
} from "../services/engraving/export";
import { processInWorker } from "../services/engraving/workerClient";
import { DpiControl, downloadEngraving } from "./EngravingResultCard";

export default function EngravingExportModal({
  results,
  onClose,
}: {
  results: StoredResult[];
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(loadExportSettings);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(0);
  const [report, setReport] =
    useState<Awaited<ReturnType<typeof renderExportBatch>>>();
  const [message, setMessage] = useState("");
  const [batch, setBatch] = useState<{ count: number; sizes: string[] }>();
  let invalid = "";
  const sizes = results.map((result, index) => {
    try {
      const size = exportDimensions(result, settings);
      return `图片 ${index + 1}：${size.width} × ${size.height}px`;
    } catch (error) {
      invalid = (error as Error).message;
      return "";
    }
  });
  const patch = (value: Partial<typeof settings>) => {
    setSettings((prev) => ({ ...prev, ...value }));
    setReport(undefined);
    setBatch(undefined);
    setMessage("");
  };
  async function downloadFiles(
    files: { name: string; blob: Blob }[],
    count: number,
  ) {
    if (count === 1 && files.length === 1)
      downloadEngraving(files[0].blob, files[0].name);
    else {
      const zip = new JSZip();
      for (const file of files)
        zip.file(file.name, await file.blob.arrayBuffer());
      downloadEngraving(
        await zip.generateAsync({ type: "blob" }),
        "engraving-selected.zip",
      );
    }
  }
  async function confirm() {
    if (invalid || busy || !results.length) return;
    const snapshot = snapshotExport(results, settings);
    setBatch({ count: snapshot.length, sizes: [...sizes] });
    setBusy(true);
    setDone(0);
    setReport(undefined);
    try {
      try {
        saveExportSettings(settings);
      } catch {
        setMessage("无法保存下载设置，本次下载不受影响。");
      }
      const output = await renderExportBatch(
        snapshot,
        processInWorker,
        setDone,
      );
      setReport(output);
      if (!output.errors.length) {
        await downloadFiles(output.files, snapshot.length);
        setMessage("下载已准备好。");
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`选择输出尺寸 · ${batch?.count ?? results.length} 张`}
      zIndex={1300}
      onCancel={() => !busy && onClose()}
      closable={!busy}
      maskClosable={!busy}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
          {report?.errors.length && report.files.length ? (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await downloadFiles(
                    report.files,
                    batch?.count ?? results.length,
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              下载成功部分（{report.files.length} 张）
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={busy}
            disabled={!!invalid || !results.length}
            onClick={() => void confirm()}
          >
            确定并下载
          </Button>
        </Space>
      }
    >
      <div className="engraving-export-fields">
        <label>
          尺寸单位
          <Select
            aria-label="尺寸单位"
            disabled={busy}
            value={settings.unit}
            onChange={(unit) => patch({ unit })}
            options={[
              { value: "mm", label: "毫米＋DPI" },
              { value: "px", label: "像素宽度" },
            ]}
          />
        </label>
        <label>
          {settings.unit === "mm" ? "宽度（mm）" : "宽度（px）"}
          <InputNumber
            aria-label="输出宽度"
            disabled={busy}
            min={settings.unit === "mm" ? 10 : 1}
            max={settings.unit === "mm" ? 300 : 8192}
            precision={settings.unit === "mm" ? 2 : 0}
            value={
              settings.unit === "mm" ? settings.widthMm : settings.pixelWidth
            }
            onChange={(v) =>
              v !== null &&
              patch(settings.unit === "mm" ? { widthMm: v } : { pixelWidth: v })
            }
          />
        </label>
        <label>
          DPI
          <DpiControl
            disabled={busy}
            value={settings.dpi}
            onChange={(dpi) => patch({ dpi })}
          />
        </label>
        <label>
          {settings.unit === "mm" ? "边距（mm）" : "边距（px）"}
          <InputNumber
            aria-label="输出边距"
            disabled={busy}
            min={0}
            max={settings.unit === "mm" ? 15 : 4095}
            precision={settings.unit === "mm" ? 2 : 0}
            value={
              settings.unit === "mm" ? settings.margin : settings.pixelMargin
            }
            onChange={(v) =>
              v !== null &&
              patch(settings.unit === "mm" ? { margin: v } : { pixelMargin: v })
            }
          />
        </label>
      </div>
      <p>
        高度按裁剪后比例计算。完整尺寸从 AI 原图重新处理，不放大预览图。上限
        8192px / 2400 万像素。
      </p>
      <div className="engraving-export-sizes">
        {(batch?.sizes ?? sizes).map((size, index) => (
          <div key={index}>{size}</div>
        ))}
      </div>
      {invalid ? <Alert type="error" title={invalid} /> : null}
      {busy ? (
        <Progress
          percent={Math.round(
            (done / Math.max(1, batch?.count ?? results.length)) * 100,
          )}
        />
      ) : null}
      {report?.errors.map((error) => (
        <Alert key={error} type="error" title={error} />
      ))}
      {report?.warnings.map((warning, index) => (
        <Alert key={index} type="warning" title={warning} />
      ))}
      {message ? <Alert type="info" title={message} /> : null}
    </Modal>
  );
}
