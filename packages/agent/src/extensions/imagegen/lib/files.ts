/**
 * @author Codex
 * @description Validates image bytes and publishes generated files inside the active workspace.
 */
import { readFile, realpath, mkdir, writeFile, link, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { ImagegenResult } from '@octopus/shared/protocol';

/**
 * Resolves existing ancestors so symbolic links cannot escape the workspace.
 */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) {
      throw error;
    }
    return join(await canonical(dirname(path)), basename(path));
  }
}

/**
 * Restricts input and output to the real active workspace, including new directories.
 */
export async function resolveImagePath(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const target = await canonical(resolve(cwd, path));
  const suffix = relative(root, target);
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('../') || suffix.startsWith('..\\')) {
    throw new Error('Image paths must stay inside the active workspace.');
  }
  return target;
}

/**
 * Decodes the complete image and rejects unsupported or oversized pixel data.
 */
async function inspectImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) {
    throw new Error('Image file exceeds the supported size.');
  }
  const source = sharp(bytes, { limitInputPixels: 40_000_000 });
  const metadata = await source.metadata();
  if (
    !metadata.format ||
    !['png', 'jpeg', 'webp'].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new Error('Only static PNG, JPEG and WebP images are supported.');
  }
  await source.stats();
  return {
    mimeType: `image/${metadata.format}`,
    extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format,
    width: metadata.width,
    height: metadata.height,
  };
}

/**
 * Loads bounded references after checking their real paths and decoded formats.
 */
export async function readImageReferences(
  cwd: string,
  paths: string[],
  signal?: AbortSignal
): Promise<ImageContent[]> {
  if (paths.length > 4) {
    throw new Error('At most four reference images are supported.');
  }
  const output: ImageContent[] = [];
  let size = 0;
  for (const path of paths) {
    signal?.throwIfAborted();
    const target = await resolveImagePath(cwd, path);
    const info = await stat(target);
    if (!info.isFile() || size + info.size > 8 * 1024 * 1024) {
      throw new Error('Reference images must total at most 8 MiB.');
    }
    const bytes = await readFile(target, { signal });
    size += bytes.length;
    if (size > 8 * 1024 * 1024) {
      throw new Error('Reference images must total at most 8 MiB.');
    }
    const metadata = await inspectImage(bytes);
    output.push({ type: 'image', data: bytes.toString('base64'), mimeType: metadata.mimeType });
  }
  return output;
}

/**
 * Validates all outputs before atomic no-overwrite publication; rolls back on failure or cancellation.
 */
export async function publishImages(
  cwd: string,
  directory: string,
  images: ImageContent[],
  signal?: AbortSignal
): Promise<ImagegenResult['images']> {
  if (!images.length || images.length > 8) {
    throw new Error('The provider did not return a supported number of images.');
  }
  const decoded = [];
  for (const image of images) {
    signal?.throwIfAborted();
    if (image.data.length > 45 * 1024 * 1024) {
      throw new Error('Generated image exceeds 32 MiB.');
    }
    const bytes = Buffer.from(image.data, 'base64');
    decoded.push({ bytes, metadata: await inspectImage(bytes) });
  }
  const target = await resolveImagePath(cwd, directory);
  await mkdir(target, { recursive: true });
  await resolveImagePath(cwd, target);
  const published: string[] = [];
  const result: ImagegenResult['images'] = [];
  try {
    for (const { bytes, metadata } of decoded) {
      signal?.throwIfAborted();
      const path = join(target, `${randomUUID()}.${metadata.extension}`);
      const temporary = `${path}.tmp`;
      try {
        await writeFile(temporary, bytes, { flag: 'wx', signal });
        signal?.throwIfAborted();
        await link(temporary, path);
        published.push(path);
      } finally {
        await rm(temporary, { force: true });
      }
      result.push({
        path,
        relativePath: relative(await realpath(cwd), path).replaceAll('\\', '/'),
        mimeType: metadata.mimeType,
        width: metadata.width,
        height: metadata.height,
      });
    }
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    await Promise.all(published.map((path) => rm(path, { force: true })));
    throw error;
  }
}
