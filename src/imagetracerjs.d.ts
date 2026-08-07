declare module 'imagetracerjs' {
  interface ImageTracer {
    imagedataToSVG(imageData: ImageData, options?: Record<string, unknown> | string): string;
  }
  const tracer: ImageTracer;
  export default tracer;
}
