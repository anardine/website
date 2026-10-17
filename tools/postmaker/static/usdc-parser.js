import { USDCParser as BaseUSDCParser } from 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/loaders/usd/USDCParser.js?original';

export class USDCParser extends BaseUSDCParser {
  _readInlinedValue(valueRep) {
    // Three.js 0.186.1 omits Vec2d/Vec3d/Vec4d's signed-byte inline decoding.
    const length = { 19: 2, 23: 3, 27: 4 }[valueRep.typeEnum];
    if (!length) return super._readInlinedValue(valueRep);
    const payload = valueRep.getInlinedValue();
    return Array.from({ length }, (_, index) => (payload >>> (index * 8) << 24) >> 24);
  }
}
