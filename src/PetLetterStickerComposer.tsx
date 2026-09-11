import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  Checkbox,
  Image,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Slider,
  Space,
  Switch,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
  ZoomInOutlined,
} from "@ant-design/icons";
import type { AppSettings } from "./types";
import {
  DEFAULT_SETTINGS,
  HEIGHT,
  LETTERS,
  WIDTH,
  type Layout,
  type PetLibrary,
  type PetResult,
  type PetSettings,
  type Placement,
} from "./services/petStickers/types";
import {
  createLayout,
  defaultLibrary,
  renderLayout,
} from "./services/petStickers/render";
import { constrain, outputDimensions } from "./services/petStickers/layout";
import { importApexFont, latestApexFont } from "./services/petStickers/fonts";
import {
  loadWorkspace,
  readSettings,
  saveSettings,
  saveWorkspace,
} from "./services/petStickers/storage";
import PetStickerLibrary, { usePetUrl } from "./components/PetStickerLibrary";
import PetStickerPreview from "./components/PetStickerPreview";
import { downloadBlob } from "./utils";
import "./pet-letter-stickers.css";
function ResultThumb({ r }: { r: PetResult }) {
  const src = usePetUrl(r.preview);
  return <Image src={src} alt={`${r.layout.letter} 贴纸`} preview={false} />;
}
interface Props {
  active: boolean;
  settings: AppSettings;
  settingsHost: HTMLElement | null;
  onConfigure: () => void;
}
export default function PetLetterStickerComposer({
  active,
  settings: globalSettings,
  settingsHost,
  onConfigure,
}: Props) {
  const [ready, setReady] = useState(false),
    [settings, setSettings] = useState<PetSettings>(readSettings),
    [libraries, setLibraries] = useState<PetLibrary[]>([]),
    [libraryId, setLibraryId] = useState(""),
    [results, setResults] = useState<PetResult[]>([]),
    [currentId, setCurrentId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selectedSprite, setSelectedSprite] = useState(""),
    [libraryOpen, setLibraryOpen] = useState(false),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [previewOpen, setPreviewOpen] = useState(false),
    [exportIds, setExportIds] = useState<string[]>([]),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0),
    [exportScale, setExportScale] = useState<1 | 0.75 | 0.5>(1),
    [fontName, setFontName] = useState("Apex New Medium（请导入字体）");
  const initialized = useRef(false),
    stopped = useRef(false),
    exportStopped = useRef(false),
    renderVersion = useRef(0),
    layoutVersion = useRef(0),
    layoutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    drag = useRef<{ p: Placement; x: number; y: number } | undefined>(
      undefined,
    );
  const library = libraries.find((l) => l.id === libraryId),
    current = results.find((r) => r.id === currentId),
    currentLibrary = libraries.find((l) => l.id === current?.libraryId),
    currentUrl = usePetUrl(current?.preview),
    placement = current?.layout.placements.find((p) => p.id === selectedSprite);
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    void latestApexFont()
      .then((f) => {
        if (f) setFontName(f.name);
      })
      .catch(() => {});
    void (async () => {
      try {
        const [builtin, saved] = await Promise.all([
          defaultLibrary(),
          loadWorkspace(),
        ]);
        const libs = (
          saved?.libraries?.length ? saved.libraries : [builtin]
        ).map((lib) => {
          if (lib.id !== builtin.id) return lib;
          const candy = builtin.assets.find((a) => a.id === "bow-candy");
          return candy
            ? {
                ...lib,
                assets: lib.assets.map((a) => (a.id === candy.id ? candy : a)),
              }
            : lib;
        });
        if (!libs.some((l) => l.id === builtin.id)) libs.unshift(builtin);
        setLibraries(libs);
        setLibraryId(saved?.libraryId || builtin.id);
        const rs = (saved?.results || []).map((r) =>
          r.status === "running" || r.status === "waiting"
            ? {
                ...r,
                status: "stopped" as const,
                error: "上次运行已中断，未自动重发",
              }
            : r,
        );
        setResults(rs);
        setCurrentId(rs.find((r) => r.preview)?.id || "");
        setReady(true);
      } catch (e) {
        setError(`加载失败：${String(e)}`);
        initialized.current = false;
      }
    })();
  }, [active]);
  useEffect(() => {
    if (!ready) return;
    try {
      saveSettings(settings);
    } catch (e) {
      setError(`设置保存失败：${String(e)}`);
    }
  }, [settings, ready]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      void saveWorkspace({ libraries, libraryId, results }).catch((e) =>
        setError(`本地保存失败：${String(e)}，请及时下载`),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [libraries, libraryId, results, ready]);
  // Preview work is keyed by actual document edits, not preview blob changes.
  const layout = current?.layout,
    renderSettings = current?.settings;
  useEffect(() => {
    if (
      !layout ||
      !renderSettings ||
      !currentLibrary ||
      current?.status !== "success"
    )
      return;
    const version = ++renderVersion.current,
      id = current.id;
    const timer = setTimeout(() => {
      void renderLayout(layout, currentLibrary, renderSettings)
        .then((preview) => {
          if (renderVersion.current === version)
            setResults((rs) =>
              rs.map((r) => (r.id === id ? { ...r, preview } : r)),
            );
        })
        .catch((e) => {
          if (renderVersion.current === version) setError(String(e));
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      renderVersion.current++;
    };
  }, [layout, renderSettings, currentLibrary, current?.id, current?.status]);
  async function batch(letters = settings.letters, retry?: PetResult[]) {
    if (!library || running) return;
    const snapshot = structuredClone(settings),
      lib = structuredClone(library);
    if (!letters.length) {
      setError("请选择字母");
      return;
    }
    setRunning(true);
    stopped.current = false;
    setError("");
    try {
      const tasks: PetResult[] =
        retry ||
        letters.map((letter) => ({
          id: crypto.randomUUID(),
          libraryId: lib.id,
          settings: snapshot,
          layout: {
            letter,
            seed: snapshot.seed,
            glyph: {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              fontSize: 0,
              baseline: 0,
              originX: 0,
            },
            placements: [],
            warnings: [],
          },
          status: "waiting",
        }));
      if (!retry) setResults((rs) => [...rs, ...tasks]);
      for (const task of tasks) {
        if (stopped.current) {
          setResults((rs) =>
            rs.map((r) =>
              tasks.some((t) => t.id === r.id) && r.status !== "success"
                ? { ...r, status: "stopped" }
                : r,
            ),
          );
          break;
        }
        setResults((rs) =>
          rs.map((r) =>
            r.id === task.id
              ? {
                  ...r,
                  status: "running",
                  startedAt: Date.now(),
                  error: undefined,
                }
              : r,
          ),
        );
        try {
          const taskLib = retry
            ? libraries.find((l) => l.id === task.libraryId)!
            : lib;
          const doc = task.layout.placements.length
            ? task.layout
            : await createLayout(task.layout.letter, taskLib, task.settings);
          const preview = await renderLayout(doc, taskLib, task.settings);
          setResults((rs) =>
            rs.map((r) =>
              r.id === task.id
                ? {
                    ...r,
                    status: "success",
                    layout: doc,
                    preview,
                    endedAt: Date.now(),
                  }
                : r,
            ),
          );
          setCurrentId((id) => id || task.id);
        } catch (e) {
          setResults((rs) =>
            rs.map((r) =>
              r.id === task.id
                ? {
                    ...r,
                    status: "failed",
                    error: String(e),
                    endedAt: Date.now(),
                  }
                : r,
            ),
          );
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setRunning(false);
    }
  }
  function clearResults() {
    renderVersion.current++;
    layoutVersion.current++;
    clearTimeout(layoutTimer.current);
    setResults([]);
    setCurrentId("");
    setSelected([]);
    setSelectedSprite("");
    setPreviewOpen(false);
    setExportIds([]);
    setExportProgress(0);
  }
  function editLayout(fn: (layout: Layout) => Layout) {
    if (!current || current.status !== "success") return;
    setResults((rs) =>
      rs.map((r) => (r.id === current.id ? { ...r, layout: fn(r.layout) } : r)),
    );
  }
  function change<K extends keyof PetSettings>(key: K, value: PetSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    if (
      current?.status === "success" &&
      !["letters", "scale", "seed"].includes(key)
    ) {
      const s = { ...current.settings, [key]: value };
      if (
        (key === "height" || key === "fontKey" || key === "density") &&
        currentLibrary
      ) {
        const id = current.id;
        const version = ++layoutVersion.current;
        clearTimeout(layoutTimer.current);
        layoutTimer.current = setTimeout(() => {
          void createLayout(current.layout.letter, currentLibrary, s)
            .then(
              (layout) =>
                version === layoutVersion.current &&
                setResults((rs) =>
                  rs.map((r) =>
                    r.id === id ? { ...r, settings: s, layout } : r,
                  ),
                ),
            )
            .catch((e) => setError(String(e)));
        }, 350);
      } else
        setResults((rs) =>
          rs.map((r) => (r.id === current.id ? { ...r, settings: s } : r)),
        );
    }
  }
  async function shuffle() {
    const seed = (settings.seed + 1) >>> 0;
    setSettings((s) => ({ ...s, seed }));
    if (current && currentLibrary) {
      const id = current.id,
        s = { ...current.settings, seed };
      try {
        const layout = await createLayout(
          current.layout.letter,
          currentLibrary,
          s,
        );
        setResults((rs) =>
          rs.map((r) => (r.id === id ? { ...r, layout, settings: s } : r)),
        );
      } catch (e) {
        setError(String(e));
      }
    }
  }
  async function exportSelected() {
    const tasks = structuredClone(
      results.filter((r) => exportIds.includes(r.id) && r.status === "success"),
    );
    const libs = structuredClone(libraries),
      scale = exportScale;
    setExporting(true);
    exportStopped.current = false;
    setExportProgress(0);
    setError("");
    const outputs: { name: string; blob: Blob }[] = [],
      failures: string[] = [];
    try {
      for (let i = 0; i < tasks.length; i++) {
        if (exportStopped.current) break;
        const r = tasks[i];
        try {
          const lib = libs.find((l) => l.id === r.libraryId);
          if (!lib) throw new Error("缺少对应素材库");
          const blob = await renderLayout(
            r.layout,
            lib,
            r.settings,
            outputDimensions(scale).width,
          );
          outputs.push({
            name: `${r.layout.letter}_${r.layout.seed}_${i + 1}.png`,
            blob,
          });
        } catch (e) {
          failures.push(`${r.layout.letter}: ${String(e)}`);
        }
        setExportProgress(Math.round(((i + 1) / tasks.length) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      if (outputs.length === 1) downloadBlob(outputs[0].blob, outputs[0].name);
      else if (outputs.length) {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        outputs.forEach((o) => zip.file(o.name, o.blob));
        downloadBlob(
          await zip.generateAsync({ type: "blob", compression: "STORE" }),
          "萌宠字母贴纸.zip",
        );
      }
      if (failures.length)
        setError(
          `以下导出失败，可用 75% 或 50% 重试；成功部分已下载。${failures.join("；")}`,
        );
      else setExportIds([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  const inspector = (
    <div className="pet-inspector">
      <h3>字母选择</h3>
      <div className="pet-letter-grid">
        {LETTERS.map((l) => (
          <Button
            key={l}
            type={settings.letters.includes(l) ? "primary" : "default"}
            aria-pressed={settings.letters.includes(l)}
            onClick={() =>
              change(
                "letters",
                settings.letters.includes(l)
                  ? settings.letters.filter((x) => x !== l)
                  : LETTERS.filter(
                      (x) => settings.letters.includes(x) || x === l,
                    ),
              )
            }
          >
            {l}
          </Button>
        ))}
      </div>
      <Space>
        <Button size="small" onClick={() => change("letters", LETTERS)}>
          全选 A–Z
        </Button>
        <Button size="small" onClick={() => change("letters", [])}>
          取消选择
        </Button>
        <Button
          size="small"
          onClick={() => change("letters", ["A", "G", "M", "W", "I"])}
        >
          验证五字母
        </Button>
      </Space>
      <h3>角色密度</h3>
      <Slider
        aria-label="角色密度"
        min={0}
        max={100}
        value={settings.density ?? 70}
        marks={{ 0: "疏松", 50: "适中", 100: "密集" }}
        onChange={(v) => change("density", v)}
      />
      <p>
        当前 {settings.density ?? 70}
        %。越高角色越多、间距越小；同一张图的角色大小保持接近，空隙由小贴纸填充，不单独缩小角色。调整会重新排布当前图。
      </p>
      <h3>文字样式</h3>
      <Select
        aria-label="字母字体"
        value={settings.fontKey || "barlow-medium"}
        onChange={(v) => change("fontKey", v)}
        options={[
          { value: "barlow-medium", label: "Barlow Semi Condensed Medium" },
          {
            value: "roboto-condensed-medium",
            label: "Roboto Condensed Medium",
          },
          {
            value:
              settings.fontKey &&
              settings.fontKey !== "anton" &&
              settings.fontKey !== "roboto-condensed-medium" &&
              settings.fontKey !== "barlow-medium"
                ? settings.fontKey
                : "apex-new",
            label: fontName,
          },
          { value: "anton", label: "Anton（原版）" },
        ]}
      />
      {settings.fontKey !== "barlow-medium" &&
        settings.fontKey !== "roboto-condensed-medium" &&
        settings.fontKey !== "anton" && (
          <>
            <Upload
              accept=".otf,.ttf,.woff,.woff2"
              showUploadList={false}
              beforeUpload={async (file) => {
                try {
                  const key = await importApexFont(file);
                  setFontName(file.name);
                  change("fontKey", key);
                } catch (e) {
                  setError(String(e));
                }
                return false;
              }}
            >
              <Button style={{ marginTop: 8 }}>导入 Apex New 字体</Button>
            </Upload>
            <p>
              字体仅保存在本机，不随网站公开分发。Trial /
              个人使用版仅用于相应许可范围；商用请使用获授权文件。
            </p>
          </>
        )}
      {(settings.fontKey === "barlow-medium" ||
        settings.fontKey === "roboto-condensed-medium") && (
        <p>
          内置 Medium 字重，允许商用；随应用附带 SIL OFL
          开源许可证。无需安装或上传字体。
        </p>
      )}
      <label>
        高度（相对画布）{settings.height}%
        <Slider
          min={50}
          max={87}
          value={settings.height}
          onChange={(v) => change("height", v)}
        />
      </label>
      <Space>
        <label>
          颜色
          <input
            type="color"
            aria-label="文字颜色"
            value={settings.fill}
            onChange={(e) => change("fill", e.target.value)}
          />
        </label>
        <Switch
          checkedChildren="渐变"
          unCheckedChildren="纯色"
          checked={settings.gradient}
          onChange={(v) => change("gradient", v)}
        />
        {settings.gradient && (
          <input
            type="color"
            aria-label="渐变结束颜色"
            value={settings.fillEnd}
            onChange={(e) => change("fillEnd", e.target.value)}
          />
        )}
      </Space>
      <label>
        描边
        <Space>
          <input
            type="color"
            aria-label="描边颜色"
            value={settings.stroke}
            onChange={(e) => change("stroke", e.target.value)}
          />
          <InputNumber
            aria-label="描边宽度"
            min={0}
            max={70}
            value={settings.strokeWidth}
            onChange={(v) => change("strokeWidth", v ?? 0)}
          />
        </Space>
      </label>
      <h3>背景</h3>
      <Select
        aria-label="背景"
        value={settings.background}
        onChange={(v) => change("background", v)}
        options={[
          { value: "transparent", label: "透明" },
          { value: "#00aeff", label: "蓝色 #00aeff" },
        ]}
      />
      <h3>输出尺寸</h3>
      <Select
        aria-label="输出尺寸"
        value={settings.scale}
        onChange={(v) => change("scale", v)}
        options={[1, 0.75, 0.5].map((scale) => ({
          value: scale,
          label: `${Math.round(scale * 100)}% · ${outputDimensions(scale).width}×${outputDimensions(scale).height}`,
        }))}
      />
      <p>
        下载重新合成原素材；扩大像素不会增加素材细节。批量逐张输出，资源不足时可手动降低比例。
      </p>
      <h3>随机种子</h3>
      <InputNumber
        aria-label="随机种子"
        min={0}
        max={4294967295}
        value={settings.seed}
        onChange={(v) => change("seed", v ?? 0)}
      />
      <p>
        相同素材、设置和种子可复现排布。调整当前结果的文字样式会实时更新；高度变化会重新排布。
      </p>
      <Button onClick={() => setSettings(structuredClone(DEFAULT_SETTINGS))}>
        重置生成设置
      </Button>
    </div>
  );
  return (
    <div className="pet-tool">
      <header className="pet-header">
        <h2>萌宠字母贴纸</h2>
        <Space wrap>
          <Button disabled={!library} onClick={() => setLibraryOpen(true)}>
            素材库
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void shuffle()}
            disabled={!current}
          >
            换一版排布
          </Button>
          <Button
            type="primary"
            loading={running}
            disabled={!ready || !settings.letters.length}
            onClick={() => void batch()}
          >
            生成所选（{settings.letters.length}）
          </Button>
          {running && (
            <Button
              danger
              onClick={() => {
                stopped.current = true;
              }}
            >
              停止
            </Button>
          )}
        </Space>
      </header>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError("")}
        />
      )}
      <div className="pet-body">
        <main>
          <div className="pet-toolbar">
            <span>
              {current
                ? `${current.layout.letter} · ${currentLibrary?.name}`
                : library?.name || "正在加载素材…"}
            </span>
            <Button
              icon={<ZoomInOutlined />}
              disabled={!current?.preview}
              onClick={() => setPreviewOpen(true)}
            >
              放大预览
            </Button>
            {placement && (
              <>
                <Select
                  aria-label="替换角色或姿势"
                  value={placement.spriteId}
                  style={{ width: 190 }}
                  options={currentLibrary?.assets
                    .filter((a) => a.reviewed)
                    .map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(id) => {
                    const a = currentLibrary!.assets.find((a) => a.id === id)!;
                    editLayout((l) => ({
                      ...l,
                      placements: l.placements.map((p) =>
                        p.id === placement.id
                          ? constrain({
                              ...p,
                              spriteId: id,
                              width: (p.height * a.width) / a.height,
                            })
                          : p,
                      ),
                    }));
                  }}
                />
                <InputNumber
                  aria-label="角色缩放高度"
                  min={80}
                  max={1600}
                  value={Math.round(placement.height)}
                  onChange={(v) => {
                    if (v)
                      editLayout((l) => ({
                        ...l,
                        placements: l.placements.map((p) =>
                          p.id === placement.id
                            ? constrain({
                                ...p,
                                width: (p.width * v) / p.height,
                                height: v,
                              })
                            : p,
                        ),
                      }));
                  }}
                />
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    editLayout((l) => ({
                      ...l,
                      placements: l.placements.filter(
                        (p) => p.id !== selectedSprite,
                      ),
                    }));
                    setSelectedSprite("");
                  }}
                >
                  删除
                </Button>
              </>
            )}
          </div>
          <div
            className="pet-canvas"
            onPointerDown={(e) => {
              if (!current) return;
              const r = e.currentTarget.getBoundingClientRect(),
                x = ((e.clientX - r.left) / r.width) * WIDTH,
                y = ((e.clientY - r.top) / r.height) * HEIGHT;
              const hit = [...current.layout.placements]
                .reverse()
                .find(
                  (p) =>
                    x >= p.x &&
                    x <= p.x + p.width &&
                    y >= p.y &&
                    y <= p.y + p.height,
                );
              setSelectedSprite(hit?.id || "");
              if (hit) {
                drag.current = { p: hit, x, y };
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const r = e.currentTarget.getBoundingClientRect(),
                x = ((e.clientX - r.left) / r.width) * WIDTH,
                y = ((e.clientY - r.top) / r.height) * HEIGHT,
                d = drag.current;
              editLayout((l) => ({
                ...l,
                placements: l.placements.map((p) =>
                  p.id === d.p.id
                    ? constrain({
                        ...p,
                        x: d.p.x + x - d.x,
                        y: d.p.y + y - d.y,
                      })
                    : p,
                ),
              }));
            }}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onPointerCancel={() => {
              drag.current = undefined;
            }}
          >
            {currentUrl ? (
              <img src={currentUrl} alt="当前字母贴纸" draggable={false} />
            ) : (
              <div className="pet-empty">
                选择字母，开始生成可编辑的高清贴纸
                <br />
                <small>默认 A–Z · 本地合成不调用 AI</small>
              </div>
            )}
            {placement && (
              <div
                className="pet-selection"
                style={{
                  left: `${(placement.x / WIDTH) * 100}%`,
                  top: `${(placement.y / HEIGHT) * 100}%`,
                  width: `${(placement.width / WIDTH) * 100}%`,
                  height: `${(placement.height / HEIGHT) * 100}%`,
                }}
              />
            )}
          </div>
          {current?.layout.warnings.map((w) => (
            <Alert key={w} type="warning" title={w} />
          ))}
          <div className="pet-gallery-toolbar">
            <Space wrap>
              <Button
                onClick={() =>
                  setSelected(
                    results
                      .filter((r) => r.status === "success")
                      .map((r) => r.id),
                  )
                }
              >
                全选结果
              </Button>
              <Button onClick={() => setSelected([])}>取消选择</Button>
              <span>
                已选 {selected.length} / 已完成{" "}
                {results.filter((r) => r.status === "success").length}
              </span>
              <Button
                icon={<DownloadOutlined />}
                disabled={!selected.length}
                onClick={() => {
                  setExportScale(settings.scale);
                  setExportIds(selected);
                }}
              >
                下载所选
              </Button>
              <Button
                disabled={
                  running ||
                  !results.some((r) => ["failed", "stopped"].includes(r.status))
                }
                onClick={() =>
                  void batch(
                    settings.letters,
                    results.filter((r) =>
                      ["failed", "stopped"].includes(r.status),
                    ),
                  )
                }
              >
                重试失败 / 停止项
              </Button>
              <Popconfirm
                title="清空全部结果？"
                description="已生成的预览和编辑结果将从本机历史中移除，且无法恢复。"
                okText="确认清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={clearResults}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!results.length || running || exporting}
                >
                  清空结果
                </Button>
              </Popconfirm>
            </Space>
          </div>
          <div className="pet-gallery">
            {results.map((r) => (
              <article
                key={r.id}
                className={r.id === currentId ? "active" : ""}
              >
                <button
                  className="pet-thumb"
                  onClick={() => {
                    setCurrentId(r.id);
                    setSelectedSprite("");
                  }}
                  onDoubleClick={() => {
                    setCurrentId(r.id);
                    setPreviewOpen(true);
                  }}
                >
                  <ResultThumb r={r} />
                </button>
                <div>
                  <Checkbox
                    checked={selected.includes(r.id)}
                    disabled={r.status !== "success"}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, r.id]
                          : ids.filter((id) => id !== r.id),
                      )
                    }
                  >
                    {r.layout.letter}
                  </Checkbox>
                  <small>
                    {r.status === "success"
                      ? "完成"
                      : r.status === "running"
                        ? "合成中"
                        : r.status === "failed"
                          ? "失败"
                          : r.status === "stopped"
                            ? "停止"
                            : "等待"}
                  </small>
                  <Button
                    size="small"
                    disabled={!r.preview}
                    onClick={() => {
                      setCurrentId(r.id);
                      setPreviewOpen(true);
                    }}
                    aria-label={`放大 ${r.layout.letter}`}
                    icon={<ZoomInOutlined />}
                  />
                  <Button
                    size="small"
                    disabled={r.status !== "success"}
                    onClick={() => {
                      setExportScale(settings.scale);
                      setExportIds([r.id]);
                    }}
                    aria-label={`下载 ${r.layout.letter}`}
                    icon={<DownloadOutlined />}
                  />
                </div>
                {r.error && <small>{r.error}</small>}
              </article>
            ))}
          </div>
        </main>
        {!settingsHost && active && <aside>{inspector}</aside>}
      </div>
      {settingsHost && createPortal(inspector, settingsHost)}
      {library && (
        <PetStickerLibrary
          open={libraryOpen}
          onClose={() => setLibraryOpen(false)}
          libraries={libraries}
          library={library}
          settings={globalSettings}
          onConfigure={onConfigure}
          onSelect={setLibraryId}
          onSave={(lib) => {
            setLibraries((ls) =>
              ls.some((l) => l.id === lib.id)
                ? ls.map((l) => (l.id === lib.id ? lib : l))
                : [...ls, lib],
            );
            setLibraryId(lib.id);
          }}
        />
      )}
      <PetStickerPreview
        results={results}
        currentId={currentId}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onChange={setCurrentId}
        onDownload={(id) => {
          setExportScale(settings.scale);
          setExportIds([id]);
        }}
      />
      <Modal
        title="选择输出尺寸"
        open={exportIds.length > 0}
        onCancel={() => {
          if (!exporting) setExportIds([]);
        }}
        onOk={() => void exportSelected()}
        confirmLoading={exporting}
        okText="确定并下载"
        cancelButtonProps={{ disabled: exporting }}
        closable={!exporting}
      >
        <p>
          将导出 {exportIds.length} 张，采用确认时的布局及参数快照。透明 /
          蓝底取自各张结果。
        </p>
        <Select
          aria-label="下载比例"
          disabled={exporting}
          value={exportScale}
          onChange={setExportScale}
          options={[1, 0.75, 0.5].map((scale) => ({
            value: scale,
            label: `${Math.round(scale * 100)}% · ${outputDimensions(scale).width}×${outputDimensions(scale).height}px`,
          }))}
        />
        <p>目标尺寸独立于其他工具限制；浏览器资源不足时不会静默降低清晰度。</p>
        {exporting && (
          <>
            <Progress percent={exportProgress} />
            <Button
              onClick={() => {
                exportStopped.current = true;
              }}
            >
              停止并下载已完成部分
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
}
