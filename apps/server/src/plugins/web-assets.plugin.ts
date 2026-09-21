/**
 * @author Codex
 * @description Serves Vite production assets and the SPA entry through @fastify/vite.
 * GET /
 * HEAD /
 * GET /index.html
 * HEAD /index.html
 * GET /*
 * HEAD /*
 */

import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import fastifyVite from '@fastify/vite';
import type { FastifyViteOptions, RuntimeConfig } from '@fastify/vite';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Requires an explicit, nonzero HTML preference instead of treating API clients' wildcards as navigation.
 */
function acceptsHtml(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((range) => {
    const [mediaType, ...parameters] = range.trim().toLowerCase().split(';');
    if (mediaType?.trim() !== 'text/html') {
      return false;
    }
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    const value = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return value > 0 && value <= 1;
  });
}

/**
 * Limits fallback to extensionless page paths, excluding reserved namespaces and resource requests.
 * Decodes paths before checking boundaries so encoded names cannot bypass the exclusions.
 */
function isPageNavigation(request: FastifyRequest): boolean {
  if (!acceptsHtml(request.headers.accept) || request.headers.upgrade) {
    return false;
  }
  const destination = request.headers['sec-fetch-dest'];
  if (destination !== undefined && !['document', 'iframe', 'frame'].includes(String(destination))) {
    return false;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(request.url.split('?')[0]!);
  } catch {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean);
  return (
    !['api', 'ws', 'assets'].includes(segments[0] ?? '') &&
    !pathname.includes('\\') &&
    !segments.some((segment) => segment.includes('.'))
  );
}

/**
 * Loads the Vite production bundle and registers GET/HEAD entry and fallback routes.
 * Rejected requests use the existing not-found handler; other HTTP methods never enter the fallback.
 * @param root Absolute client output directory, beside the generated vite.config.json in its parent.
 */
export async function registerWebAssets(server: FastifyInstance, root: string): Promise<void> {
  if (!isAbsolute(root)) {
    throw new Error('SERVER_WEB_ROOT must be an absolute path.');
  }
  await access(join(root, 'index.html'));
  // The runtime exposes prepareServer; the package's registration options omit its type.
  const options: FastifyViteOptions & Pick<RuntimeConfig, 'prepareServer'> = {
    root,
    distDir: root,
    dev: false,
    spa: true,
    /**
     * Accepts Vite's Windows-generated relative paths on Unix without rewriting the cached build file.
     */
    prepareServer(_scope, config) {
      const vite = config.viteConfig;
      vite.build.outDir = vite.build.outDir.replaceAll('\\', '/');
      for (const [environment, path] of Object.entries(vite.fastify?.outDirs ?? {})) {
        vite.fastify!.outDirs![environment] = path.replaceAll('\\', '/');
      }
    },
    // The entry is rendered by reply.html(); exclude its static route to avoid duplicate registration.
    fastifyStaticOptions: { dotfiles: 'deny', globIgnore: ['index.html'] },
  };
  await server.register(fastifyVite, options);
  await server.vite.ready();
  for (const url of ['/', '/index.html']) {
    server.route({
      method: 'GET',
      exposeHeadRoute: true,
      url,
      /**
       * Serves explicit entry URLs independently of content negotiation for fallback routes.
       */
      handler(_request, reply) {
        return reply.html();
      },
    });
  }
  server.route({
    method: 'GET',
    exposeHeadRoute: true,
    url: '/*',
    /**
     * Preserves normal not-found handling unless the request qualifies as page navigation.
     */
    handler(request, reply) {
      if (!isPageNavigation(request)) {
        return reply.callNotFound();
      }
      return reply.html();
    },
  });
}
