export interface TextBlock {
  bold?: boolean;
  autoSize?: boolean;
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  strokeWidth: number;
  strokeColor: string;
}
export interface BrushStroke {
  mode?: "paint" | "erase";
  color: "#000000" | "#ffffff";
  size: number;
  points: { x: number; y: number }[];
}
export interface EngravingLayout {
  strokes?: BrushStroke[];
  version: 1;
  width: number;
  height: number;
  image: { x: number; y: number; width: number; height: number };
  texts: TextBlock[];
}
export function validateLayout(value: EngravingLayout): EngravingLayout {
  const finite = (n: number) => typeof n === "number" && Number.isFinite(n);
  if (
    value.version !== 1 ||
    ![value.width, value.height].every(
      (n) => finite(n) && n >= 1 && n <= 8192,
    ) ||
    value.width * value.height > 24000000
  )
    throw new Error("画布单边最多8192像素，总计2400万像素。");
  if (
    !value.image ||
    ![
      value.image.x,
      value.image.y,
      value.image.width,
      value.image.height,
    ].every(finite) ||
    value.image.width <= 0 ||
    value.image.height <= 0 ||
    Math.max(value.image.width, value.image.height) > 32768
  )
    throw new Error("图片位置或尺寸无效。");
  if (!Array.isArray(value.texts) || value.texts.length > 100)
    throw new Error("最多100个文字块。");
  const ids = new Set<string>();
  for (const t of value.texts) {
    if (
      (t.bold !== undefined && typeof t.bold !== "boolean") ||
      (t.autoSize !== undefined && typeof t.autoSize !== "boolean") ||
      !t.id ||
      ids.has(t.id) ||
      typeof t.text !== "string" ||
      t.text.length > 5000 ||
      typeof t.font !== "string" ||
      ![
        t.x,
        t.y,
        t.width,
        t.height,
        t.fontSize,
        t.lineHeight,
        t.letterSpacing,
        t.strokeWidth,
      ].every(finite) ||
      t.width <= 0 ||
      t.height <= 0 ||
      t.width > 32768 ||
      t.height > 32768 ||
      t.fontSize < 1 ||
      t.fontSize > 4096 ||
      t.strokeWidth < 0 ||
      t.strokeWidth > 500 ||
      t.lineHeight < 0.5 ||
      t.lineHeight > 5 ||
      Math.abs(t.letterSpacing) > 200 ||
      !["left", "center", "right"].includes(t.align) ||
      !/^#[a-f0-9]{6}$/i.test(t.color) ||
      !/^#[a-f0-9]{6}$/i.test(t.strokeColor)
    )
      throw new Error("文字参数无效。");
    ids.add(t.id);
  }
  if (value.strokes !== undefined) {
    if (!Array.isArray(value.strokes) || value.strokes.length > 2000)
      throw new Error("最多保存2000笔，请撤销部分笔迹。");
    let points = 0;
    for (const stroke of value.strokes) {
      if (
        !stroke ||
        (stroke.mode !== undefined &&
          !["paint", "erase"].includes(stroke.mode)) ||
        !["#000000", "#ffffff"].includes(stroke.color) ||
        !finite(stroke.size) ||
        stroke.size < 1 ||
        stroke.size > 1000 ||
        !Array.isArray(stroke.points) ||
        !stroke.points.length ||
        stroke.points.some(
          (p) =>
            !p ||
            !finite(p.x) ||
            !finite(p.y) ||
            Math.abs(p.x) > 32768 ||
            Math.abs(p.y) > 32768,
        )
      )
        throw new Error("画笔数据无效。");
      points += stroke.points.length;
    }
    if (points > 100000) throw new Error("笔迹过多，请撤销部分笔迹。");
  }
  return value;
}
