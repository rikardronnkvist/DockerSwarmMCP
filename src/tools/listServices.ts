/**
 * Tool: swarm_list_services
 * Lists Docker Swarm services with optional filtering.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import Dockerode from 'dockerode';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';

const inputSchema = {
  filters: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe('Docker API filter map, e.g. {"name":["my-svc"]}'),
  namePrefix: z
    .string()
    .optional()
    .describe('Filter services whose name starts with this prefix'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe('Maximum number of services to return'),
};

interface ServiceSummary {
  id: string;
  name: string;
  mode: string;
  desiredReplicas: number | null;
  runningReplicas: number | null;
  image: string;
  ports: Array<{
    published: number | undefined;
    target: number | undefined;
    protocol: string | undefined;
  }>;
  updatedAt: string | undefined;
}

function summariseService(svc: Dockerode.Service): ServiceSummary {
  const spec = svc.Spec ?? {};
  const mode = spec.Mode ?? {};
  const image =
    (spec.TaskTemplate as { ContainerSpec?: { Image?: string } } | undefined)
      ?.ContainerSpec?.Image ?? 'unknown';

  let modeLabel = 'unknown';
  let desiredReplicas: number | null = null;

  if ('Replicated' in mode && mode.Replicated) {
    modeLabel = 'replicated';
    desiredReplicas = (mode.Replicated as { Replicas?: number }).Replicas ?? null;
  } else if ('Global' in mode) {
    modeLabel = 'global';
  } else if ('ReplicatedJob' in mode) {
    modeLabel = 'replicated-job';
  } else if ('GlobalJob' in mode) {
    modeLabel = 'global-job';
  }

  const serviceStatus = svc.ServiceStatus as
    | { RunningTasks?: number; DesiredTasks?: number }
    | undefined;
  const runningReplicas = serviceStatus?.RunningTasks ?? null;
  if (serviceStatus?.DesiredTasks != null && desiredReplicas === null) {
    desiredReplicas = serviceStatus.DesiredTasks;
  }

  const ports = (svc.Endpoint?.Ports ?? []).map(p => ({
    published: p.PublishedPort,
    target: p.TargetPort,
    protocol: p.Protocol,
  }));

  return {
    id: svc.ID,
    name: spec.Name ?? svc.ID,
    mode: modeLabel,
    desiredReplicas,
    runningReplicas,
    image,
    ports,
    updatedAt: svc.UpdatedAt,
  };
}

export function registerListServices(server: McpServer): void {
  server.tool(
    'swarm_list_services',
    'List Docker Swarm services. Returns id, name, mode, replicas, image, ports, and updatedAt.',
    inputSchema,
    async (args) => {
      try {
        await assertSwarmManager();
        const docker = getDockerClient();

        const listOpts: Dockerode.ServiceListOptions = { status: true };

        if (args.filters) {
          listOpts.filters = args.filters as Record<string, string[]>;
        }

        if (args.namePrefix) {
          const existing = (listOpts.filters ?? {}) as Record<string, string[]>;
          existing['name'] = [args.namePrefix];
          listOpts.filters = existing;
        }

        let services = await docker.listServices(listOpts);

        if (args.limit != null) {
          services = services.slice(0, args.limit);
        }

        const summaries = services.map(summariseService);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${summaries.length} service(s):\n\n${JSON.stringify(summaries, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error listing services: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
