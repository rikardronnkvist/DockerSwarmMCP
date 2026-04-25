/**
 * Tool: swarm_scale_service
 * Scales a Docker Swarm replicated service to a desired replica count.
 *
 * Safety:
 *  - Obeys READ_ONLY=true (default): refuses to make changes.
 *  - When READ_ONLY=false: requires force=true to proceed (human-in-the-loop).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';
import { loadConfig } from '../util/security.js';

const inputSchema = {
  service: z.string().min(1).describe('Service name or ID'),
  replicas: z.number().int().min(0).describe('Desired number of replicas'),
  force: z
    .boolean()
    .default(false)
    .describe('Must be true to confirm the scaling operation (human-in-the-loop guard)'),
};

export function registerScaleService(server: McpServer): void {
  server.tool(
    'swarm_scale_service',
    'Scale a Docker Swarm replicated service. READ_ONLY mode (default) prevents any changes. Set force=true to confirm.',
    inputSchema,
    async (args) => {
      try {
        const config = loadConfig();

        if (config.readOnly) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  'Operation refused: server is running in READ_ONLY mode (READ_ONLY=true). ' +
                  'Set the environment variable READ_ONLY=false to enable write operations.',
              },
            ],
            isError: true,
          };
        }

        if (!args.force) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Scaling service "${args.service}" to ${args.replicas} replica(s) requires confirmation. ` +
                  'Set force=true to proceed.',
              },
            ],
            isError: true,
          };
        }

        await assertSwarmManager();
        const docker = getDockerClient();

        const svc = docker.getService(args.service);
        const inspected = await svc.inspect({});

        const mode = inspected.Spec?.Mode ?? {};
        if (!('Replicated' in mode)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Service "${args.service}" is not a replicated service (mode: ${JSON.stringify(mode)}). Only replicated services can be scaled.`,
              },
            ],
            isError: true,
          };
        }

        const currentReplicas = (
          mode.Replicated as { Replicas?: number } | undefined
        )?.Replicas;

        // Build the updated spec preserving the current version
        const updatedSpec = {
          ...inspected.Spec,
          Mode: {
            Replicated: { Replicas: args.replicas },
          },
          version: inspected.Version?.Index,
        };

        const response = await svc.update(updatedSpec);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  service: args.service,
                  before: { replicas: currentReplicas ?? 'unknown' },
                  after: { replicas: args.replicas },
                  response,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error scaling service "${args.service}": ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
