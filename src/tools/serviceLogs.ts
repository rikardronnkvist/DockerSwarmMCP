/**
 * Tool: swarm_service_logs
 * Fetches logs from a Docker Swarm service.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';
import type stream from 'node:stream';
import { logger } from '../util/logger.js';

const MAX_LOG_BYTES = 1_000_000; // 1 MB

type LogPayload = stream.Readable | Buffer | Uint8Array | string;

const inputSchema = {
  service: z.string().min(1).describe('Service name or ID'),
  sinceSeconds: z
    .number()
    .int()
    .min(1)
    .default(3600)
    .describe('Fetch logs from this many seconds ago (default: 3600 = 1 hour)'),
  tail: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(200)
    .describe('Maximum number of log lines to return (default: 200)'),
  timestamps: z
    .boolean()
    .default(false)
    .describe('Include timestamps in each log line'),
};

/** Read a Node.js readable stream into a Buffer, capped at maxBytes. */
async function readStream(
  readable: stream.Readable,
  maxBytes: number,
): Promise<{ data: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    readable.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (truncated) return;
      if (totalBytes + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - totalBytes));
        totalBytes = maxBytes;
        truncated = true;
        readable.destroy();
        return;
      }
      chunks.push(buf);
      totalBytes += buf.length;
    });

    readable.on('end', () => resolve({ data: Buffer.concat(chunks), truncated }));
    readable.on('close', () => resolve({ data: Buffer.concat(chunks), truncated }));
    readable.on('error', reject);
  });
}

async function readLogPayload(
  payload: LogPayload,
  maxBytes: number,
): Promise<{ data: Buffer; truncated: boolean }> {
  if (typeof payload === 'string') {
    const data = Buffer.from(payload);
    return {
      data: data.subarray(0, maxBytes),
      truncated: data.length > maxBytes,
    };
  }

  if (Buffer.isBuffer(payload)) {
    return {
      data: payload.subarray(0, maxBytes),
      truncated: payload.length > maxBytes,
    };
  }

  if (payload instanceof Uint8Array) {
    const data = Buffer.from(payload);
    return {
      data: data.subarray(0, maxBytes),
      truncated: data.length > maxBytes,
    };
  }

  if (payload && typeof payload.on === 'function') {
    return readStream(payload, maxBytes);
  }

  const payloadType = payload === null ? 'null' : typeof payload;
  throw new Error(`Unsupported logs payload type: ${payloadType}`);
}

function describeLogPayload(payload: unknown): string {
  if (payload === null) return 'null';
  if (payload === undefined) return 'undefined';
  if (typeof payload === 'string') return `string(length=${payload.length})`;
  if (Buffer.isBuffer(payload)) return `Buffer(length=${payload.length})`;
  if (payload instanceof Uint8Array) return `Uint8Array(length=${payload.length})`;

  if (typeof payload === 'object') {
    const constructorName = payload.constructor?.name ?? 'Object';
    const hasOn = typeof (payload as { on?: unknown }).on === 'function';
    return hasOn ? `${constructorName}(readable-stream)` : constructorName;
  }

  return typeof payload;
}

function normaliseLogText(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .join('\n');
}

/**
 * Docker multiplexed stream frames start with an 8-byte header:
 * [stream_type(1), 0, 0, 0, size(4 big-endian)]
 * This function strips those headers to return plain text.
 */
function demuxDockerStream(buf: Buffer): string {
  if (buf.length < 8) {
    return normaliseLogText(buf.toString('utf8'));
  }

  const lines: string[] = [];
  let offset = 0;

  while (offset < buf.length) {
    // Need at least 8 bytes for the header
    if (offset + 8 > buf.length) {
      return normaliseLogText(buf.toString('utf8'));
    }

    const streamType = buf[offset];
    if (streamType !== 1 && streamType !== 2 && streamType !== 3) {
      return normaliseLogText(buf.toString('utf8'));
    }

    const size = buf.readUInt32BE(offset + 4);
    offset += 8;

    if (size === 0) continue;
    if (offset + size > buf.length) {
      // Partial frame – take what we have
      const partial = buf.subarray(offset).toString('utf8');
      lines.push(partial);
      break;
    }

    const payload = buf.subarray(offset, offset + size).toString('utf8');
    lines.push(payload);
    offset += size;
  }

  return normaliseLogText(lines.join(''));
}

export function registerServiceLogs(server: McpServer): void {
  server.tool(
    'swarm_service_logs',
    'Fetch logs from a Docker Swarm service. Returns up to 1 MB of log text.',
    inputSchema,
    async (args) => {
      try {
        await assertSwarmManager();
        const docker = getDockerClient();

        const svc = docker.getService(args.service);
        const since = Math.floor(Date.now() / 1000) - args.sinceSeconds;

        logger.debug(
          `swarm_service_logs request: service=${args.service} tail=${args.tail} since=${since} timestamps=${args.timestamps}`,
        );

        // Fetch logs from the service
        const logPayload = await svc.logs({
          stdout: true,
          stderr: true,
          tail: args.tail,
          since,
          timestamps: args.timestamps,
          follow: false,
        });

        logger.debug(
          `swarm_service_logs payload: service=${args.service} type=${describeLogPayload(logPayload)}`,
        );

        const { data, truncated } = await readLogPayload(logPayload as LogPayload, MAX_LOG_BYTES);
        logger.debug(
          `swarm_service_logs bytes: service=${args.service} bytes=${data.length} truncated=${truncated}`,
        );

        const text = demuxDockerStream(data);
        logger.debug(
          `swarm_service_logs decoded: service=${args.service} textLength=${text.length}`,
        );

        const suffix = truncated
          ? '\n\n[Output truncated at 1 MB. Use a smaller tail or sinceSeconds to reduce output.]'
          : '';

        return {
          content: [
            {
              type: 'text' as const,
              text: text || `(no logs found for service "${args.service}")${suffix}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`swarm_service_logs failed: service=${args.service} error=${message}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching logs for service "${args.service}": ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}