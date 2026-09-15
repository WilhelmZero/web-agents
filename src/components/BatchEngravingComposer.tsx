import {
  reportTaskProgress,
  clearTaskProgress,
} from "../services/taskProgress";
import { engravingProgress } from "../services/engraving/progress";
import EngravingExportModal from "./EngravingExportModal";
import {
  taskResults,
  coverResultIndex,
  preferredResult,
} from "../services/engraving/results";
import {
  listBatchHistory,
  saveBatchHistory,
  readBatchTasks,
  deleteBatchHistory,
  holdBatch,
  releaseBatch,
  archiveLegacyWorkspace,
  type BatchHistory,
} from "../services/engraving/batch-history";
import { useState, useRef, useCallback, useEffect, createRef } from "react";
import {
  Alert,
  Checkbox,
  Button,
  Card,
  Image,
  InputNumber,
  Space,
  Upload,
  Tag,
  Modal,
  Popconfirm,
} from "antd";
import { EngravingTaskComposer } from "../CustomMonochromeLogoComposer";
import {
  FileImageOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import {
  DEFAULT_PREFERENCES,
  getTaskStorage,
  loadPreferences,
  savePreferences,
} from "../services/engraving/storage";
import type { Preferences, SavedTask } from "../services/engraving/types";
import { useEngravingUrl } from "./EngravingResultCard";
import { runTaskQueue } from "../services/engraving/task-queue";
const KEY = "custom-monochrome-logo:workspace:v1";
type Slot = { id: string; file?: File };
type State = {
  task: SavedTask;
  busy: boolean;
  ready: boolean;
  loaded: boolean;
  importing: boolean;
};
type Controller = {
  start: (preferences?: Preferences) => Promise<void>;
  stop: () => void;
  flush: () => Promise<void>;
  getTaskId?: () => Promise<string>;
  clearResults?: () => Promise<void>;
};
const DOCUMENT_ID = crypto.randomUUID();
const DOCUMENT_KEY = KEY + ":document",
  BATCH_KEY = KEY + ":batch";
let legacyScopes: string[] = [];
function initialSlots(): Slot[] {
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (
      Array.isArray(data) &&
      data.length &&
      data.length <= 20 &&
      data.every(
        (id) => typeof id === "string" && /^(default|[0-9a-f-]{36})$/i.test(id),
      )
    ) {
      if (sessionStorage.getItem(DOCUMENT_KEY) === DOCUMENT_ID)
        return data.map((id) => ({ id }));
      if (!sessionStorage.getItem(DOCUMENT_KEY)) legacyScopes = data;
    }
  } catch {}
  const slots = [{ id: crypto.randomUUID() }];
  sessionStorage.setItem(DOCUMENT_KEY, DOCUMENT_ID);
  sessionStorage.setItem(BATCH_KEY, crypto.randomUUID());
  sessionStorage.setItem(KEY, JSON.stringify(slots.map((s) => s.id)));
  return slots;
}
function loadSharedPreferences(): Preferences {
  const saved = loadPreferences("batch");
  const initialized = sessionStorage.getItem(
    "custom-monochrome-logo:shared-defaults:v1",
  );

  return {
    ...saved,
    subject: "auto",
    style: "strong",
    reference: "portrait",
    outpaint: {
      instructions: saved.outpaint?.instructions || "",
      enabled: initialized ? saved.outpaint?.enabled !== false : true,
    },
  };
}
function Thumbnail({
  slot,
  state,
  onRemove,
  removeDisabled,
}: {
  slot: Slot;
  state?: State;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  const url = useEngravingUrl(state?.task.original || slot.file);
  if (!url) return null;
  return (
    <div className="replace-scene-card">
      <Image
        src={url}
        alt={state?.task.fileName || slot.file?.name || "原照"}
      />
      <Button
        type="text"
        danger
        block
        icon={<DeleteOutlined />}
        disabled={removeDisabled}
        aria-label={
          "删除原照 " + (state?.task.fileName || slot.file?.name || "原照")
        }
        onClick={onRemove}
      >
        删除
      </Button>
    </div>
  );
}
export default function BatchEngravingComposer({
  openAiApiKey,
  onConfigureKey,
  settingsHost,
}: {
  openAiApiKey: string;
  onConfigureKey: () => void;
  settingsHost?: HTMLElement | null;
}) {
  const [slots, setSlots] = useState(initialSlots),
    [states, setStates] = useState<Record<string, State>>({});
  const [preferences, setPreferences] = useState(loadSharedPreferences);
  const batchActive = useRef(false);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [exportResults, setExportResults] =
    useState<import("../services/engraving/types").StoredResult[]>();
  const [clearingResults, setClearingResults] = useState(false);
  useEffect(() => {
    try {
      savePreferences(preferences, "batch");
      sessionStorage.setItem("custom-monochrome-logo:shared-defaults:v1", "1");
    } catch {
      setError("整批设置无法保存，请检查浏览器存储权限。");
    }
  }, [preferences]);
  const slotsRef = useRef(slots);
  const statesRef = useRef(states);
  statesRef.current = states;
  const controls = useRef(
    new Map<string, React.RefObject<Controller | null>>(),
  );
  const callbacks = useRef(new Map<string, (state: State) => void>());
  const [finishedIds, setFinishedIds] = useState<string[]>([]);
  const [parallel, setParallel] = useState(2),
    [batch, setBatch] = useState(false),
    [deleting, setDeleting] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const batchId = useRef(
    sessionStorage.getItem(BATCH_KEY) || crypto.randomUUID(),
  );
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [historyOpen, setHistoryOpen] = useState(false),
    [history, setHistory] = useState<BatchHistory[]>([]),
    [historyBusy, setHistoryBusy] = useState(false);
  const saveChain = useRef(Promise.resolve());
  const persistBatch = useCallback(() => {
    const id = batchId.current,
      prefs = structuredClone(preferencesRef.current);
    const slotsNow = [...slotsRef.current],
      statesNow = statesRef.current;
    const capturedControls = new Map(
      slotsNow.map((s) => [s.id, controls.current.get(s.id)?.current]),
    );
    const save = async () => {
      await holdBatch(id);
      const tasks = [];
      for (const slot of slotsNow) {
        const state = statesNow[slot.id],
          control = capturedControls.get(slot.id);
        if (!state?.task.original || !control?.getTaskId) continue;
        await control.flush();
        tasks.push({
          id: await control.getTaskId(),
          name: state.task.fileName,
          count: state.task.results?.length || 0,
        });
      }
      if (tasks.length)
        await saveBatchHistory({
          id,
          name:
            tasks[0].name +
            (tasks.length > 1 ? " 等 " + tasks.length + " 张原照" : ""),
          updatedAt: Date.now(),
          preferences: prefs,
          tasks,
        });
    };
    saveChain.current = saveChain.current.catch(() => {}).then(save);
    return saveChain.current;
  }, []);
  useEffect(() => {
    const previousScopes = legacyScopes;
    void holdBatch(batchId.current)
      .then(() =>
        archiveLegacyWorkspace(previousScopes, preferencesRef.current),
      )
      .catch((e) => setError(e.message));
    legacyScopes = [];
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void persistBatch().catch(() =>
          setError("整批历史保存失败，请及时下载结果。"),
        ),
      150,
    );
    return () => clearTimeout(timer);
  }, [states, slots, preferences, persistBatch]);
  useEffect(() => {
    const save = () => {
      void persistBatch().catch(() =>
        setError("整批历史保存失败，请及时下载结果。"),
      );
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
      save();
    };
  }, [persistBatch]);
  async function openHistory() {
    setHistoryBusy(true);
    try {
      await persistBatch();
      setHistory(await listBatchHistory());
      setHistoryOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }
  async function rotateBatch() {
    await persistBatch();
    releaseBatch(batchId.current);
    batchId.current = crypto.randomUUID();
    sessionStorage.setItem(BATCH_KEY, batchId.current);
    await holdBatch(batchId.current);
  }
  async function restoreHistory(entry: BatchHistory) {
    if (batchActive.current) return;
    setHistoryBusy(true);
    try {
      const tasks = await readBatchTasks(entry);
      const next = [];
      for (const task of tasks) {
        const id = crypto.randomUUID();
        await getTaskStorage(id).saveTask(task);
        next.push({ id });
      }
      await rotateBatch();
      slotsRef.current = next;
      setSlots(next);
      setStates({});
      controls.current.clear();
      callbacks.current.clear();
      sessionStorage.setItem(KEY, JSON.stringify(next.map((s) => s.id)));
      setPreferences({
        ...DEFAULT_PREFERENCES,
        ...entry.preferences,
        subject: "auto",
        style: "strong",
        reference: "portrait",
      });
      setHistoryOpen(false);
      setProgress("已恢复整批副本；再次生成会处理全部原照。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }
  async function removeHistory(entries: BatchHistory[]) {
    setHistoryBusy(true);
    try {
      let skipped = 0;
      for (const entry of entries)
        if (!(await deleteBatchHistory(entry))) skipped++;
      setHistory(await listBatchHistory());
      setProgress(
        skipped
          ? "已清理可删除历史；跳过 " + skipped + " 个正在使用的任务。"
          : "历史已清理。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }
  const cancelled = useRef(false);
  const deletingRef = useRef(false);
  const callback = useCallback((id: string) => {
    if (!callbacks.current.has(id))
      callbacks.current.set(id, (state) =>
        setStates((old) =>
          !slotsRef.current.some((s) => s.id === id)
            ? old
            : old[id]?.task === state.task &&
                old[id]?.busy === state.busy &&
                old[id]?.importing === state.importing &&
                old[id]?.loaded === state.loaded &&
                old[id]?.ready === state.ready
              ? old
              : { ...old, [id]: state },
        ),
      );
    return callbacks.current.get(id)!;
  }, []);
  const add = (file: File) => {
    if (
      deletingRef.current ||
      clearingResults ||
      historyBusy ||
      batchActive.current
    )
      return false;
    if (
      file.size > 20 * 1024 * 1024 ||
      (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        file.type,
      ) &&
        !/\.svg$/i.test(file.name))
    ) {
      setError("请导入20MB以内的 JPEG、PNG、WebP 或 SVG 图片。");
      return false;
    }
    {
      const old = slotsRef.current;
      const empty = old.findIndex(
        (s) => !s.file && !statesRef.current[s.id]?.task.original,
      );
      if (empty < 0 && old.length >= 20) {
        setError("单个工作区最多20张，请在新标签继续导入。");
        return false;
      }
      const id = empty >= 0 ? old[empty].id : crypto.randomUUID();
      const next =
        empty >= 0
          ? old.map((s, i) => (i === empty ? { ...s, file } : s))
          : [...old, { id, file }];
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next.map((s) => s.id)));
      } catch {
        setError("无法保存工作区列表，请及时下载结果。");
      }
      slotsRef.current = next;
      setSlots(next);
    }
    return false;
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,[contenteditable=true]",
        )
      )
        return;
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) {
        event.preventDefault();
        files.forEach(add);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  const startAll = async () => {
    if (
      deletingRef.current ||
      clearingResults ||
      historyBusy ||
      batchActive.current
    )
      return;
    if (!openAiApiKey.trim()) {
      onConfigureKey();
      return;
    }
    const uploaded = slotsRef.current.filter(
      (s) => s.file || statesRef.current[s.id]?.task.original,
    );
    if (!uploaded.length) return;
    if (
      uploaded.some(
        (s) =>
          !statesRef.current[s.id]?.ready ||
          statesRef.current[s.id]?.busy ||
          !controls.current.get(s.id)?.current,
      )
    ) {
      setError("请等待全部原照导入完成；导入失败的图片请删除后重新添加。");
      return;
    }
    const snapshot = structuredClone(preferences);
    const items = uploaded.map((s) => ({
      id: s.id,
      run: () => controls.current.get(s.id)!.current!.start(snapshot),
    }));
    batchActive.current = true;
    cancelled.current = false;
    setFinishedIds([]);
    setBatch(true);
    setError("");
    let finished = 0;
    setProgress("准备生成 " + items.length + " 张原照的任务");
    try {
      await runTaskQueue(
        items,
        parallel,
        () => cancelled.current,
        (_id, state) => {
          if (state !== "running") {
            finished++;
            setFinishedIds((ids) => [...ids, _id]);
          }
          setProgress("已处理 " + finished + " / " + items.length + " 个任务");
        },
      );
    } finally {
      batchActive.current = false;
      setBatch(false);
      setProgress(
        cancelled.current
          ? "已停止排队，已返回结果均保留"
          : "批量处理结束，请逐张检查结果",
      );
    }
  };
  const stopAll = () => {
    cancelled.current = true;
    for (const ref of controls.current.values()) ref.current?.stop();
    setProgress("已停止后续请求，已收到结果保留；服务端可能仍处理或计费");
  };
  const removeSlots = async (ids: string[]) => {
    if (
      deletingRef.current ||
      batch ||
      slotsRef.current.some((s) => {
        const state = statesRef.current[s.id];
        return !state?.loaded || state.busy || state.importing;
      })
    )
      return;
    deletingRef.current = true;
    setDeleting(true);
    setError("");
    try {
      // Flush debounced edits before unmounting; saved tasks remain in history.
      for (const id of ids) {
        const controller = controls.current.get(id)?.current;
        if (!controller) throw new Error("任务尚未准备好");
        await controller.flush();
      }
      await rotateBatch();
      const remaining = slotsRef.current.filter((s) => !ids.includes(s.id));
      // A fresh scope prevents the legacy default task reappearing after reload.
      const next = remaining.length ? remaining : [{ id: crypto.randomUUID() }];
      sessionStorage.setItem(KEY, JSON.stringify(next.map((s) => s.id)));
      slotsRef.current = next;
      setSlots(next);
      setStates((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([id]) => !ids.includes(id)),
        ),
      );
      for (const id of ids) {
        controls.current.delete(id);
        callbacks.current.delete(id);
      }
      setProgress("已从工作区删除，已保存的任务仍可从历史恢复");
    } catch {
      setError("未能保存任务或工作区列表，图片尚未删除，请重试。");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };
  const anyBusy = Object.values(states).some((s) => s.busy);
  useEffect(() => {
    reportTaskProgress(
      engravingProgress(
        slots.map((slot) => ({ id: slot.id, ...states[slot.id] })),
        batch,
        finishedIds,
      ),
    );
  }, [slots, states, batch, finishedIds]);
  useEffect(() => () => clearTaskProgress("custom-monochrome-logo"), []);
  const covers = slots.flatMap((slot) => {
    const results = states[slot.id] ? taskResults(states[slot.id].task) : [];
    const best =
      results[coverResultIndex(results, states[slot.id]?.task.coverJobId)];
    return best ? [{ id: slot.id, result: preferredResult(best) }] : [];
  });
  const chosenCovers = covers.filter((c) => selectedResults.includes(c.id));
  async function clearAllResults() {
    if (batchActive.current || anyBusy || clearingResults) return;
    setClearingResults(true);
    try {
      for (const slot of slotsRef.current) {
        const controller = controls.current.get(slot.id)?.current;
        if (
          statesRef.current[slot.id]?.task.results?.length &&
          !controller?.clearResults
        )
          throw new Error("结果尚未准备好，请稍后重试。");
        await controller?.clearResults?.();
      }
      setSelectedResults([]);
      setProgress("已清空当前批次的生成结果，保留原照与设置。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClearingResults(false);
    }
  }
  const removalLocked =
    clearingResults ||
    deleting ||
    historyBusy ||
    batch ||
    anyBusy ||
    slots.some((s) => !states[s.id]?.loaded || states[s.id]?.importing);
  return (
    <section>
      <section className="hero-strip logo-replace-hero">
        <div>
          <span className="eyebrow">PHOTO ENGRAVING</span>
          <h2>客户定制黑白 Logo</h2>
          <p className="hero-description">
            批量提取照片主体，生成可编辑的激光雕刻效果。
          </p>
        </div>
        <div className="hero-orb" />
      </section>
      <Space style={{ marginBottom: 12 }}>
        <Button
          disabled={batch || anyBusy || historyBusy || clearingResults}
          onClick={() => void openHistory()}
        >
          任务历史
        </Button>
      </Space>
      <Modal
        title="整批任务历史"
        open={historyOpen}
        onCancel={() => !historyBusy && setHistoryOpen(false)}
        footer={null}
        width={760}
      >
        <p>
          刷新默认新建空白任务；已保存原照、结果和设置可在这里恢复。使用中的批次不会被删除。
        </p>
        <Popconfirm
          title="清空全部可删除历史？此操作不能撤销。"
          onConfirm={() => removeHistory(history)}
        >
          <Button danger disabled={historyBusy || !history.length}>
            清空历史
          </Button>
        </Popconfirm>
        {!history.length && <p>暂无保存的历史。</p>}
        {history.map((entry) => (
          <Card
            key={entry.id}
            size="small"
            style={{ marginTop: 10 }}
            title={
              entry.name ? (
                <span translate="no">{entry.name}</span>
              ) : (
                "未命名批次"
              )
            }
          >
            <p>
              {entry.tasks.length} 张原照 ·{" "}
              {entry.tasks.reduce((n, t) => n + t.count, 0)} 张结果 ·{" "}
              {new Date(entry.updatedAt).toLocaleString()}
            </p>
            <Space>
              <Button
                disabled={historyBusy}
                onClick={() => void restoreHistory(entry)}
              >
                恢复整批副本
              </Button>
              <Popconfirm
                title="删除这条历史和不再被引用的图片？"
                onConfirm={() => removeHistory([entry])}
              >
                <Button danger disabled={historyBusy}>
                  删除历史
                </Button>
              </Popconfirm>
            </Space>
          </Card>
        ))}
      </Modal>
      <Card title="导入原照" className="workflow-card">
        {!slots.some((s) => s.file || states[s.id]?.task.original) ? (
          <Upload.Dragger
            accept="image/jpeg,image/png,image/webp,image/svg+xml,.svg"
            multiple
            showUploadList={false}
            disabled={
              deleting || batch || slots.some((s) => !states[s.id]?.loaded)
            }
            beforeUpload={add}
          >
            <p className="ant-upload-drag-icon">
              <FileImageOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽导入原照</p>
            <p className="ant-upload-hint">
              支持多张 JPEG / PNG / WebP / SVG，每张不超过20MB，最多20张
            </p>
          </Upload.Dragger>
        ) : (
          <Image.PreviewGroup>
            <div className="replace-scene-grid">
              {slots.map((slot) => (
                <Thumbnail
                  key={slot.id}
                  slot={slot}
                  state={states[slot.id]}
                  onRemove={() => void removeSlots([slot.id])}
                  removeDisabled={removalLocked}
                />
              ))}
              <Upload
                accept="image/jpeg,image/png,image/webp,image/svg+xml,.svg"
                multiple
                showUploadList={false}
                disabled={deleting || historyBusy || batch}
                beforeUpload={add}
              >
                <button
                  type="button"
                  className="replace-logo-add"
                  disabled={deleting || batch}
                >
                  <PlusOutlined />
                  <span>继续添加原照</span>
                </button>
              </Upload>
            </div>
          </Image.PreviewGroup>
        )}
        <Space wrap style={{ marginTop: 12, display: "flex" }}>
          <span>同时处理</span>
          <InputNumber
            aria-label="同时处理任务数"
            min={1}
            max={20}
            precision={0}
            value={parallel}
            disabled={deleting || batch || anyBusy}
            onChange={(v) => v && setParallel(v)}
          />
          <Button
            type="primary"
            disabled={
              deleting ||
              clearingResults ||
              historyBusy ||
              batch ||
              anyBusy ||
              slots.some(
                (s) => !states[s.id]?.loaded || states[s.id]?.importing,
              ) ||
              !Object.values(states).some((s) => s.ready)
            }
            onClick={() => void startAll()}
          >
            全部生成
          </Button>
          <Button disabled={!batch && !anyBusy} onClick={stopAll}>
            全部停止
          </Button>
          <Button
            danger
            aria-label="全部删除"
            loading={deleting}
            disabled={
              removalLocked ||
              !slots.some((s) => s.file || states[s.id]?.task.original)
            }
            onClick={() => void removeSlots(slots.map((s) => s.id))}
          >
            全部删除
          </Button>
          <Tag>设置整批共用 · 每次生成全部原照</Tag>
        </Space>
        <p>
          <small>
            删除仅移出当前工作区，已保存任务可从历史恢复。生成或导入期间不可删除，请先停止并等待任务结束。
          </small>
        </p>
        {progress && <p role="status">{progress}</p>}
        {error && <Alert type="error" title={error} />}
      </Card>
      <Space
        wrap
        className="engraving-gallery-toolbar"
        style={{ marginTop: 20 }}
      >
        <strong>生成结果</strong>
        <Popconfirm
          title="清空当前批次的全部生成结果？请先下载需要的图片。"
          onConfirm={clearAllResults}
        >
          <Button danger disabled={removalLocked || !covers.length}>
            清空结果
          </Button>
        </Popconfirm>
        <Button
          disabled={!covers.length}
          onClick={() => setSelectedResults(covers.map((c) => c.id))}
        >
          全选
        </Button>
        <Button
          disabled={!chosenCovers.length}
          onClick={() => setSelectedResults([])}
        >
          取消选择
        </Button>
        <Button
          disabled={!chosenCovers.length}
          onClick={() => setExportResults(chosenCovers.map((c) => c.result))}
        >
          下载选中
        </Button>
        <Button
          disabled={!covers.length}
          onClick={() => setExportResults(covers.map((c) => c.result))}
        >
          下载全部
        </Button>
        <span>已选 {chosenCovers.length} 张</span>
      </Space>
      <p>
        <small>
          按当前封面下载，默认采用最高分；可在图片弹窗手动采用或下载全部版本。
        </small>
      </p>
      {exportResults && (
        <EngravingExportModal
          results={exportResults}
          onClose={() => setExportResults(undefined)}
        />
      )}
      <div className="engraving-batch-scroll">
        <div className="engraving-batch-results">
          {slots.map((slot, index) => {
            if (!controls.current.has(slot.id))
              controls.current.set(slot.id, createRef<Controller>());
            return (
              <div key={slot.id}>
                <EngravingTaskComposer
                  resultSelection={
                    (slot.file || states[slot.id]?.task.original) && (
                      <Checkbox
                        aria-label={
                          "选择结果 " +
                          (states[slot.id]?.task.fileName ||
                            slot.file?.name ||
                            "原照")
                        }
                        disabled={!covers.some((c) => c.id === slot.id)}
                        checked={selectedResults.includes(slot.id)}
                        onChange={(e) =>
                          setSelectedResults((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, slot.id])]
                              : prev.filter((id) => id !== slot.id),
                          )
                        }
                      />
                    )
                  }
                  scope={slot.id === "default" ? undefined : slot.id}
                  embedded
                  workspaceActive={index === 0}
                  sharedPreferences={preferences}
                  onSharedPreferencesChange={setPreferences}
                  initialFile={slot.file}
                  onTaskState={callback(slot.id)}
                  controllerRef={controls.current.get(slot.id)}
                  openAiApiKey={openAiApiKey}
                  onConfigureKey={onConfigureKey}
                  settingsHost={index === 0 ? settingsHost : null}
                  batchLocked={
                    batch ||
                    deleting ||
                    anyBusy ||
                    historyBusy ||
                    clearingResults
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
