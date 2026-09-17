import type { CupParams } from "./geometry";

export interface SeamPreviewGeometry {
  topRadius: number;
  bottomRadius: number;
  height: number;
  printHeight: number;
  printCenterY: number;
  printTopRadius: number;
  printBottomRadius: number;
  baseAngle: number;
  effectiveAngle: number;
  visibleAngle: number;
  overlapAngle: number;
  gapAngle: number;
}

export function seamPreviewGeometry(cup: CupParams): SeamPreviewGeometry {
  const topRadius = cup.top / 2;
  const bottomRadius = cup.bottom / 2;
  // The artwork already contains the configured top/bottom whitespace. The
  // physical sheet in the 3D mockup therefore reaches both cup rims; applying
  // the insets again here would create duplicated blank bands.
  const printHeight = cup.height;
  const printTopRadius = topRadius;
  const printBottomRadius = bottomRadius;
  const averagePrintRadius = (printTopRadius + printBottomRadius) / 2;
  const baseAngle = (cup.coverage * Math.PI) / 180;
  const effectiveAngle = Math.max(
    0.001,
    baseAngle + cup.seam / Math.max(0.001, averagePrintRadius),
  );
  return {
    topRadius,
    bottomRadius,
    height: cup.height,
    printHeight,
    printCenterY: 0,
    printTopRadius,
    printBottomRadius,
    baseAngle,
    effectiveAngle,
    visibleAngle: Math.min(Math.PI * 2, effectiveAngle),
    overlapAngle: Math.max(0, effectiveAngle - Math.PI * 2),
    gapAngle: Math.max(0, Math.PI * 2 - effectiveAngle),
  };
}
