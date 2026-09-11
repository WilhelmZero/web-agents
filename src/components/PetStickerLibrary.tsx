import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Upload,
} from "antd";
import type { AiProvider, AppSettings } from "../types";
import type {
  PetLibrary,
  PoseCandidate,
  Rect,
  Sprite,
} from "../services/petStickers/types";
import {
  cropSprite,
  detectSheet,
  unionRegions,
} from "../services/petStickers/import";
import { generatePose } from "../services/petStickers/poses";
import {
  hasUsableTransparency,
  removeImageBackground,
} from "../services/backgroundRemoval";
export function usePetUrl(blob?: Blob, src = "") {
  const [url, setUrl] = useState(src);
  useEffect(() => {
    if (!blob) {
      setUrl(src);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, src]);
  return url;
}
export function PetImage({
  asset,
}: {
  asset: Pick<Sprite, "blob" | "src" | "name">;
}) {
  const src = usePetUrl(asset.blob, asset.src);
  return <Image src={src} alt={asset.name} />;
}
interface Props {
  open: boolean;
  onClose: () => void;
  libraries: PetLibrary[];
  library: PetLibrary;
  onSave: (lib: PetLibrary) => void;
  onSelect: (id: string) => void;
  settings: AppSettings;
  onConfigure: () => void;
}
export default function PetStickerLibrary(p: Props) {
  const [source, setSource] = useState<Blob>(),
    [name, setName] = useState("我的贴纸"),
    [regions, setRegions] = useState<Rect[]>([]),
    [chosen, setChosen] = useState<number[]>([]),
    [active, setActive] = useState(0),
    [transparent, setTransparent] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [characters, setCharacters] = useState<string[]>([]),
    [candidates, setCandidates] = useState<PoseCandidate[]>([]),
    [provider, setProvider] = useState<AiProvider>("gemini"),
    [generating, setGenerating] = useState(false),
    [checks, setChecks] = useState<Record<string, boolean>>({});
  const stop = useRef(false),
    controller = useRef<AbortController | undefined>(undefined),
    url = usePetUrl(source);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const candidateLibrary = useRef(p.library.id);
  useEffect(() => {
    candidateLibrary.current = p.library.id;
    setCharacters(
      p.library.assets
        .filter((a) => a.pose === "full" && a.kind === "character")
        .slice(0, 3)
        .map((a) => a.id),
    );
    setCandidates(
      (p.library.candidates || []).map((c) =>
        ["running", "waiting"].includes(c.status)
          ? { ...c, status: "stopped", error: "上次制作中断，未自动重发" }
          : c,
      ),
    );
    setChecks({});
  }, [p.library.id]);
  useEffect(() => {
    if (
      candidateLibrary.current === p.library.id &&
      p.library.candidates !== candidates
    )
      p.onSave({ ...p.library, candidates });
  }, [candidates]);
  async function analyze(blob: Blob) {
    setBusy(true);
    setError("");
    try {
      const r = await detectSheet(blob);
      setSource(blob);
      setTransparent(r.transparent);
      setRegions(r.regions);
      setChosen(r.regions.map((_, i) => i).slice(0, 32));
      setActive(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 50 * 1024 * 1024
    ) {
      setError("仅支持不超过 50MB 的 PNG、JPEG、WebP");
      return false;
    }
    setName(file.name.replace(/\.[^.]+$/, ""));
    await analyze(file);
    return false;
  }
  async function saveImport() {
    if (!source || !chosen.length || !transparent) return;
    setBusy(true);
    try {
      const assets: Sprite[] = [];
      for (const i of chosen)
        assets.push(
          await cropSprite(source, regions[i], `角色 ${assets.length + 1}`),
        );
      p.onSave({
        id: crypto.randomUUID(),
        version: 1,
        name: name.trim() || "我的贴纸",
        source,
        assets,
      });
      setSource(undefined);
      setRegions([]);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function run(items: PoseCandidate[]) {
    if (generating) return;
    const snapshot = p.library;
    setGenerating(true);
    stop.current = false;
    setCandidates((cs) => [
      ...cs.filter((c) => !items.some((i) => i.id === c.id)),
      ...items,
    ]);
    try {
      for (const item of items) {
        if (stop.current) {
          setCandidates((cs) =>
            cs.map((c) =>
              c.status === "waiting" ? { ...c, status: "stopped" } : c,
            ),
          );
          break;
        }
        controller.current = new AbortController();
        setCandidates((cs) =>
          cs.map((c) => (c.id === item.id ? { ...c, status: "running" } : c)),
        );
        try {
          const blob = await generatePose(
            snapshot.assets.find((a) => a.id === item.characterId)!,
            item.pose,
            p.settings,
            provider,
            controller.current.signal,
          );
          setCandidates((cs) =>
            cs.map((c) =>
              c.id === item.id ? { ...c, blob, status: "review" } : c,
            ),
          );
        } catch (e) {
          setCandidates((cs) =>
            cs.map((c) =>
              c.id === item.id
                ? {
                    ...c,
                    status: stop.current ? "stopped" : "failed",
                    error: String(e),
                  }
                : c,
            ),
          );
        }
      }
    } finally {
      setGenerating(false);
    }
  }
  function confirmGenerate() {
    if (
      !(provider === "gemini" ? p.settings.apiKey : p.settings.openAiApiKey)
    ) {
      p.onConfigure();
      return;
    }
    Modal.confirm({
      title: `制作 ${characters.length * 2} 张互动姿势？`,
      content:
        "只向所选 AI 服务发送已选角色裁切图。会产生真实生图费用，每个角色 2 次请求。结果必须检查并采用后才能用于排版，失败不会自动重试。",
      onOk: () => {
        const items = characters.flatMap((characterId) =>
          (["top", "side"] as const).map((pose) => ({
            id: crypto.randomUUID(),
            characterId,
            pose,
            status: "waiting" as const,
            contact: pose === "top" ? { x: 0.5, y: 0.8 } : { x: 0.12, y: 0.5 },
            notes: "",
          })),
        );
        void run(items);
      },
    });
  }
  async function accept(c: PoseCandidate) {
    if (!c.blob) return;
    try {
      if (!(await hasUsableTransparency(c.blob))) {
        setError("此图没有有效透明通道，请上传修正后的透明 PNG 再采用");
        return;
      }
      const bitmap = await createImageBitmap(c.blob);
      const asset: Sprite = {
        id: c.id,
        name: `${p.library.assets.find((a) => a.id === c.characterId)?.name} · ${c.pose === "top" ? "趴顶" : "抱边"}`,
        kind: "character",
        pose: c.pose,
        characterId: c.characterId,
        reviewed: true,
        blob: c.blob,
        src: "",
        width: bitmap.width,
        height: bitmap.height,
        contact: c.contact,
        reviewNotes: c.notes,
      };
      bitmap.close();
      p.onSave({
        ...p.library,
        assets: [...p.library.assets.filter((a) => a.id !== c.id), asset],
      });
      setCandidates((cs) =>
        cs.map((x) => (x.id === c.id ? { ...x, status: "accepted" } : x)),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  const current = regions[active];
  return (
    <Modal
      title="贴纸素材库"
      open={p.open}
      onCancel={p.onClose}
      width={1180}
      footer={<Button onClick={p.onClose}>关闭</Button>}
      forceRender
    >
      <div className="pet-library">
        <Space wrap>
          <Select
            aria-label="选择素材库"
            value={p.library.id}
            disabled={generating}
            style={{ width: 240 }}
            options={p.libraries.map((l) => ({ value: l.id, label: l.name }))}
            onChange={p.onSelect}
          />
          <Upload
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            beforeUpload={upload}
            disabled={busy || generating}
          >
            <Button>上传替换贴纸</Button>
          </Upload>
        </Space>
        <p>
          内置素材随网站公开分发。上传素材仅保存在本机，确认制作姿势时才发送所选角色。切换素材库不会混用角色。
        </p>
        {error && (
          <Alert
            type="error"
            title={error}
            closable
            onClose={() => setError("")}
          />
        )}
        {source ? (
          <>
            <Input
              aria-label="素材库名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {!transparent && (
              <Alert
                type="warning"
                title="未发现透明背景，请先进行背景分离并检查黑猫、眼睛及边缘"
                action={
                  <Button
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await analyze(await removeImageBackground(source));
                      } catch (e) {
                        setError(String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    本地背景分离
                  </Button>
                }
              />
            )}
            <div
              className="pet-sheet"
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                drag.current = {
                  x: (e.clientX - r.left) / r.width,
                  y: (e.clientY - r.top) / r.height,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerUp={(e) => {
                if (!drag.current) return;
                const r = e.currentTarget.getBoundingClientRect(),
                  x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                  y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
                  d = drag.current;
                drag.current = undefined;
                const rect = {
                  x: Math.min(x, d.x),
                  y: Math.min(y, d.y),
                  width: Math.abs(x - d.x),
                  height: Math.abs(y - d.y),
                };
                if (rect.width > 0.01 && rect.height > 0.01) {
                  setRegions((rs) => [...rs, rect]);
                  setChosen((cs) => [...cs, regions.length]);
                  setActive(regions.length);
                }
              }}
            >
              <img src={url} alt="素材拆分框选" draggable={false} />
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
                {regions.map((r, i) => (
                  <rect
                    key={i}
                    x={r.x * 1000}
                    y={r.y * 1000}
                    width={r.width * 1000}
                    height={r.height * 1000}
                    fill={chosen.includes(i) ? "#1677ff18" : "transparent"}
                    stroke={active === i ? "#ff7900" : "#1677ff"}
                    strokeWidth="2"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setActive(i)}
                  />
                ))}
              </svg>
            </div>
            <p>
              拖动添加完整角色框；自动检测只是候选，请合并属于同一角色的碎片，并排除装饰或残缺角色后保存。
            </p>
            <Space wrap>
              <Select
                aria-label="编辑框选"
                value={active}
                onChange={setActive}
                options={regions.map((_, i) => ({
                  value: i,
                  label: `范围 ${i + 1}`,
                }))}
              />
              {current &&
                (["x", "y", "width", "height"] as const).map((k) => (
                  <label key={k}>
                    {k}
                    <InputNumber
                      min={0}
                      max={1}
                      step={0.005}
                      value={current[k]}
                      onChange={(v) =>
                        setRegions((rs) =>
                          rs.map((r, i) =>
                            i === active ? { ...r, [k]: v ?? 0 } : r,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              <Checkbox
                checked={chosen.includes(active)}
                onChange={(e) =>
                  setChosen((cs) =>
                    e.target.checked
                      ? [...cs, active]
                      : cs.filter((i) => i !== active),
                  )
                }
              >
                保留此范围
              </Checkbox>
            </Space>
            <Space wrap>
              <Button onClick={() => setChosen(regions.map((_, i) => i))}>
                全选范围
              </Button>
              <Button onClick={() => setChosen([])}>取消选择</Button>
              <Button
                disabled={chosen.length < 2}
                onClick={() => {
                  const merged = unionRegions(chosen.map((i) => regions[i]));
                  setRegions((rs) => [
                    ...rs.filter((_, i) => !chosen.includes(i)),
                    merged,
                  ]);
                  setChosen([regions.length - chosen.length]);
                  setActive(regions.length - chosen.length);
                }}
              >
                合并已选碎片
              </Button>
              <Button
                type="primary"
                disabled={!transparent || !chosen.length}
                loading={busy}
                onClick={saveImport}
              >
                确认完整角色并保存（{chosen.length}）
              </Button>
            </Space>
          </>
        ) : (
          <>
            <div className="pet-sprite-grid">
              {p.library.assets.map((a) => (
                <div key={a.id}>
                  <PetImage asset={a} />
                  <div>{a.name}</div>
                  {a.pose === "full" && a.kind === "character" && (
                    <Checkbox
                      disabled={generating}
                      checked={characters.includes(a.id)}
                      onChange={(e) =>
                        setCharacters((cs) =>
                          e.target.checked
                            ? [...cs, a.id]
                            : cs.filter((id) => id !== a.id),
                        )
                      }
                    >
                      制作互动姿势
                    </Checkbox>
                  )}
                </div>
              ))}
            </div>
            <Space wrap>
              <Select
                aria-label="姿势生成服务"
                disabled={generating}
                value={provider}
                onChange={setProvider}
                options={[
                  {
                    value: "gemini",
                    label: `Gemini · ${p.settings.imageModel}`,
                  },
                  { value: "openai", label: "GPT Image 2" },
                ]}
              />
              <Button
                disabled={!characters.length || generating}
                onClick={confirmGenerate}
              >
                制作趴顶和抱边（{characters.length * 2} 次请求）
              </Button>
              {generating && (
                <Button
                  onClick={() => {
                    stop.current = true;
                  }}
                >
                  停止后续请求（当前返回后保留）
                </Button>
              )}
            </Space>
            <div className="pet-candidates">
              {candidates.map((c) => (
                <div key={c.id}>
                  <strong>
                    {c.pose === "top" ? "趴顶" : "抱边"} · {c.status}
                  </strong>
                  {c.blob && (
                    <PetImage
                      asset={{ blob: c.blob, src: "", name: "待审核姿势" }}
                    />
                  )}
                  {c.error && <Alert title={c.error} type="error" />}
                  {c.status === "review" && (
                    <>
                      <p>
                        核对角色一致、眼睛、四肢、尾巴、透明边缘。调整接触点（归一化坐标）：
                      </p>
                      <Space>
                        {(["x", "y"] as const).map((k) => (
                          <InputNumber
                            key={k}
                            aria-label={`接触点 ${k}`}
                            value={c.contact[k]}
                            min={0}
                            max={1}
                            step={0.01}
                            onChange={(v) =>
                              setCandidates((cs) =>
                                cs.map((x) =>
                                  x.id === c.id
                                    ? {
                                        ...x,
                                        contact: {
                                          ...x.contact,
                                          [k]: v ?? 0.5,
                                        },
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        ))}
                      </Space>
                      <Input
                        placeholder="审核 / 修正备注"
                        value={c.notes}
                        onChange={(e) =>
                          setCandidates((cs) =>
                            cs.map((x) =>
                              x.id === c.id
                                ? { ...x, notes: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                      <Upload
                        accept="image/png"
                        showUploadList={false}
                        beforeUpload={(file) => {
                          setCandidates((cs) =>
                            cs.map((x) =>
                              x.id === c.id ? { ...x, blob: file } : x,
                            ),
                          );
                          setChecks((s) => ({ ...s, [c.id]: false }));
                          return false;
                        }}
                      >
                        <Button>上传修正后的透明 PNG</Button>
                      </Upload>
                      <Checkbox
                        checked={checks[c.id] || false}
                        onChange={(e) =>
                          setChecks((s) => ({ ...s, [c.id]: e.target.checked }))
                        }
                      >
                        已检查完整性、风格与透明边缘
                      </Checkbox>
                      <Button
                        type="primary"
                        disabled={!checks[c.id]}
                        onClick={() => void accept(c)}
                      >
                        采用姿势
                      </Button>
                    </>
                  )}
                  {!generating && c.status !== "accepted" && (
                    <Button
                      onClick={() =>
                        void run([
                          { ...c, status: "waiting", error: undefined },
                        ])
                      }
                    >
                      重新制作（1 次请求）
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
