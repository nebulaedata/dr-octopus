/**
 * @author Codex
 * @description Deterministic PDF image fixture without file downloads or external PDF authoring dependencies.
 */
import { createCanvas } from '@napi-rs/canvas';

/**
 * Write a minimal valid one-page scanned PDF with a visible English recognition sample.
 */
export function scannedPdf() {
  const canvas = createCanvas(720, 180);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 720, 180);
  context.fillStyle = 'black';
  context.font = '36px sans-serif';
  context.fillText('OCTOPUS KNOWLEDGE 2026', 32, 92);
  const jpeg = canvas.toBuffer('image/jpeg');
  const content = Buffer.from('q 720 0 0 180 0 0 cm /Scan Do Q');
  const values = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 180] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>'
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 720 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
      ),
      jpeg,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let size = chunks[0].length;
  for (let index = 0; index < values.length; index++) {
    offsets.push(size);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      values[index],
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    size += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
        .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`
    )
  );
  return Buffer.concat(chunks);
}
