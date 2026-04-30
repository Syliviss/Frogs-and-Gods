declare module "fastnoise-lite" {
  class FastNoiseLite {
    constructor(seed?: number);
    SetNoiseType(type: FastNoiseLite.NoiseType): void;
    SetFrequency(frequency: number): void;
    GetNoise(x: number, y: number): number;
  }

  namespace FastNoiseLite {
    enum NoiseType {
      OpenSimplex2 = 0,
      OpenSimplex2S = 1,
      Cellular = 2,
      Perlin = 3,
      ValueCubic = 4,
      Value = 5,
    }
  }

  export = FastNoiseLite;
}
