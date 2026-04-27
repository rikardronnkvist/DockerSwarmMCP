/**
 * Tool: traefik_read_config
 * Reads Traefik dynamic/runtime configuration from the Traefik API.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../util/logger.js';

const inputSchema = {
  endpoint: z
    .enum(['rawdata', 'overview', 'http/routers', 'http/services', 'http/middlewares'])
    .default('rawdata')
    .describe('Traefik API endpoint to query'),
};

const endpointPath: Record<string, string> = {
  rawdata: '/api/rawdata',
  overview: '/api/overview',
  'http/routers': '/api/http/routers',
  'http/services': '/api/http/services',
  'http/middlewares': '/api/http/middlewares',
};

export function registerReadTraefikConfig(server: McpServer, traefikUrl: string): void {
  server.tool(
    'traefik_read_config',
    'Read Traefik configuration and HTTP routing data from the Traefik API.',
    inputSchema,
    async (args) => {
      try {
        const path = endpointPath[args.endpoint] ?? endpointPath['rawdata'];
        const url = new URL(path, traefikUrl);

        logger.debug(`traefik_read_config request: endpoint=${args.endpoint} url=${url.toString()}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const body = await response.text();
          const snippet = body.slice(0, 300);
          throw new Error(
            `Traefik API request failed (${response.status} ${response.statusText}): ${snippet}`,
          );
        }

        const data = await response.json();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`traefik_read_config failed: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Error reading Traefik config: ${message}` }],
          isError: true,
        };
      }
    },
  );
}