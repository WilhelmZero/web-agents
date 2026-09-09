import { cloneElement, useEffect, useState } from "react";
import type { ImgHTMLAttributes, ReactElement } from "react";
import { Button, Image, Space } from "antd";
import type { StoredResult, RenderParams } from "../services/engraving/types";
import { useEngravingPreview } from "../services/engraving/preview";
import EngravingResultCard, {
  EngravingResultEditor,
  useEngravingUrl,
} from "./EngravingResultCard";
import EngravingExportModal from "./EngravingExportModal";

function ResultViewer({
  results,
  id,
  original,
  onChange,
  onClose,
  onDownload,
}: {
  results: StoredResult[];
  id: string;
  original?: Blob;
  onChange: (id: string) => void;
  onClose: () => void;
  onDownload: (id: string) => void;
}) {
  const index = results.findIndex((result) => result.job.id === id),
    active = results[Math.max(0, index)];
  const preview = useEngravingPreview(active.job.blob, active.params),
    url = useEngravingUrl(preview.blob),
    raw = useEngravingUrl(active.job.blob);
  const originalUrl = useEngravingUrl(original),
    [compare, setCompare] = useState(false);
  useEffect(() => setCompare(false), [id]);
  // Only the active image is decoded for enlarged viewing. Stable IDs keep appends from changing selection.
  return (
    <Image.PreviewGroup
      items={results.map((result) => ({
        src: result.job.id === id ? url || raw || "" : "",
        alt: result.job.id,
      }))}
      preview={{
        open: true,
        current: Math.max(0, index),
        onOpenChange: (open) => !open && onClose(),
        onChange: (current) => {
          if (results[current]) onChange(results[current].job.id);
        },
        imageRender: (node) =>
          cloneElement(
            node as ReactElement<ImgHTMLAttributes<HTMLImageElement>>,
            {
              src: compare && originalUrl ? originalUrl : url || raw,
              alt: compare ? "原照对比" : "生成结果放大",
            },
          ),
        actionsRender: (node) => (
          <>
            {node}
            <Button onClick={() => onDownload(id)}>下载</Button>
            <Button
              disabled={!originalUrl}
              onClick={() => setCompare((v) => !v)}
            >
              {compare ? "查看生成图" : "查看原图"}
            </Button>
            <span>
              {preview.computing ? "正在计算高清预览…" : preview.error}
            </span>
          </>
        ),
      }}
    />
  );
}
export default function EngravingGallery({
  results,
  original,
  onChange,
  onClear,
  clearDisabled = false,
}: {
  results: StoredResult[];
  original?: Blob;
  onChange: (id: string, patch: Partial<RenderParams>) => void;
  onClear?: () => void;
  clearDisabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string>(),
    [viewing, setViewing] = useState<string>(),
    [exportIds, setExportIds] = useState<string[]>();
  const chosen = results.filter((r) => selected.includes(r.job.id)),
    editor = results.find((r) => r.job.id === editing);
  return (
    <section className="engraving-gallery" aria-label="生成结果">
      <Space wrap className="engraving-gallery-toolbar">
        <strong>生成结果 · {results.length} 张</strong>
        {onClear ? (
          <Button
            danger
            disabled={clearDisabled || !results.length}
            onClick={onClear}
          >
            清空历史结果
          </Button>
        ) : null}
        <Button
          disabled={!results.length}
          onClick={() => setSelected(results.map((r) => r.job.id))}
        >
          全选
        </Button>
        <Button disabled={!chosen.length} onClick={() => setSelected([])}>
          取消选择
        </Button>
        <span>已选 {chosen.length} 张</span>
        <Button
          disabled={!chosen.length}
          onClick={() => setExportIds(chosen.map((r) => r.job.id))}
        >
          下载所选
        </Button>
      </Space>
      <div className="engraving-results-list">
        {results.map((result, index) => (
          <EngravingResultCard
            key={result.job.id}
            result={result}
            index={index}
            selected={selected.includes(result.job.id)}
            onSelect={(checked) =>
              setSelected((prev) =>
                checked
                  ? [...new Set([...prev, result.job.id])]
                  : prev.filter((id) => id !== result.job.id),
              )
            }
            onEdit={() => setEditing(result.job.id)}
            onPreview={() => setViewing(result.job.id)}
            onDownload={() => setExportIds([result.job.id])}
          />
        ))}
      </div>
      {!results.length ? (
        <p>生成的图片将在这里显示。生成过程中也可调参和下载已有结果。</p>
      ) : null}
      {editor ? (
        <EngravingResultEditor
          key={editor.job.id}
          result={editor}
          onChange={(patch) => onChange(editor.job.id, patch)}
          onClose={() => setEditing(undefined)}
          onDownload={() => setExportIds([editor.job.id])}
          onPreview={() => setViewing(editor.job.id)}
        />
      ) : null}
      {viewing && results.some((r) => r.job.id === viewing) ? (
        <ResultViewer
          results={results}
          id={viewing}
          original={original}
          onChange={setViewing}
          onClose={() => setViewing(undefined)}
          onDownload={(id) => {
            setViewing(undefined);
            setExportIds([id]);
          }}
        />
      ) : null}
      {exportIds ? (
        <EngravingExportModal
          results={results.filter((r) => exportIds.includes(r.job.id))}
          onClose={() => setExportIds(undefined)}
        />
      ) : null}
    </section>
  );
}
