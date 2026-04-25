/**
 * Tool: swarm_inspect_service
 * Returns a readable JSON summary of a single Docker Swarm service.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';

const inputSchema = {
  service: z.string().min(1).describe('Service name or ID'),
};

export function registerInspectService(server: McpServer): void {
  server.tool(
    'swarm_inspect_service',
    'Inspect a Docker Swarm service. Returns a trimmed summary of spec, endpoint, mode, and update status.',
    inputSchema,
    async (args) => {
      try {
        await assertSwarmManager();
        const docker = getDockerClient();

        const svc = docker.getService(args.service);
        const raw = await svc.inspect({});

        // Build a human-friendly trimmed summary
        const spec = raw.Spec ?? {};
        const mode = spec.Mode ?? {};
        const taskTemplate = spec.TaskTemplate ?? {};
        const containerSpec = taskTemplate.ContainerSpec ?? {};

        const summary = {
          id: raw.ID,
          name: spec.Name,
          createdAt: raw.CreatedAt,
          updatedAt: raw.UpdatedAt,
          mode: mode,
          image: containerSpec.Image,
          env: containerSpec.Env,
          labels: spec.Labels,
          updateConfig: spec.UpdateConfig,
          rollbackConfig: spec.RollbackConfig,
          networks: spec.Networks,
          endpoint: raw.Endpoint,
          updateStatus: raw.UpdateStatus,
          serviceStatus: raw.ServiceStatus,
          version: raw.Version,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error inspecting service "${args.service}": ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
