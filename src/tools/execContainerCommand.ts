/**
 * Tool: swarm_exec_container
 * Execute a command inside a container. This tool is disabled by default
 * and must be explicitly enabled via the ENABLE_CONTAINER_EXEC environment variable.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDockerClient } from '../docker/client.js';
import { logger } from '../util/logger.js';

const inputSchema = {
  containerIdOrName: z
    .string()
    .min(1)
    .describe('Container ID or name to execute command in'),
  command: z
    .array(z.string())
    .min(1)
    .describe('Command and arguments to execute (e.g., ["ping", "-c", "4", "8.8.8.8"])'),
  workingDir: z
    .string()
    .optional()
    .describe('Working directory for the command (optional)'),
  user: z
    .string()
    .optional()
    .describe('User to run the command as (optional, defaults to container default)'),
};

interface ExecOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function registerExecContainerCommand(server: McpServer): void {
  server.tool(
    'swarm_exec_container',
    'Execute a command inside a container. Disabled by default; enable via ENABLE_CONTAINER_EXEC environment variable.',
    inputSchema,
    async (args) => {
      try {
        const docker = getDockerClient();

        logger.debug(
          `exec_container_command request: container=${args.containerIdOrName} command=${JSON.stringify(args.command)}`,
        );

        // Get the container
        const container = docker.getContainer(args.containerIdOrName);

        // Verify the container exists by inspecting it
        try {
          await container.inspect();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `exec_container_command: container not found or not accessible: ${args.containerIdOrName}`,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Container not found or not accessible: ${args.containerIdOrName}\nError: ${message}`,
              },
            ],
            isError: true,
          };
        }

        // Create the exec instance
        const exec = await container.exec({
          Cmd: args.command,
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: args.workingDir,
          User: args.user,
        });

        // Capture output
        let stdout = '';
        let stderr = '';
        let exitCode = 0;

        // Start the exec and get the output stream
        const stream = await exec.start({ Detach: false });

        // Read output from the stream
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => {
            // Docker muxes stdout/stderr with 8-byte header: [stream_type(1), reserved(3), size(4)]
            // stream_type: 1=stdout, 2=stderr
            let offset = 0;
            const buffer = chunk;

            while (offset < buffer.length) {
              if (offset + 8 > buffer.length) {
                // Not enough bytes for header, take what we have as raw data
                const remaining = buffer.slice(offset);
                stdout += remaining.toString('utf8');
                break;
              }

              const streamType = buffer[offset];
              const payloadSize = buffer.readUInt32BE(offset + 4);

              if (streamType === 1) {
                // stdout
                const payload = buffer.slice(offset + 8, offset + 8 + payloadSize);
                stdout += payload.toString('utf8');
              } else if (streamType === 2) {
                // stderr
                const payload = buffer.slice(offset + 8, offset + 8 + payloadSize);
                stderr += payload.toString('utf8');
              }

              offset += 8 + payloadSize;
            }
          });

          stream.on('end', () => {
            resolve();
          });

          stream.on('error', (err) => {
            reject(err);
          });
        });

        // Get the exit code
        const inspectResult = await exec.inspect();
        exitCode = (inspectResult as unknown as Record<string, unknown>)['ExitCode'] as number;

        logger.debug(
          `exec_container_command completed: container=${args.containerIdOrName} exitCode=${exitCode} stdoutLen=${stdout.length} stderrLen=${stderr.length}`,
        );

        const result: ExecOutput = {
          exitCode,
          stdout,
          stderr,
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `exec_container_command failed: container=${args.containerIdOrName} error=${message}`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing command in container: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
