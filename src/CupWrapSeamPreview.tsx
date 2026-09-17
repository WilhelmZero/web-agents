import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Modal, Space, Spin } from "antd";
import {
  CompressOutlined,
  ExpandOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { Texture } from "three";
import type { CupParams } from "./services/cupWrap/geometry";
import { geometry } from "./services/cupWrap/geometry";
import { seamPreviewGeometry } from "./services/cupWrap/seam3d";
import { warpPoint } from "./services/cupWrap/warp";
import {
  detectBorderMatte,
  restoreTransparentBackground,
} from "./services/transparentImageEdit";

export interface CupWrapSeamPreviewProps {
  open: boolean;
  cup: CupParams;
  texture?: Blob;
  textureHasTransparency?: boolean;
  initialShowGlass?: boolean;
  onClose: () => void;
}

async function unwrapTexture(blob: Blob, cup: CupParams) {
  const bitmap = await createImageBitmap(blob);
  const g = geometry(cup);
  const input = document.createElement("canvas");
  input.width = bitmap.width;
  input.height = bitmap.height;
  const inputContext = input.getContext("2d", { willReadFrequently: true })!;
  inputContext.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = inputContext.getImageData(0, 0, input.width, input.height);
  const output = document.createElement("canvas");
  output.width = 1024;
  output.height = Math.max(
    256,
    Math.round(
      (output.width * g.slant) / Math.max(1, (g.topArc + g.bottomArc) / 2),
    ),
  );
  const outputContext = output.getContext("2d")!;
  const result = outputContext.createImageData(output.width, output.height);
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const point = warpPoint(
        g,
        (x + 0.5) / output.width,
        (y + 0.5) / output.height,
        1,
      );
      const sx = Math.max(
        0,
        Math.min(
          input.width - 1,
          Math.round((point.x / g.width) * input.width),
        ),
      );
      const sy = Math.max(
        0,
        Math.min(
          input.height - 1,
          Math.round((point.y / g.height) * input.height),
        ),
      );
      const sourceIndex = (sy * input.width + sx) * 4;
      const targetIndex = (y * output.width + x) * 4;
      result.data[targetIndex] = pixels.data[sourceIndex];
      result.data[targetIndex + 1] = pixels.data[sourceIndex + 1];
      result.data[targetIndex + 2] = pixels.data[sourceIndex + 2];
      result.data[targetIndex + 3] = pixels.data[sourceIndex + 3];
    }
  }
  outputContext.putImageData(result, 0, 0);
  return output;
}

