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
  const printHeight = cup.height - cup.topInset - cup.bottomInset;
  const radiusAt = (distanceFromTop: number) =>
    topRadius + ((bottomRadius - topRadius) * distanceFromTop) / cup.height;
  const printTopRadius = radiusAt(cup.topInset);
  const printBottomRadius = radiusAt(cup.height - cup.bottomInset);
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
    printCenterY: (cup.bottomInset - cup.topInset) / 2,
    printTopRadius,
    printBottomRadius,
    baseAngle,
    effectiveAngle,
    visibleAngle: Math.min(Math.PI * 2, effectiveAngle),
    overlapAngle: Math.max(0, effectiveAngle - Math.PI * 2),
    gapAngle: Math.max(0, Math.PI * 2 - effectiveAngle),
  };
}
