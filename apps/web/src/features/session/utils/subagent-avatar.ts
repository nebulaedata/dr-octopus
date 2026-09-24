/**
 * @author Codex
 * @description Derives stable, mirrored pixel artwork from a subagent instance identity.
 */

const PALETTES = [
  ['#4338ca', '#e0e7ff'],
  ['#0369a1', '#e0f2fe'],
  ['#0f766e', '#ccfbf1'],
  ['#047857', '#d1fae5'],
  ['#a16207', '#fef3c7'],
  ['#c2410c', '#ffedd5'],
  ['#be185d', '#fce7f3'],
  ['#7e22ce', '#f3e8ff'],
] as const;

/**
 * Hashes a seed deterministically using 32-bit FNV-1a and a final avalanche.
 */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Returns a fixed palette and symmetric 5-by-5 artwork with a guaranteed center pixel.
 * Seed must identify an instance; labels and current list positions are not identities.
 */
export function createSubagentAvatar(seed: string) {
  const hash = hashSeed(seed);
  const [foreground, background] = PALETTES[hash % PALETTES.length]!;
  const pattern = hashSeed(`pixels:${seed}`) | (1 << 8);
  const pixels: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      const column = Math.min(x, 4 - x);
      if ((pattern & (1 << (y * 3 + column))) !== 0) {
        pixels.push({ x: x + 1, y: y + 1 });
      }
    }
  }
  return { foreground, background, pixels };
}
