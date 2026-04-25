/**
 * Stderr-safe logger for DockerSwarmMCP.
 * All output goes to stderr so it never pollutes stdout in stdio transport mode.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function log(level: LogLevel, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args
    .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  process.stderr.write(`[${timestamp}] ${level} ${message}\n`);
}

export const logger = {
  debug: (...args: unknown[]) => log('DEBUG', ...args),
  info: (...args: unknown[]) => log('INFO', ...args),
  warn: (...args: unknown[]) => log('WARN', ...args),
  error: (...args: unknown[]) => log('ERROR', ...args),
};
