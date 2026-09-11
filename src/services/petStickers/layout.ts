import {
  HEIGHT,
  WIDTH,
  type Glyph,
  type Layout,
  type PetLibrary,
  type PetSettings,
  type Placement,
  type Rect,
  type Sprite,
} from "./types";
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function intersects(a: Rect, b: Rect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
export const characterFamily = (sprite: Sprite) =>
  sprite.characterId || sprite.id;
export function densityProfile(value = 70) {
  const density = Math.max(
    0,
    Math.min(100, Number.isFinite(value) ? value : 70),
  );
  return {
    target: Math.round(14 + density * 0.5),
    baseHeight: 880 - density * 3.5,
    gap: Math.round(70 - density * 0.55),
    attempts: 3200,
  };
}
export function nearby(a: Rect, b: Rect) {
  const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return (
    Math.hypot(dx, dy) <
    Math.max(320, Math.min(a.width, a.height, b.width, b.height) * 0.8)
  );
}
// Candidates are scored deterministically: avoid neighbours first, distribute
// repeated identities second, use the seeded RNG only for equivalent choices.
export function chooseDistributed(
  list: Sprite[],
  rect: (a: Sprite) => Rect,
  placed: Placement[],
  assets: Sprite[],
  random: () => number,
) {
  const families = new Map(assets.map((a) => [a.id, characterFamily(a)]));
  return list
    .map((a) => {
      const same = placed.filter(
        (p) => families.get(p.spriteId) === characterFamily(a),
      );
      const r = rect(a);
      return {
        a,
        score:
          same.filter((p) => nearby(r, p)).length * 10000 +
          same.length * 20 +
          random(),
      };
    })
    .sort((a, b) => a.score - b.score)[0].a;
}
export function constrain(p: Placement): Placement {
  const factor = Math.min(1, (WIDTH - 40) / p.width, (HEIGHT - 40) / p.height);
  const width = p.width * factor,
    height = p.height * factor;
  return {
    ...p,
    width,
    height,
    x: Math.max(20, Math.min(WIDTH - 20 - width, p.x)),
    y: Math.max(20, Math.min(HEIGHT - 20 - height, p.y)),
  };
}
export function outputDimensions(scale: number) {
  if (![1, 0.75, 0.5].includes(scale)) throw new Error("不支持的输出比例");
  return {
    width: Math.round(WIDTH * scale),
    height: Math.round(HEIGHT * scale),
  };
}
// Reviewed anchor preferences. The final contact is snapped to the actual Anton
// alpha contour, not to a letter's rectangular bounding box.
export const CONTACTS: Record<string, { top: number; side: number }> = {
  A: { top: 0.3, side: 0.47 },
  B: { top: 0.35, side: 0.3 },
  C: { top: 0.42, side: 0.29 },
  D: { top: 0.35, side: 0.4 },
  E: { top: 0.35, side: 0.48 },
  F: { top: 0.35, side: 0.3 },
  G: { top: 0.42, side: 0.4 },
  H: { top: 0.2, side: 0.42 },
  I: { top: 0.5, side: 0.45 },
  J: { top: 0.72, side: 0.4 },
  K: { top: 0.2, side: 0.3 },
  L: { top: 0.2, side: 0.75 },
  M: { top: 0.18, side: 0.46 },
  N: { top: 0.2, side: 0.4 },
  O: { top: 0.3, side: 0.4 },
  P: { top: 0.25, side: 0.3 },
  Q: { top: 0.3, side: 0.4 },
  R: { top: 0.3, side: 0.3 },
  S: { top: 0.42, side: 0.3 },
  T: { top: 0.35, side: 0.18 },
  U: { top: 0.2, side: 0.4 },
  V: { top: 0.2, side: 0.4 },
  W: { top: 0.15, side: 0.42 },
  X: { top: 0.18, side: 0.26 },
  Y: { top: 0.2, side: 0.25 },
  Z: { top: 0.3, side: 0.3 },
};
export interface Contour {
  top: (x: number) => number;
  right: (y: number) => number;
  overlaps?: (rect: Rect, margin: number) => boolean;
}
export function makeLayout(
  letter: string,
  library: PetLibrary,
  settings: PetSettings,
  glyph: Glyph,
  contour: Contour,
): Layout {
  if (!CONTACTS[letter]) throw new Error("只支持 A–Z 单个大写字母");
  const rnd = seeded(settings.seed + letter.charCodeAt(0) * 1009);
  const placements: Placement[] = [];
  const warnings: string[] = [];
  const available = library.assets.filter((a) => a.reviewed);
  const full = available.filter(
    (a) => a.kind === "character" && a.pose === "full",
  );
  if (!full.length) throw new Error("请先确认至少一个完整角色");
  const pick = (list: Sprite[]) => list[Math.floor(rnd() * list.length)];
  const density = densityProfile(settings.density);
  // Normalize the longest edge so wide poses are not disproportionately large.
  // All characters share this scale; never shrink individual gap-fillers.
  const characterHeight = (a: Sprite, variation = 1) =>
    (density.baseHeight * variation) / Math.max(1, a.width / a.height);
  const add = (
    a: Sprite,
    x: number,
    y: number,
    h: number,
    interaction = false,
  ) => {
    const p = constrain({
      id: `${letter}-${placements.length}`,
      spriteId: a.id,
      x,
      y,
      width: (h * a.width) / a.height,
      height: h,
      interaction,
    });
    placements.push(p);
    return p;
  };
  const tops = available.filter((a) => a.pose === "top" && a.contact),
    sides = available.filter((a) => a.pose === "side" && a.contact);
  if (tops.length) {
    const a = pick(tops),
      cx = glyph.x + glyph.width * CONTACTS[letter].top,
      cy = contour.top(cx);
    const h = characterHeight(a);
    // Omit a pose when it cannot fit at the shared size, rather than miniaturize it.
    if (cy - h * a.contact!.y >= 24)
      add(
        a,
        cx - ((h * a.width) / a.height) * a.contact!.x,
        cy - h * a.contact!.y,
        h,
        true,
      );
  }
  if (sides.length) {
    const unused = sides.filter(
      (a) =>
        !placements.some(
          (p) =>
            characterFamily(available.find((x) => x.id === p.spriteId)!) ===
            characterFamily(a),
        ),
    );
    const a = pick(unused.length ? unused : sides),
      y = glyph.y + glyph.height * CONTACTS[letter].side,
      x = contour.right(y);
    const h = characterHeight(a);
    add(
      a,
      x - ((h * a.width) / a.height) * a.contact!.x,
      y - h * a.contact!.y,
      h,
      true,
    );
  }
  if (!tops.length || !sides.length)
    warnings.push("缺少已采用的互动姿势，当前使用完整角色围绕文字排布。");
  // A seated/full character touches the baseline without crossing its safe face.
  const bottom = chooseDistributed(
    full,
    (a) => ({
      x: glyph.x + glyph.width * 0.12,
      y: glyph.y + glyph.height - characterHeight(a),
      width: (characterHeight(a) * a.width) / a.height,
      height: characterHeight(a),
    }),
    placements,
    available,
    rnd,
  );
  add(
    bottom,
    glyph.x + glyph.width * 0.12,
    glyph.y + glyph.height - characterHeight(bottom),
    characterHeight(bottom),
    true,
  );
  const occupied: Rect[] = [...placements];
  const touchesLetter = (r: Rect, margin: number) =>
    contour.overlaps
      ? contour.overlaps(r, margin)
      : intersects(glyph, r, margin);
  // Keep irregular positions with only +/- 4% size variation. Empty gaps belong
  // to decorations, not tiny versions of the characters.
  for (
    let attempt = 0;
    attempt < density.attempts && placements.length < density.target;
    attempt++
  ) {
    const variation = 0.96 + rnd() * 0.08;
    const centerX = 50 + rnd() * (WIDTH - 100),
      y = 35 + rnd() * (HEIGHT - density.baseHeight * variation - 70);
    const rect = (a: Sprite) => ({
      x: centerX - (characterHeight(a, variation) * a.width) / a.height / 2,
      y,
      width: (characterHeight(a, variation) * a.width) / a.height,
      height: characterHeight(a, variation),
    });
    const a = chooseDistributed(full, rect, placements, available, rnd),
      p = rect(a);
    if (
      p.x < 35 ||
      p.x + p.width > WIDTH - 35 ||
      touchesLetter(p, 45) ||
      occupied.some((o) => intersects(o, p, density.gap))
    )
      continue;
    occupied.push(add(a, p.x, p.y, p.height));
  }
  const decor = available.filter((a) => a.kind === "decoration");
  if (decor.length)
    for (let i = 0, added = 0; i < 2400 && added < 125; i++) {
      const h = 85 + rnd() * 75,
        x = 30 + rnd() * (WIDTH - 210),
        y = 30 + rnd() * (HEIGHT - 210);
      const rect = (a: Sprite) => ({
        x,
        y,
        width: (h * a.width) / a.height,
        height: h,
      });
      const a = chooseDistributed(decor, rect, placements, available, rnd),
        p = rect(a);
      if (
        p.x + p.width < WIDTH - 20 &&
        p.y + p.height < HEIGHT - 20 &&
        !touchesLetter(p, 32) &&
        !occupied.some((o) => intersects(o, p, 28))
      ) {
        occupied.push(add(a, p.x, p.y, h));
        added++;
      }
    }
  return { letter, seed: settings.seed, glyph, placements, warnings };
}