export default function CupWrapSeamPreview({
  open,
  cup,
  texture,
  textureHasTransparency = false,
  initialShowGlass = true,
  onClose,
}: CupWrapSeamPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setViewRef = useRef<(side: "front" | "seam") => void>(() => {});
  const setGlassVisibleRef = useRef<(visible: boolean) => void>(() => {});
  const setExpandedRef = useRef<(expanded: boolean) => void>(() => {});
  const receivedTextureProp = useRef(false);
  const [showGlass, setShowGlass] = useState(initialShowGlass);
  const [status, setStatus] = useState("");
  const [activeTexture, setActiveTexture] = useState(texture);
  const [textureRevision, setTextureRevision] = useState(0);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [backgroundRemoved, setBackgroundRemoved] = useState(
    textureHasTransparency,
  );
  const [expanded, setExpanded] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState("");
  const [initializationAttempt, setInitializationAttempt] = useState(0);

  useEffect(() => {
    if (!receivedTextureProp.current) {
      receivedTextureProp.current = true;
      return;
    }
    setActiveTexture(texture);
    setBackgroundRemoved(textureHasTransparency);
    setTextureRevision((revision) => revision + 1);
  }, [texture, textureHasTransparency]);

  useEffect(() => setGlassVisibleRef.current(showGlass), [showGlass]);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    let disposed = false;
    let cleanup = () => {};
    setInitializing(true);
    setInitializationError("");
    setStatus("正在建立 3D 杯身…");
    Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(async ([THREE, controlsModule]) => {
        if (disposed || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf3f5f8);
        const camera = new THREE.PerspectiveCamera(
          38,
          canvas.clientWidth / Math.max(1, canvas.clientHeight),
          0.1,
          5000,
        );
        const controls = new controlsModule.OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.target.set(0, 0, 0);
        const metrics = seamPreviewGeometry(cup);
        const flatGeometry = geometry({
          ...cup,
          topInset: 0,
          bottomInset: 0,
        });
        const distance = Math.max(
          cup.height * 1.7,
          cup.top * 3.2,
          flatGeometry.width * 1.45,
        );
        const setView = (side: "front" | "seam") => {
          camera.position.set(
            0,
            cup.height * 0.08,
            side === "front" ? distance : -distance,
          );
          camera.up.set(0, 1, 0);
          controls.target.set(0, 0, 0);
          controls.update();
        };
        setViewRef.current = setView;
        setView("seam");

        scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 3.2);
        key.position.set(80, 120, 100);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x99ccff, 2.2);
        rim.position.set(-80, 30, -100);
        scene.add(rim);

        const resources: Array<{ dispose: () => void }> = [];
        let frame = 0;
        let observer: ResizeObserver | undefined;
        let cleaned = false;
        const contextLost = (event: Event) => {
          event.preventDefault();
          if (disposed) return;
          setInitializing(false);
          setInitializationError(
            "浏览器的 3D 图形上下文已丢失，可能是显存紧张或同时打开了过多 3D 页面。请关闭其他 3D 页面后重试。",
          );
        };
        canvas.addEventListener("webglcontextlost", contextLost);
        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          cancelAnimationFrame(frame);
          observer?.disconnect();
          canvas.removeEventListener("webglcontextlost", contextLost);
          controls.dispose();
          resources.forEach((resource) => resource.dispose());
          renderer.dispose();
          renderer.forceContextLoss();
        };
        const group = new THREE.Group();
        scene.add(group);
        const glassGroup = new THREE.Group();
        glassGroup.visible = showGlass;
        group.add(glassGroup);
        setGlassVisibleRef.current = (visible) => {
          glassGroup.visible = visible;
        };
        const glassGeometry = new THREE.CylinderGeometry(
          metrics.topRadius,
          metrics.bottomRadius,
          metrics.height,
          128,
          1,
          true,
        );
        const glassMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xdff7ff,
          transparent: true,
          opacity: 0.24,
          roughness: 0.08,
          metalness: 0,
          transmission: 0.72,
          thickness: 1.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        glassGroup.add(new THREE.Mesh(glassGeometry, glassMaterial));
        resources.push(glassGeometry, glassMaterial);
        const bottomGeometry = new THREE.CircleGeometry(
          metrics.bottomRadius,
          128,
        );
        const bottomMaterial = glassMaterial.clone();
        bottomMaterial.opacity = 0.34;
        const bottom = new THREE.Mesh(bottomGeometry, bottomMaterial);
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.y = -metrics.height / 2;
        glassGroup.add(bottom);
        resources.push(bottomGeometry, bottomMaterial);
        for (const [radius, y] of [
          [metrics.topRadius, metrics.height / 2],
          [metrics.bottomRadius, -metrics.height / 2],
        ] as const) {
          const ringGeometry = new THREE.TorusGeometry(radius, 0.55, 10, 128);
          const ringMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xeafaff,
            transparent: true,
            opacity: 0.58,
            roughness: 0.06,
            transmission: 0.55,
          });
          const ring = new THREE.Mesh(ringGeometry, ringMaterial);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = y;
          glassGroup.add(ring);
          resources.push(ringGeometry, ringMaterial);
        }

        const source = activeTexture
          ? await unwrapTexture(activeTexture, cup)
          : document.createElement("canvas");
        if (!activeTexture) {
          source.width = 1024;
          source.height = Math.max(
            256,
            Math.round(
              (1024 * metrics.printHeight) /
                Math.max(
                  1,
                  Math.PI *
                    (metrics.printTopRadius + metrics.printBottomRadius),
                ),
            ),
          );
        }
        const sourceContext = source.getContext("2d")!;
        if (!activeTexture) {
          sourceContext.fillStyle = "rgba(105, 80, 220, .76)";
          sourceContext.fillRect(0, 0, source.width, source.height);
          sourceContext.fillStyle = "rgba(255,255,255,.86)";
          sourceContext.font = `700 ${Math.round(source.height / 5)}px sans-serif`;
          sourceContext.textAlign = "center";
          sourceContext.textBaseline = "middle";
          sourceContext.fillText(
            "杯身图案",
            source.width / 2,
            source.height / 2,
          );
        }
        if (disposed) {
          cleanup();
          return;
        }
        const baseTexture = new THREE.CanvasTexture(source);
        baseTexture.colorSpace = THREE.SRGBColorSpace;
        baseTexture.wrapS = THREE.ClampToEdgeWrapping;
        baseTexture.needsUpdate = true;
        resources.push(baseTexture);
        const printRadiusOffset = 0.35;
        const morphGeometries: Array<{
          geometry: InstanceType<typeof THREE.BufferGeometry>;
          wrapped: Float32Array;
          vertexU: Float32Array;
          radius: Float32Array;
          flatDistance: Float32Array;
          flatAlongDelta: Float32Array;
        }> = [];
        const createMorphGeometry = (radiusOffset: number) => {
          const uSegments = 128;
          const vSegments = 10;
          const wrapped = new Float32Array(
            (uSegments + 1) * (vSegments + 1) * 3,
          );
          const vertexCount = (uSegments + 1) * (vSegments + 1);
          const vertexU = new Float32Array(vertexCount);
          const radii = new Float32Array(vertexCount);
          const flatDistance = new Float32Array(vertexCount);
          const flatAlongDelta = new Float32Array(vertexCount);
          const flatHingeTop = warpPoint(flatGeometry, 0, 0, 1);
          const flatHingeBottom = warpPoint(flatGeometry, 0, 1, 1);
          const flatHingeDx = flatHingeBottom.x - flatHingeTop.x;
          const flatHingeDy = flatHingeBottom.y - flatHingeTop.y;
          const flatHingeLength = Math.hypot(flatHingeDx, flatHingeDy);
          const uvs = new Float32Array((uSegments + 1) * (vSegments + 1) * 2);
          const indices: number[] = [];
          let cursor = 0;
          let uvCursor = 0;
          let vertexIndex = 0;
          for (let vIndex = 0; vIndex <= vSegments; vIndex++) {
            const v = vIndex / vSegments;
            const radius =
              metrics.printTopRadius +
              (metrics.printBottomRadius - metrics.printTopRadius) * v +
              radiusOffset;
            for (let uIndex = 0; uIndex <= uSegments; uIndex++) {
              const u = uIndex / uSegments;
              const theta =
                -metrics.visibleAngle / 2 + u * metrics.visibleAngle;
              wrapped[cursor] = radius * Math.sin(theta);
              wrapped[cursor + 1] =
                metrics.printCenterY + metrics.printHeight * (0.5 - v);
              wrapped[cursor + 2] = radius * Math.cos(theta);
              const point = warpPoint(flatGeometry, u, v, 1);
              const pointDx = point.x - flatHingeTop.x;
              const pointDy = point.y - flatHingeTop.y;
              vertexU[vertexIndex] = u;
              radii[vertexIndex] = radius;
              flatDistance[vertexIndex] =
                (pointDx * flatHingeDy - pointDy * flatHingeDx) /
                flatHingeLength;
              flatAlongDelta[vertexIndex] =
                (pointDx * flatHingeDx + pointDy * flatHingeDy) /
                  flatHingeLength -
                v * flatHingeLength;
              cursor += 3;
              uvs[uvCursor] = u;
              uvs[uvCursor + 1] = 1 - v;
              uvCursor += 2;
              vertexIndex++;
            }
          }
          for (let v = 0; v < vSegments; v++) {
            for (let u = 0; u < uSegments; u++) {
              const a = v * (uSegments + 1) + u;
              const b = a + uSegments + 1;
              indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
          }
          const result = new THREE.BufferGeometry();
          result.setIndex(indices);
          result.setAttribute(
            "position",
            new THREE.BufferAttribute(wrapped.slice(), 3),
          );
          result.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
          result.computeVertexNormals();
          morphGeometries.push({
            geometry: result,
            wrapped,
            vertexU,
            radius: radii,
            flatDistance,
            flatAlongDelta,
          });
          return result;
        };
        const filmGeometry = createMorphGeometry(0.2);
        const filmMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.58,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        const film = new THREE.Mesh(filmGeometry, filmMaterial);
        film.visible = !backgroundRemoved;
        film.position.y = metrics.printCenterY;
        group.add(film);
        resources.push(filmGeometry, filmMaterial);
        const makePrint = (
          angle: number,
          start: number,
          map: Texture,
          radiusOffset: number,
        ) => {
          const geometry =
            Math.abs(angle - metrics.visibleAngle) < 0.0001 &&
            Math.abs(start + metrics.visibleAngle / 2) < 0.0001
              ? createMorphGeometry(radiusOffset)
              : new THREE.CylinderGeometry(
                  metrics.printTopRadius + radiusOffset,
                  metrics.printBottomRadius + radiusOffset,
                  metrics.printHeight,
                  128,
                  1,
                  true,
                  start,
                  Math.max(0.0001, angle),
                );
          const material = new THREE.MeshStandardMaterial({
            map,
            transparent: true,
            alphaTest: backgroundRemoved ? 0.01 : 0,
            depthWrite: false,
            roughness: 0.52,
            metalness: 0,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 2;
          mesh.position.y = metrics.printCenterY;
          group.add(mesh);
          resources.push(geometry, material, map);
        };
        const mainTexture = baseTexture.clone();
        if (metrics.effectiveAngle > Math.PI * 2)
          mainTexture.repeat.x = (Math.PI * 2) / metrics.effectiveAngle;
        makePrint(
          metrics.visibleAngle,
          -metrics.visibleAngle / 2,
          mainTexture,
          printRadiusOffset,
        );
        if (metrics.overlapAngle > 0.0001) {
          const overlapTexture = baseTexture.clone();
          overlapTexture.offset.x =
            1 - metrics.overlapAngle / metrics.effectiveAngle;
          overlapTexture.repeat.x =
            metrics.overlapAngle / metrics.effectiveAngle;
          makePrint(
            metrics.overlapAngle,
            Math.PI - metrics.overlapAngle,
            overlapTexture,
            printRadiusOffset + 0.28,
          );
        }
        const markerGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(
            0,
            -metrics.height / 2 - 3,
            -metrics.bottomRadius - 1.2,
          ),
          new THREE.Vector3(
            0,
            metrics.height / 2 + 3,
            -metrics.topRadius - 1.2,
          ),
        ]);
        const markerMaterial = new THREE.LineDashedMaterial({
          color: 0xef4444,
          dashSize: 3,
          gapSize: 2,
        });
        const marker = new THREE.Line(markerGeometry, markerMaterial);
        marker.computeLineDistances();
        group.add(marker);
        resources.push(markerGeometry, markerMaterial);

        let morphProgress = expanded ? 1 : 0;
        let morphTarget = morphProgress;
        setExpandedRef.current = (next) => {
          morphTarget = next ? 1 : 0;
        };
        const updateMorph = () => {
          if (Math.abs(morphTarget - morphProgress) < 0.001) {
            morphProgress = morphTarget;
          } else {
            morphProgress += (morphTarget - morphProgress) * 0.065;
          }
          const eased = morphProgress * morphProgress * (3 - 2 * morphProgress);
          const remainingCurve = 1 - eased;
          const hingeTheta = -metrics.visibleAngle / 2;
          const hingeRadiusDelta =
            metrics.printBottomRadius - metrics.printTopRadius;
          const hingeLength = Math.hypot(metrics.printHeight, hingeRadiusDelta);
          const hingeUnitX =
            (hingeRadiusDelta * Math.sin(hingeTheta)) / hingeLength;
          const hingeUnitY = -metrics.printHeight / hingeLength;
          const hingeUnitZ =
            (hingeRadiusDelta * Math.cos(hingeTheta)) / hingeLength;
          for (const item of morphGeometries) {
            const position = item.geometry.getAttribute(
              "position",
            ) as InstanceType<typeof THREE.BufferAttribute>;
            const values = position.array as Float32Array;
            for (let vertex = 0; vertex < item.vertexU.length; vertex++) {
              const index = vertex * 3;
              const u = item.vertexU[vertex];
              const radius = item.radius[vertex];
              const arc = u * metrics.visibleAngle;
              const developedDistance = item.flatDistance[vertex];
              const alongDelta = item.flatAlongDelta[vertex] * eased;
              const hingeX = radius * Math.sin(hingeTheta);
              const hingeZ = radius * Math.cos(hingeTheta);
              if (remainingCurve < 0.0001 || arc < 0.000001) {
                values[index] =
                  hingeX +
                  developedDistance * Math.cos(hingeTheta) +
                  alongDelta * hingeUnitX;
                values[index + 2] =
                  hingeZ -
                  developedDistance * Math.sin(hingeTheta) +
                  alongDelta * hingeUnitZ;
              } else {
                const curvedArc = remainingCurve * arc;
                const distanceScale =
                  1 -
                  eased +
                  (eased * developedDistance) /
                    Math.max(0.000001, radius * arc);
                values[index] =
                  hingeX +
                  (radius / remainingCurve) *
                    (Math.sin(hingeTheta + curvedArc) - Math.sin(hingeTheta)) *
                    distanceScale +
                  alongDelta * hingeUnitX;
                values[index + 2] =
                  hingeZ +
                  (radius / remainingCurve) *
                    (Math.cos(hingeTheta + curvedArc) - Math.cos(hingeTheta)) *
                    distanceScale +
                  alongDelta * hingeUnitZ;
              }
              values[index + 1] =
                item.wrapped[index + 1] + alongDelta * hingeUnitY;
            }
            position.needsUpdate = true;
            item.geometry.computeVertexNormals();
          }
          marker.visible = morphProgress < 0.98;
        };

        const resize = () => {
          if (!canvas.clientWidth || !canvas.clientHeight) return;
          renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
          camera.aspect = canvas.clientWidth / canvas.clientHeight;
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
        const animate = () => {
          frame = requestAnimationFrame(animate);
          updateMorph();
          controls.update();
          renderer.render(scene, camera);
        };
        animate();
        setInitializing(false);
        setStatus(
          metrics.overlapAngle > 0
            ? `搭接 ${cup.seam.toFixed(1)} mm`
            : metrics.gapAngle > 0
              ? `接缝为负值：按设置保留约 ${(metrics.gapAngle * ((metrics.printTopRadius + metrics.printBottomRadius) / 2)).toFixed(1)} mm 裸露玻璃（设为 0 可闭合）`
              : "首尾无缝连接",
        );
      })
      .catch((error) => {
        if (disposed) return;
        const reason = error instanceof Error ? error.message : String(error);
        setInitializing(false);
        setInitializationError(
          `3D 初始化失败：${reason || "浏览器暂时无法创建 3D 场景"}`,
        );
        setStatus("");
      });
    return () => {
      disposed = true;
      cleanup();
      setViewRef.current = () => {};
      setGlassVisibleRef.current = () => {};
      setExpandedRef.current = () => {};
    };
  }, [open, cup, activeTexture, backgroundRemoved, initializationAttempt]);

  async function removeBackground() {
    if (!activeTexture || removingBackground) return;
    setRemovingBackground(true);
    try {
      const matte = await detectBorderMatte(activeTexture);
      setActiveTexture(
        await restoreTransparentBackground(activeTexture, matte),
      );
      setBackgroundRemoved(true);
      setTextureRevision((revision) => revision + 1);
    } catch (error) {
      setStatus(
        `HSV 去背失败：${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setRemovingBackground(false);
    }
  }

  return (
    <Modal
      open={open}
      width="min(1040px, 94vw)"
      title="杯身接缝 3D 模拟"
      footer={null}
      destroyOnHidden
      onCancel={onClose}
    >
      <div className="cup-seam-toolbar">
        <Space wrap>
          <Button
            type="primary"
            icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              setExpandedRef.current(next);
            }}
          >
            {expanded ? "收起贴图" : "展开贴图"}
          </Button>
          <Checkbox
            checked={showGlass}
            onChange={(event) => setShowGlass(event.target.checked)}
          >
            显示玻璃杯
          </Checkbox>
          <Button onClick={() => setViewRef.current("front")}>正面</Button>
          <Button onClick={() => setViewRef.current("seam")}>接缝面</Button>
          <Button
            disabled={!activeTexture}
            loading={removingBackground}
            onClick={() => void removeBackground()}
          >
            去除背景
          </Button>
          <Button onClick={() => setViewRef.current("seam")}>重置视角</Button>
          <span>{status}</span>
        </Space>
      </div>
      <div className="cup-seam-stage">
        <canvas
          key={`${activeTexture ? "artwork" : "placeholder"}-${textureRevision}`}
          ref={canvasRef}
          className="cup-seam-canvas"
          aria-label="杯身接缝 3D 预览"
          onDoubleClick={() => setViewRef.current("seam")}
        />
        {initializing ? (
          <div className="cup-seam-state" role="status">
            <Spin size="large" />
            <span>正在加载 3D 模型…</span>
          </div>
        ) : null}
        {initializationError ? (
          <div className="cup-seam-state cup-seam-error" role="alert">
            <Alert
              type="error"
              showIcon
              message="3D 预览未能显示"
              description={initializationError}
              action={
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={() =>
                    setInitializationAttempt((attempt) => attempt + 1)
                  }
                >
                  重试
                </Button>
              }
            />
          </div>
        ) : null}
      </div>
      <p className="cup-seam-note">
        {
          "拖动旋转 · 滚轮缩放 · 红色虚线为接缝中心。负接缝会故意留缝，0 mm 首尾闭合，正接缝产生搭接。透明图案按白色花纸基材模拟剪下后的整张贴膜。该模拟用于视觉检查，不代表玻璃壁厚制造尺寸。"
        }
      </p>
    </Modal>
  );
}
