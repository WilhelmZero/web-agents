import type { WrapGeometry, Point } from "./geometry";

export interface WarpRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Uniformly contains the source in the cup's physical parameter space.
 * The narrow arc controls the horizontal safety margin, so neither rim can
 * clip content. A small production inset protects anti-aliased edge pixels.
 */
export function safeWarpRegion(
  g: WrapGeometry,
  sourceWidth: number,
  sourceHeight: number,
  safeMm: number,
  productionInset = 0.94,
): WarpRegion {
  const narrowArc = Math.max(0.001, Math.min(g.topArc, g.bottomArc));
  const averageArc = Math.max(0.001, (g.topArc + g.bottomArc) / 2);
  const slant = Math.max(0.001, g.slant);
  const maxUSpan = Math.max(0.01, 1 - (2 * safeMm) / narrowArc);
  const maxVSpan = Math.max(0.01, 1 - (2 * safeMm) / slant);
  const scale =
    Math.min(
      (maxUSpan * averageArc) / Math.max(1, sourceWidth),
      (maxVSpan * slant) / Math.max(1, sourceHeight),
    ) * productionInset;
  const uSpan = Math.min(maxUSpan, (sourceWidth * scale) / averageArc);
  const vSpan = Math.min(maxVSpan, (sourceHeight * scale) / slant);
  return {
    u0: (1 - uSpan) / 2,
    u1: (1 + uSpan) / 2,
    v0: (1 - vSpan) / 2,
    v1: (1 + vSpan) / 2,
  };
}

