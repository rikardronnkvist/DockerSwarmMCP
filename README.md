# DockerSwarmMCP

A production-ready **Model Context Protocol (MCP)** server that exposes **Docker Swarm** operations as MCP tools. Connect any MCP-compatible AI assistant (Claude, Cursor, etc.) to your Docker Swarm cluster and manage services, inspect nodes, stream logs, and scale deployments—all through natural language.

---

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that lets AI models interact with external tools and data sources in a structured, typed way. An MCP server advertises a set of *tools* that a client (LLM host) can discover and call. Inputs and outputs are schema-validated, making the integration reliable and safe.

---

## Available Tools

| Tool | Description |
|---|---|
| `swarm_list_services` | List Swarm services with id, name, mode, replicas, image, ports, updatedAt |
| `swarm_inspect_service` | Detailed JSON summary of a single service (spec, endpoint, update status) |
| `swarm_scale_service` | Scale a replicated service (requires `READ_ONLY=false` **and** `force=true`) |
| `swarm_list_nodes` | List Swarm nodes filtered by role and/or availability |
| `swarm_service_logs` | Fetch recent logs from a service (up to 1 MB) |

### Tool inputs

#### `swarm_list_services`
| Parameter | Type | Default | Description |
|---|---|---|---|
| `filters` | `Record<string,string[]>` | — | Docker API filter map, e.g. `{"name":["nginx"]}` |
| `namePrefix` | `string` | — | Return only services whose name starts with this prefix |
| `limit` | `number` | `200` | Maximum services to return (1–1000) |

#### `swarm_inspect_service`
| Parameter | Type | Default | Description |
|---|---|---|---|
| `service` | `string` | **required** | Service name or ID |

#### `swarm_scale_service`
| Parameter | Type | Default | Description |
|---|---|---|---|
| `service` | `string` | **required** | Service name or ID |
| `replicas` | `integer ≥ 0` | **required** | Desired replica count |
| `force` | `boolean` | `false` | Must be `true` to confirm the operation |

#### `swarm_list_nodes`
| Parameter | Type | Default | Description |
|---|---|---|---|
| `role` | `"manager" \| "worker"` | — | Filter by role |
| `availability` | `"active" \| "pause" \| "drain"` | — | Filter by availability |

#### `swarm_service_logs`
| Parameter | Type | Default | Description |
|---|---|---|---|
| `service` | `string` | **required** | Service name or ID |
| `sinceSeconds` | `integer` | `3600` | How far back to fetch (seconds) |
| `tail` | `integer` | `200` | Maximum lines to return (1–10000) |
| `timestamps` | `boolean` | `false` | Include timestamps in each line |

---

## How to Run

### Prerequisites

- Docker Engine with Swarm mode initialised (`docker swarm init`)
- The server must run on (or have socket access to) a **Swarm manager** node

### HTTP mode (default)

```bash
# Build
docker build -t dockerswarm-mcp .

# Run – expose on loopback only (safest)
docker run -d \
  --name dockerswarm-mcp \
  -p 127.0.0.1:3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e MCP_BIND=0.0.0.0 \
  -e MCP_ALLOW_NO_ORIGIN=true \
  -e READ_ONLY=true \
  dockerswarm-mcp
```

Or with Docker Compose:

```bash
docker compose up -d
```

Health check:

```bash
curl http://127.0.0.1:3000/healthz
# → ok
```

### stdio mode

stdio mode is used when the AI client spawns the server as a child process and communicates over stdin/stdout (e.g. Claude Desktop, Cursor).

```bash
docker run -i --rm \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e MCP_TRANSPORT=stdio \
  dockerswarm-mcp
```

> **Important:** In stdio mode all logging is written to **stderr** so it never pollutes the JSON-RPC stream on stdout.

---

## Smoke Tests

### Health probe

```bash
curl -s http://127.0.0.1:3000/healthz
# ok
```

### MCP initialise (pseudo-curl)

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

### List tools

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id-from-init>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

### Call a tool

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id-from-init>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"swarm_list_services","arguments":{}}}'
```

---

## Configuration Reference

| Environment Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `http` | `http` or `stdio` |
| `PORT` | `3000` | HTTP listen port |
| `MCP_BIND` | `127.0.0.1` | HTTP bind address (`0.0.0.0` for all interfaces) |
| `MCP_ALLOWED_ORIGINS` | *(empty)* | Comma-separated Origin allowlist; empty = no Origin check |
| `MCP_ALLOW_NO_ORIGIN` | `false` | Allow requests without an Origin header when allowlist is set |
| `READ_ONLY` | `true` | `true` = refuse all write operations (scale, etc.) |
| `DOCKER_HOST` | *(socket)* | Override Docker endpoint, e.g. `tcp://192.168.1.1:2375` |

### TLS / DOCKER_HOST

When using `DOCKER_HOST=tcp://…`, TLS is **not** handled by this server (v1). Terminate TLS externally (e.g. a TLS-terminating proxy, stunnel, or SSH tunnel) and point `DOCKER_HOST` at the plaintext endpoint. Full TLS support (`DOCKER_TLS_VERIFY`, cert/key files) is planned for a future release.

---

## AI Client Configuration

### Claude Desktop (`claude_desktop_config.json`)

**HTTP mode** (server already running):

```json
{
  "mcpServers": {
    "docker-swarm": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

**stdio mode** (Claude spawns the container):

```json
{
  "mcpServers": {
    "docker-swarm": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/var/run/docker.sock:/var/run/docker.sock:ro",
        "-e", "MCP_TRANSPORT=stdio",
        "dockerswarm-mcp"
      ]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "docker-swarm": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/var/run/docker.sock:/var/run/docker.sock:ro",
        "-e", "MCP_TRANSPORT=stdio",
        "dockerswarm-mcp"
      ]
    }
  }
}
```

---

## Security Considerations

### docker.sock access

Mounting `/var/run/docker.sock` into any container is equivalent to granting **root access** to the host. Mitigations:

- Keep `READ_ONLY=true` (default) — prevents scaling and other write operations.
- Run the MCP server only on your internal network or VPN.
- Use socket proxies (e.g. [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) to restrict the Docker API surface exposed to the container.

### Origin allowlist (DNS rebinding protection)

When `MCP_ALLOWED_ORIGINS` is set, the server rejects requests whose `Origin` header is not in the list. This mitigates DNS-rebinding attacks against the HTTP endpoint. Example:

```bash
-e MCP_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
```

The SDK also automatically validates the `Host` header when binding to `127.0.0.1` or `localhost`.

### READ_ONLY mode

By default `READ_ONLY=true`. The `swarm_scale_service` tool (and any future write tools) will refuse to execute. To enable writes:

```bash
-e READ_ONLY=false
```

Even then, `swarm_scale_service` requires `force=true` in the tool arguments as an additional human-in-the-loop confirmation step.

---

## Development

```bash
# Install dependencies
npm install

# Run with hot-reload (tsx watch)
MCP_TRANSPORT=http npm run dev

# Type-check without emitting
npm run lint

# Build for production
npm run build

# Run the compiled server
npm start
```

---

## License

MIT — see [LICENSE](LICENSE).
