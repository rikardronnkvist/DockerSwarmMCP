/**
 * Tool: swarm_service_logs
 * Fetches logs from a Docker Swarm service.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDockerClient, assertSwarmManager } from '../docker/client.js';
import type stream from 'node:stream';

const MAX_LOG_BYTES = 1_000_000; // 1 MB

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

/**
 * Docker multiplexed stream frames start with an 8-byte header:
 * [stream_type(1), 0, 0, 0, size(4 big-endian)]
 * This function strips those headers to return plain text.
 */
function demuxDockerStream(buf: Buffer): string {
  const lines: string[] = [];
  let offset = 0;

  while (offset < buf.length) {
    // Need at least 8 bytes for the header
    if (offset + 8 > buf.length) break;

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

  const raw = lines.join('');
  // Normalise – split by newline and rejoin so we have consistent separators
  return raw
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.length > 0)
    .join('\n');
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

        // Fetch logs from the service
        const logStream = await svc.logs({
          stdout: true,
          stderr: true,
          tail: args.tail,
          since: Math.floor(Date.now() / 1000) - args.sinceSeconds,
          timestamps: args.timestamps,
          follow: false,
        });

        // Validate the stream before using it
        if (!logStream || typeof logStream.on !== 'function') {
          throw new Error(
            'Service logs API did not return a readable stream. Service may not exist or Docker API version incompatibility.',
          );
        }

        const { data, truncated } = await readStream(logStream as stream.Readable, MAX_LOG_BYTES);
        const text = demuxDockerStream(data);

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