// Interpolate the actual top/bottom arcs, including reversed taper and cylinders.
export function warpPoint(
  g: WrapGeometry,
  u: number,
  v: number,
  amount: number,
): Point {
  const half = g.points.length / 2;
  const sample = (bottom: boolean) => {
    const t = u * (half - 1),
      i = Math.min(half - 2, Math.floor(t)),
      f = t - i;
    const index = (n: number) => (bottom ? g.points.length - 1 - n : n);
    const a = g.points[index(i)],
      b = g.points[index(i + 1)];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const a = sample(false),
    b = sample(true);
  return {
    x: u * g.width * (1 - amount) + (a.x + (b.x - a.x) * v) * amount,
    y: v * g.height * (1 - amount) + (a.y + (b.y - a.y) * v) * amount,
  };
}

export function drawWarp(
  ctx: OffscreenCanvasRenderingContext2D,
  img: ImageBitmap,
  g: WrapGeometry,
  amount: number,
  region: WarpRegion = { u0: 0, v0: 0, u1: 1, v1: 1 },
) {
  const nx = 48,
    ny = 24;
  const triangle = (uv: Point[]) => {
    const src = uv.map((p) => ({ x: p.x * img.width, y: p.y * img.height }));
    const dst = uv.map((p) =>
      warpPoint(
        g,
        region.u0 + p.x * (region.u1 - region.u0),
        region.v0 + p.y * (region.v1 - region.v0),
        amount,
      ),
    );
    const [s0, s1, s2] = src,
      [d0, d1, d2] = dst;
    // Canvas clips each triangle with anti-aliased edges. Slightly overlap only
    // the clip polygon so adjacent triangles cannot leave hairline seams; the
    // affine mapping itself stays exact and the final cup mask trims the rim.
    const cx = (d0.x + d1.x + d2.x) / 3,
      cy = (d0.y + d1.y + d2.y) / 3,
      overlap = 1.2,
      clipPoint = (p: Point) => {
        const dx = p.x - cx,
          dy = p.y - cy,
          length = Math.hypot(dx, dy) || 1;
        return {
          x: p.x + (dx / length) * overlap,
          y: p.y + (dy / length) * overlap,
        };
      },
      [c0, c1, c2] = [d0, d1, d2].map(clipPoint);
    const x1 = s1.x - s0.x,
      y1 = s1.y - s0.y,
      x2 = s2.x - s0.x,
      y2 = s2.y - s0.y,
      det = x1 * y2 - x2 * y1;
    const a = ((d1.x - d0.x) * y2 - (d2.x - d0.x) * y1) / det;
    const c = ((d2.x - d0.x) * x1 - (d1.x - d0.x) * x2) / det;
    const b = ((d1.y - d0.y) * y2 - (d2.y - d0.y) * y1) / det;
    const d = ((d2.y - d0.y) * x1 - (d1.y - d0.y) * x2) / det;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(
      a,
      b,
      c,
      d,
      d0.x - a * s0.x - c * s0.y,
      d0.y - b * s0.x - d * s0.y,
    );
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = { x: x / nx, y: y / ny },
        b = { x: (x + 1) / nx, y: y / ny },
        c = { x: x / nx, y: (y + 1) / ny },
        d = { x: (x + 1) / nx, y: (y + 1) / ny };
      triangle([a, b, c]);
      triangle([b, d, c]);
    }
}

/** Rasterize the complete mesh in one GPU draw call. Shared triangle edges are
 * covered by the same rasterizer, avoiding the hairline seams produced by
 * repeatedly clipping Canvas 2D triangles. */
export function drawWarpWebGL(
  ctx: OffscreenCanvasRenderingContext2D,
  img: ImageBitmap,
  g: WrapGeometry,
  amount: number,
  region: WarpRegion = { u0: 0, v0: 0, u1: 1, v1: 1 },
) {
  const target = ctx.canvas;
  const layer = new OffscreenCanvas(target.width, target.height);
  const gl = layer.getContext("webgl2", {
    alpha: true,
    // Per-triangle MSAA blends every shared edge against transparency and
    // exposes the mesh as a faint lattice. Texture filtering still smooths the
    // artwork; disabling geometric MSAA keeps shared edges fully covered.
    antialias: false,
    premultipliedAlpha: true,
  });
  if (!gl) return false;
  const vertexSource = `#version 300 es
    in vec2 a_position;
    in vec2 a_texCoord;
    out vec2 v_texCoord;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texCoord = a_texCoord; }`;
  const fragmentSource = `#version 300 es
    precision mediump float;
    uniform sampler2D u_image;
    in vec2 v_texCoord;
    out vec4 outColor;
    void main() { outColor = texture(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y)); }`;
  const shader = (kind: number, source: string) => {
    const value = gl.createShader(kind)!;
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(value) || "扇形着色器编译失败");
    return value;
  };
  const program = gl.createProgram()!;
  const vs = shader(gl.VERTEX_SHADER, vertexSource),
    fs = shader(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) || "扇形着色器链接失败");
  const transform = ctx.getTransform(),
    vertices: number[] = [],
    nx = 64,
    ny = 32;
  const add = (u: number, v: number) => {
    const p = warpPoint(
      g,
      region.u0 + u * (region.u1 - region.u0),
      region.v0 + v * (region.v1 - region.v0),
      amount,
    );
    const x = transform.a * p.x + transform.c * p.y + transform.e,
      y = transform.b * p.x + transform.d * p.y + transform.f;
    vertices.push((2 * x) / target.width - 1, 1 - (2 * y) / target.height, u, v);
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const u0 = x / nx,
        u1 = (x + 1) / nx,
        v0 = y / ny,
        v1 = (y + 1) / ny;
      add(u0, v0);
      add(u1, v0);
      add(u0, v1);
      add(u1, v0);
      add(u1, v1);
      add(u0, v1);
    }
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.useProgram(program);
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  const position = gl.getAttribLocation(program, "a_position"),
    textureCoordinate = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(textureCoordinate);
  gl.vertexAttribPointer(
    textureCoordinate,
    2,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT,
  );
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    img,
  );
  gl.viewport(0, 0, layer.width, layer.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  gl.deleteTexture(texture);
  gl.deleteBuffer(buffer);
  gl.deleteProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return true;
}
