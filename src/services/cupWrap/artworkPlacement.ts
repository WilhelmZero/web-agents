import type { WrapGeometry } from "./geometry";
import type { ArtworkSlot } from "./types";
import { warpPoint } from "./warp";

export interface ArtworkPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** Places rigid artwork in print space. Only one uniform scale is used. */
export function artworkSlotPlacement(
  g: WrapGeometry,
  slot: ArtworkSlot,
  enabledCount: number,
  imageWidth: number,
  imageHeight: number,
  safe = 0,
  coverageDegrees = 360,
): ArtworkPlacement {
  const oppositeOffset = Math.min(0.48, 90 / Math.max(1, coverageDegrees));
  const u =
    enabledCount > 1
      ? slot.role === "front"
        ? 0.5 - oppositeOffset
        : 0.5 + oppositeOffset
      : 0.5;
  const top = warpPoint(g, u, 0.12, 1);
  const bottom = warpPoint(g, u, 0.88, 1);
  const center = warpPoint(g, u, 0.5, 1);
  const baseRotation = Math.atan2(bottom.y - top.y, bottom.x - top.x) - Math.PI / 2;
  const averageArc = (g.topArc + g.bottomArc) / 2;
  const availableWidth = averageArc * (enabledCount > 1 ? 0.34 : 0.68);
  const availableHeight = Math.max(1, g.slant - 2 * Math.max(0, safe));
  const aspect = imageWidth / Math.max(1, imageHeight);
  const baseWidth = Math.min(availableWidth, availableHeight * aspect);
  const width = Math.max(0.1, baseWidth * slot.scale);
  return {
    x: center.x + slot.x,
    y: center.y + slot.y,
    width,
    height: width / aspect,
    rotation: baseRotation + (slot.rotation * Math.PI) / 180,
  };
}
