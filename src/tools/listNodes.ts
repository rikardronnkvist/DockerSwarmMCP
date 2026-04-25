/**
 * Tool: swarm_list_nodes
 * Lists Docker Swarm nodes with optional role and availability filters.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Dockerode from 'dockerode';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';

const inputSchema = {
  role: z
    .enum(['manager', 'worker'])
    .optional()
    .describe('Filter by node role'),
  availability: z
    .enum(['active', 'pause', 'drain'])
    .optional()
    .describe('Filter by node availability'),
};

interface NodeSummary {
  id: string;
  hostname: string;
  role: string;
  availability: string;
  status: string;
  addr: string;
  engineVersion: string;
}

export function registerListNodes(server: McpServer): void {
  server.tool(
    'swarm_list_nodes',
    'List Docker Swarm nodes. Optionally filter by role (manager/worker) and availability (active/pause/drain).',
    inputSchema,
    async (args) => {
      try {
        await assertSwarmManager();
        const docker = getDockerClient();

        type NodeFilters = { role?: string[]; 'node.availability'?: string[] };
        const filters: NodeFilters = {};

        if (args.role) {
          filters['role'] = [args.role];
        }
        if (args.availability) {
          filters['node.availability'] = [args.availability];
        }

        const listOpts: Dockerode.NodeListOptions =
          Object.keys(filters).length > 0
            ? { filters: JSON.stringify(filters) }
            : {};

        const nodes = await docker.listNodes(listOpts);

        const summaries: NodeSummary[] = nodes.map((n: Record<string, unknown>) => {
          const spec = (n['Spec'] ?? {}) as Record<string, unknown>;
          const status = (n['Status'] ?? {}) as Record<string, unknown>;
          const managerStatus = (n['ManagerStatus'] ?? {}) as Record<string, unknown>;
          const description = (n['Description'] ?? {}) as Record<string, unknown>;
          const engine = (description['Engine'] ?? {}) as Record<string, unknown>;

          return {
            id: (n['ID'] as string | undefined) ?? 'unknown',
            hostname: (description['Hostname'] as string | undefined) ?? 'unknown',
            role: (spec['Role'] as string | undefined) ?? 'unknown',
            availability: (spec['Availability'] as string | undefined) ?? 'unknown',
            status: (status['State'] as string | undefined) ?? 'unknown',
            addr:
              (managerStatus['Addr'] as string | undefined) ??
              (status['Addr'] as string | undefined) ??
              'unknown',
            engineVersion: (engine['EngineVersion'] as string | undefined) ?? 'unknown',
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${summaries.length} node(s):\n\n${JSON.stringify(summaries, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error listing nodes: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
