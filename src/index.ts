/**
 * DockerSwarmMCP – main entry point.
 *
 * Transport selection via MCP_TRANSPORT env variable:
 *   http   (default) – Streamable HTTP MCP server on POST /mcp
 *   stdio            – stdin/stdout JSON-RPC (all logging goes to stderr)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createMcpServer } from './mcp/server.js';
import { loadConfig, originValidationMiddleware } from './util/security.js';
import { logger } from './util/logger.js';

interface JsonRpcRequestLike {
  method?: unknown;
  id?: unknown;
  params?: {
    name?: unknown;
  };
}

function logMcpRequest(body: unknown): void {
  const requests = Array.isArray(body) ? body : [body];

  for (const request of requests) {
    if (!request || typeof request !== 'object') {
      logger.debug('MCP request received with non-object body');
      continue;
    }

    const jsonRpcRequest = request as JsonRpcRequestLike;
    const method =
      typeof jsonRpcRequest.method === 'string' ? jsonRpcRequest.method : 'unknown-method';
    const id = jsonRpcRequest.id == null ? 'notification' : JSON.stringify(jsonRpcRequest.id);

    if (method === 'tools/call') {
      const toolName =
        typeof jsonRpcRequest.params?.name === 'string'
          ? jsonRpcRequest.params.name
          : 'unknown-tool';
      logger.debug(`MCP request: method=${method} tool=${toolName} id=${id}`);
      continue;
    }

    logger.debug(`MCP request: method=${method} id=${id}`);
  }
}

async function startStdio(): Promise<void> {
  logger.info('Starting DockerSwarmMCP in stdio mode');
  const mcpServer = createMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info('DockerSwarmMCP stdio transport ready');
}

async function startHttp(): Promise<void> {
  const config = loadConfig();

  logger.info(
    `Starting DockerSwarmMCP HTTP server on ${config.bindHost}:${config.port}`,
  );

  // Build an Express app with built-in DNS-rebinding protection
  const app = createMcpExpressApp({
    host: config.bindHost,
    // If MCP_ALLOWED_HOSTS is set, enforce that allowlist.
    // If unset, allow all host headers (useful for remote clients).
    ...(config.allowedHosts.length > 0 ? { allowedHosts: config.allowedHosts } : {}),
  });

  // Additional Origin header validation when an explicit allowlist is provided
  app.use(originValidationMiddleware(config));

  // Health probe – no auth required
  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  // Stateless MCP endpoint – a new transport per request keeps things simple
  app.all('/mcp', async (req, res) => {
    logMcpRequest(req.body);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const server = app.listen(config.port, config.bindHost, () => {
    logger.info(
      `DockerSwarmMCP HTTP server listening on http://${config.bindHost}:${config.port}`,
    );
    logger.info(`  MCP endpoint : http://${config.bindHost}:${config.port}/mcp`);
    logger.info(`  Health check : http://${config.bindHost}:${config.port}/healthz`);
    logger.info(`  Read-only    : ${config.readOnly}`);
  });

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info('Shutting down HTTP server...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main(): Promise<void> {
  const transport = (process.env['MCP_TRANSPORT'] ?? 'http').toLowerCase();

  if (transport === 'stdio') {
    await startStdio();
  } else {
    await startHttp();
  }
}

main().catch(err => {
  logger.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
