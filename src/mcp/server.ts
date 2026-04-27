/**
 * MCP Server – registers all Docker Swarm tools and returns a configured McpServer.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListServices } from '../tools/listServices.js';
import { registerInspectService } from '../tools/inspectService.js';
import { registerScaleService } from '../tools/scaleService.js';
import { registerListNodes } from '../tools/listNodes.js';
import { registerServiceLogs } from '../tools/serviceLogs.js';
import { registerReadTraefikConfig } from '../tools/readTraefikConfig.js';
import { logger } from '../util/logger.js';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'DockerSwarmMCP',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'This server exposes Docker Swarm management operations as MCP tools. ' +
        'Connect to a Swarm manager node to use swarm_list_services, ' +
        'swarm_inspect_service, swarm_scale_service, swarm_list_nodes, and swarm_service_logs. ' +
        'If TRAEFIK_URL is configured, traefik_read_config is also available.',
    },
  );

  registerListServices(server);
  registerInspectService(server);
  registerScaleService(server);
  registerListNodes(server);
  registerServiceLogs(server);

  const traefikUrl = process.env['TRAEFIK_URL']?.trim();
  if (traefikUrl) {
    registerReadTraefikConfig(server, traefikUrl);
    logger.info(`Enabled Traefik config reader tool with TRAEFIK_URL=${traefikUrl}`);
  } else {
    logger.info('Traefik config reader tool disabled (set TRAEFIK_URL to enable)');
  }

  return server;
}
