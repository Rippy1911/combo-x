export interface OrtTensorLike {
  data: Float32Array;
  dims: readonly number[];
}

export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
}

export type OrtSessionFactory = (modelUrl: string) => Promise<OrtSessionLike>;
export type MakeTensor = (data: Float32Array, dims: readonly number[]) => OrtTensorLike;
