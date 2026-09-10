import { useState, useRef, useCallback, createRef } from "react";
import {
  Alert,
  Button,
  Card,
  Image,
  InputNumber,
  Space,
  Upload,
  Tag,
} from "antd";
import { EngravingTaskComposer } from "../CustomMonochromeLogoComposer";
import type { SavedTask } from "../services/engraving/types";
import { useEngravingUrl } from "./EngravingResultCard";
import { runTaskQueue } from "../services/engraving/task-queue";
const KEY = "custom-monochrome-logo:workspace:v1";
type Slot = { id: string; file?: File };
type State = { task: SavedTask; busy: boolean; ready: boolean; loaded: boolean; importing: boolean };
type Controller = { start: () => Promise<void>; stop: () => void };
function initialSlots(): Slot[] {
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (
      Array.isArray(data) &&
      data.length &&
      data.length <= 20 &&
      data.every(
        (x) => typeof x === "string" && /^(default|[a-f0-9-]{36})$/.test(x),
      )
    )
      return [...new Set(data)].map((id) => ({ id }));
  } catch {}
  return [{ id: "default" }];
}
function Thumbnail({
  slot,
  state,
  selected,
  onSelect,
}: {
  slot: Slot;
  state?: State;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = useEngravingUrl(state?.task.original || slot.file);
  return (
    <Card
      size="small"
      style={{ width: 150, borderColor: selected ? "#1677ff" : undefined }}
    >
      {url ? (
        <Image
          width={112}
          height={86}
          style={{ objectFit: "contain" }}
          src={url}
          alt={state?.task.fileName || slot.file?.name || "原照"}
        />
      ) : (
        <div style={{ height: 86 }}>等待导入</div>
      )}
      <Button
        aria-label={"切换任务 " + (state?.task.fileName || slot.file?.name || "当前任务")}
        type={selected ? "primary" : "default"}
        size="small"
        block
        onClick={onSelect}
        style={{ marginTop: 8 }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {state?.task.fileName || slot.file?.name || "当前任务"}
        </span>
      </Button>
      <small>
        {state?.busy
          ? "生成中"
          : state?.task.run?.status === "failed"
            ? "失败，可单独重试"
            : state?.ready
              ? "就绪"
              : state?.loaded ? "待导入" : "读取中"}{" "}
        · {state?.task.results?.length || 0} 张
      </small>
    </Card>
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
    [selected, setSelected] = useState(() => slots[0].id),
    [states, setStates] = useState<Record<string, State>>({});
  const slotsRef = useRef(slots);
  const statesRef = useRef(states);
  statesRef.current = states;
  const controls = useRef(
    new Map<string, React.RefObject<Controller | null>>(),
  );
  const callbacks = useRef(new Map<string, (state: State) => void>());
  const [parallel, setParallel] = useState(2),
    [batch, setBatch] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const cancelled = useRef(false);
  const callback = useCallback((id: string) => {
    if (!callbacks.current.has(id))
      callbacks.current.set(id, (state) =>
        setStates((old) =>
          old[id]?.task === state.task &&
          old[id]?.busy === state.busy &&
          old[id]?.importing === state.importing && old[id]?.loaded === state.loaded && old[id]?.ready === state.ready
            ? old
            : { ...old, [id]: state },
        ),
      );
    return callbacks.current.get(id)!;
  }, []);
  const add = (file: File) => {
    if (
      file.size > 20 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      setError("请导入20MB以内的 JPEG、PNG 或 WebP 图片。");
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
      setSelected(id);
      slotsRef.current = next;
      setSlots(next);
    }
    return false;
  };
  const startAll = async () => {
    if (!openAiApiKey.trim()) {
      onConfigureKey();
      return;
    }
    const items = slots
      .filter(
        (s) => statesRef.current[s.id]?.ready && !statesRef.current[s.id]?.busy,
      )
      .map((s) => ({
        id: s.id,
        run: () =>
          controls.current.get(s.id)?.current?.start() || Promise.resolve(),
      }));
    if (!items.length) return;
    cancelled.current = false;
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
          if (state !== "running") finished++;
          setProgress("已处理 " + finished + " / " + items.length + " 个任务");
        },
      );
    } finally {
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
    setProgress("停止后续请求，正在返回的结果仍会保存");
  };
  const anyBusy = Object.values(states).some((s) => s.busy);
  return (
    <section>
      <Card title="导入原照 · 多图独立任务" className="workflow-card">
        <Upload.Dragger
          accept="image/jpeg,image/png,image/webp"
          multiple
          showUploadList={false}
          disabled={batch || slots.some((s) => !states[s.id]?.loaded)}
          beforeUpload={add}
        >
          <p>点击或拖拽导入多张原照</p>
          <small>
            每张
            ≤20MB、≤4000万像素；最多20个任务。点击缩略图放大，点击文件名切换任务。
          </small>
        </Upload.Dragger>
        <Space wrap style={{ marginTop: 12, alignItems: "flex-start" }}>
          {slots.map((slot) => (
            <Thumbnail
              key={slot.id}
              slot={slot}
              state={states[slot.id]}
              selected={selected === slot.id}
              onSelect={() => setSelected(slot.id)}
            />
          ))}
        </Space>
        <Space wrap style={{ marginTop: 12, display: "flex" }}>
          <span>同时处理</span>
          <InputNumber
            aria-label="同时处理任务数"
            min={1}
            max={4}
            precision={0}
            value={parallel}
            disabled={batch || anyBusy}
            onChange={(v) => v && setParallel(v)}
          />
          <Button
            type="primary"
            disabled={
              batch || anyBusy || slots.some(s=>!states[s.id]?.loaded || states[s.id]?.importing) || !Object.values(states).some((s) => s.ready)
            }
            onClick={() => void startAll()}
          >
            全部生成
          </Button>
          <Button disabled={!batch && !anyBusy} onClick={stopAll}>
            全部停止
          </Button>
          <Tag>每张图独立计费 · 设置按图分别配置</Tag>
        </Space>
        {progress && <p role="status">{progress}</p>}
        {error && <Alert type="error" title={error} />}
      </Card>
      {slots.map((slot) => {
        if (!controls.current.has(slot.id))
          controls.current.set(slot.id, createRef<Controller>());
        return (
          <div key={slot.id} hidden={selected !== slot.id}>
            <EngravingTaskComposer
              scope={slot.id === "default" ? undefined : slot.id}
              embedded
              initialFile={slot.file}
              onTaskState={callback(slot.id)}
              controllerRef={controls.current.get(slot.id)}
              openAiApiKey={openAiApiKey}
              onConfigureKey={onConfigureKey}
              settingsHost={selected === slot.id ? settingsHost : undefined}
              batchLocked={batch}
            />
          </div>
        );
      })}
    </section>
  );
}
