/**
 * Dockerode client initialisation and Swarm helper utilities.
 */

import Dockerode from 'dockerode';
import { logger } from '../util/logger.js';

let _docker: Dockerode | null = null;

export function getDockerClient(): Dockerode {
  if (_docker) return _docker;

  const dockerHost = process.env['DOCKER_HOST'];

  if (dockerHost) {
    if (dockerHost.startsWith('tcp://') || dockerHost.startsWith('http://')) {
      // Parse TCP host, e.g. tcp://192.168.1.1:2376
      const url = new URL(dockerHost.replace(/^tcp:\/\//, 'http://'));
      _docker = new Dockerode({
        host: url.hostname,
        port: parseInt(url.port || '2375', 10),
      });
      logger.info(`Docker client: TCP ${dockerHost}`);
    } else if (dockerHost.startsWith('unix://')) {
      const socketPath = dockerHost.slice('unix://'.length);
      _docker = new Dockerode({ socketPath });
      logger.info(`Docker client: Unix socket ${socketPath}`);
    } else {
      // Bare path treated as Unix socket
      _docker = new Dockerode({ socketPath: dockerHost });
      logger.info(`Docker client: socket ${dockerHost}`);
    }
  } else {
    _docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
    logger.info('Docker client: /var/run/docker.sock');
  }

  return _docker;
}

/** Throws a descriptive error if the node is not an active Swarm manager. */
export async function assertSwarmManager(): Promise<void> {
  const docker = getDockerClient();
  const info = await docker.info();

  const swarm = info.Swarm as {
    LocalNodeState?: string;
    ControlAvailable?: boolean;
  } | undefined;

  if (!swarm || swarm.LocalNodeState !== 'active') {
    throw new Error(
      'This Docker node is not part of a Swarm. ' +
        'Run `docker swarm init` on this node or connect to an existing manager.',
    );
  }

  if (!swarm.ControlAvailable) {
    throw new Error(
      'This Docker node is a Swarm worker, not a manager. ' +
        'Please connect the MCP server to a Swarm manager node.',
    );
  }
}
