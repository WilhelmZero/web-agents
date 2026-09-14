import {
  bestResultIndex,
  bestReview,
  preferredResult,
} from "../services/engraving/results";
import { cloneElement, useEffect, useMemo, useState } from "react";
import type { ImgHTMLAttributes, ReactElement } from "react";
import { Button, Image, Space, Card, Spin, Modal, Tag } from "antd";
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
function CoverImage({
  result,
  onOpen,
}: {
  result: StoredResult;
  onOpen: () => void;
}) {
  const preview = useEngravingPreview(result.job.blob, result.params),
    url = useEngravingUrl(preview.blob),
    raw = useEngravingUrl(result.job.blob);
  return (
    <Image
      preview={false}
      src={url || raw}
      alt="最高分生成结果"
      onClick={onOpen}
      style={{
        maxHeight: 330,
        objectFit: "contain",
        cursor: "pointer",
        background: "#000",
        width: "100%",
      }}
    />
  );
}
function ProgressImage({ blob, onOpen }: { blob: Blob; onOpen?: () => void }) {
  const url = useEngravingUrl(blob);
  return (
    <Image
      preview={false}
      src={url}
      alt="生成过程预览"
      onClick={onOpen}
      style={{
        maxHeight: 330,
        objectFit: "contain",
        background: "#000",
        width: "100%",
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
  pending,
  compact = false,
  completionLabel,
  livePreview,
}: {
  results: StoredResult[];
  original?: Blob;
  onChange: (id: string, patch: Partial<RenderParams>) => void;
  onClear?: () => void;
  clearDisabled?: boolean;
  pending?: string;
  compact?: boolean;
  completionLabel?: string;
  livePreview?: Blob;
}) {
  const [allOpen, setAllOpen] = useState(false);
  const displayed = useMemo(() => results.map(preferredResult), [results]);
  results = displayed;
  const [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string>(),
    [viewing, setViewing] = useState<string>(),
    [exportIds, setExportIds] = useState<string[]>();
  const chosen = results.filter((r) => selected.includes(r.job.id)),
    editor = results.find((r) => r.job.id === editing);
  if (compact) {
    const index = bestResultIndex(results),
      best = results[index],
      score = best && bestReview(best)?.score;
    return (
      <section className="engraving-gallery" aria-label="生成结果">
        <Card
          className="engraving-result-summary"
          title={
            best
              ? `第 ${index + 1} 张 · ${score === undefined ? "未评分" : score + " 分"} · 共 ${results.length} 张`
              : pending
                ? "生成中"
                : "等待生成"
          }
        >
          <div
            aria-label="查看所有生成版本"
            onClick={() => setAllOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAllOpen(true);
              }
            }}
          >
            {livePreview ? (
              <ProgressImage blob={livePreview} />
            ) : best ? (
              <CoverImage result={best} onOpen={() => setAllOpen(true)} />
            ) : (
              <div
                style={{
                  height: 200,
                  display: "grid",
                  placeItems: "center",
                  background: "#111",
                  color: "white",
                }}
              >
                {pending ? <Spin /> : "等待生成"}
              </div>
            )}
          </div>
          <p role="status">
            {pending || completionLabel || (best ? "已完成" : "等待生成")}
          </p>
          {pending && <Tag color="processing">生成中</Tag>}
          {best?.manualParams && <small>原审核分数，调整后未重新审核</small>}
          <Button
            block
            onClick={() => setAllOpen(true)}
            style={{ marginTop: 12 }}
          >
            查看全部生成图片（{results.length}）
          </Button>
        </Card>
        <Modal
          title="全部生成图片"
          width={1200}
          open={allOpen}
          onCancel={() => setAllOpen(false)}
          footer={null}
          destroyOnHidden
        >
          <EngravingGallery
            results={results}
            original={original}
            pending={pending}
            livePreview={livePreview}
            onChange={(id, patch) =>
              onChange(id, {
                ...results.find((r) => r.job.id === id)!.params,
                ...patch,
              })
            }
            onClear={onClear}
            clearDisabled={clearDisabled}
          />
        </Modal>
      </section>
    );
  }
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
        {pending && (
          <Card
            aria-label="正在生成的图片"
            style={{
              minHeight: 220,
              background: "#111",
              color: "#fff",
              display: "grid",
              placeItems: "center",
            }}
          >
            <div role="status" style={{ textAlign: "center", padding: 32 }}>
              {livePreview ? <ProgressImage blob={livePreview} /> : <Spin />}
              <p>{pending}</p>
              <small>图片完成后将在此显示，已有结果仍可查看。</small>
            </div>
          </Card>
        )}
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
      {!results.length && !pending ? (
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
