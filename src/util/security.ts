/**
 * Security configuration and middleware for DockerSwarmMCP.
 * Handles Origin validation and environment-based configuration parsing.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export interface SecurityConfig {
  transport: 'http' | 'stdio';
  bindHost: string;
  port: number;
  allowedOrigins: string[];
  allowNoOrigin: boolean;
  readOnly: boolean;
}

export function loadConfig(): SecurityConfig {
  const transport = (process.env['MCP_TRANSPORT'] ?? 'http').toLowerCase();
  if (transport !== 'http' && transport !== 'stdio') {
    logger.warn(`Unknown MCP_TRANSPORT="${transport}", defaulting to "http"`);
  }

  const bindHost = process.env['MCP_BIND'] ?? '127.0.0.1';
  const port = parseInt(process.env['PORT'] ?? '3000', 10);

  const rawOrigins = process.env['MCP_ALLOWED_ORIGINS'] ?? '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  const allowNoOrigin = process.env['MCP_ALLOW_NO_ORIGIN'] === 'true';

  // READ_ONLY defaults to true for safety
  const readOnly = process.env['READ_ONLY'] !== 'false';

  return {
    transport: transport === 'stdio' ? 'stdio' : 'http',
    bindHost,
    port,
    allowedOrigins,
    allowNoOrigin,
    readOnly,
  };
}

/**
 * Express middleware that validates the Origin header against the allowlist.
 * Use when MCP_ALLOWED_ORIGINS is set to restrict cross-origin access.
 */
export function originValidationMiddleware(config: SecurityConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only apply if an allowlist is configured
    if (config.allowedOrigins.length === 0) {
      next();
      return;
    }

    const origin = req.headers['origin'];

    if (!origin) {
      if (config.allowNoOrigin) {
        next();
        return;
      }
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing Origin header' },
        id: null,
      });
      return;
    }

    if (config.allowedOrigins.includes(origin)) {
      next();
      return;
    }

    logger.warn(`Rejected request from disallowed origin: ${origin}`);
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Origin not allowed: ${origin}` },
      id: null,
    });
  };
}
