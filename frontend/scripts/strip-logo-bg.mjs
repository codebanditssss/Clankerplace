// Strip dark background from logo.png → transparent
// Approach: read RGBA, set alpha=0 for any pixel where R+G+B is below threshold
import sharp from 'sharp';

const SRC = 'public/logo.png';
const THRESHOLD = 60; // any pixel where max(R,G,B) < 60 becomes transparent

const img = sharp(SRC).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
console.log(`Loaded ${info.width}x${info.height}, channels=${info.channels}`);

let changed = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const maxRGB = Math.max(r, g, b);
  if (maxRGB < THRESHOLD) {
    data[i + 3] = 0; // fully transparent
    changed++;
  } else if (maxRGB < THRESHOLD + 40) {
    // Soft edge — partial transparency for anti-aliasing
    data[i + 3] = Math.round(((maxRGB - THRESHOLD) / 40) * 255);
  }
}
console.log(`Made ${changed} pixels transparent (${((changed / (info.width * info.height)) * 100).toFixed(1)}%)`);

await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile('public/logo.png');

console.log('Wrote public/logo.png with transparent bg');
