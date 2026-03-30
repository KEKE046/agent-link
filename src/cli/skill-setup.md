# agent-link Setup Guide

## Install

Download a pre-built binary:

```sh
# Linux x64
curl -Lo ~/.local/bin/agent-link \
  https://github.com/KEKE046/agent-link/releases/latest/download/agent-link-linux-x64
chmod +x ~/.local/bin/agent-link

# Linux arm64
curl -Lo ~/.local/bin/agent-link \
  https://github.com/KEKE046/agent-link/releases/latest/download/agent-link-linux-arm64
chmod +x ~/.local/bin/agent-link

# macOS arm64 (Apple Silicon)
curl -Lo ~/.local/bin/agent-link \
  https://github.com/KEKE046/agent-link/releases/latest/download/agent-link-darwin-arm64
chmod +x ~/.local/bin/agent-link

# macOS x64
curl -Lo ~/.local/bin/agent-link \
  https://github.com/KEKE046/agent-link/releases/latest/download/agent-link-darwin-x64
chmod +x ~/.local/bin/agent-link
```

Build from source (requires Bun):

```sh
git clone https://github.com/KEKE046/agent-link && cd agent-link
bun install && bun run build:binary
mv dist/agent-link ~/.local/bin/
```

---

## Scenario 1: Local standalone

Everything on one machine, browser at `http://localhost:3456`.

```sh
agent-link server                          # bind 127.0.0.1, port 3456 (default)
agent-link server --port 8080              # custom port
agent-link server --bind 0.0.0.0          # expose on LAN / all interfaces
```

---

## Scenario 2: Panel on server + nodes on local machines

Panel runs on a server with a reachable IP. Nodes connect outbound — no inbound firewall changes needed on nodes.

```sh
# On server — start panel
agent-link server --accept-nodes --port 3456
# First run prints admin token and login URL — save the token

# On each local machine — connect as node
agent-link node http://SERVER_IP:3456 --name my-laptop
# Node appears as PENDING in web UI; approve it once to register
```

Panel web UI shows all nodes, sessions, and lets you create agents on any node.

---

## Scenario 3: Node behind NAT — SSH reverse tunnel to panel

Node can SSH into the panel server but the panel can't reach the node directly.

```sh
# On panel server
agent-link server --accept-nodes --port 3456

# From node machine — open reverse tunnel + connect
#   -R 13456:localhost:3456  forwards panel's port 3456 to localhost on node side
#   Use a non-standard remote port (13456) to avoid conflicts
ssh -N -R 13456:localhost:3456 user@panel-server &
agent-link node http://localhost:13456 --name internal-node
```

For a persistent tunnel with autossh:

```sh
autossh -M 0 -N \
  -o "ServerAliveInterval=30" \
  -o "ServerAliveCountMax=3" \
  -o "ExitOnForwardFailure=yes" \
  -R 13456:localhost:3456 \
  user@panel-server
```

---

## Scenario 4: Relay node (bridges two networks)

A relay node sits between the panel and sub-nodes that can't reach the panel directly.

```sh
# Panel
agent-link server --accept-nodes --port 3456

# Relay (reachable by both panel and sub-nodes)
agent-link node http://panel:3456 --accept-nodes --port 3457 --name relay

# Sub-nodes connect to relay, not panel
agent-link node http://relay:3457 --name sub-node-1
agent-link node http://relay:3457 --name sub-node-2
```

The relay transparently proxies sub-nodes to the panel. Panel sees all nodes directly.

---

## Scenario 5: Panel local, nodes on remote SSH machines

You run the panel locally and SSH into remote machines to run nodes. The remote machines
can't reach your local IP, so you expose the panel via a reverse tunnel from your side.

```sh
# Locally — start panel
agent-link server --accept-nodes --port 3456

# From local — SSH into remote, forwarding panel access
#   -L 13456:localhost:3456  makes panel available on remote as localhost:13456
ssh -L 13456:localhost:3456 user@remote-machine

# On remote machine (inside that SSH session)
agent-link node http://localhost:13456 --name remote-machine
```

---

## SSH Keepalive

Pass keepalive options directly on the command line — no config file editing needed:

```sh
# Plain ssh tunnel with keepalive
ssh -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" \
  -N -R 13456:localhost:3456 user@panel-server

# autossh (recommended for persistent tunnels)
autossh -M 0 -N \
  -o "ServerAliveInterval=30" \
  -o "ServerAliveCountMax=3" \
  -o "ExitOnForwardFailure=yes" \
  -R 13456:localhost:3456 \
  user@panel-server
```

If the tunnel needs to bind on 0.0.0.0 on the server (so machines other than the server
itself can reach it), the server's sshd needs `GatewayPorts yes` — this requires a
sysadmin to set in `/etc/ssh/sshd_config`. For the common case where only the node
itself connects to localhost, the default is fine.

---

## systemd User Service (Linux)

Runs agent-link at login without root, restarts on failure.

```sh
mkdir -p ~/.config/systemd/user
```

**Server mode** — `~/.config/systemd/user/agent-link.service`:

```ini
[Unit]
Description=Agent Link Server
After=network.target

[Service]
ExecStart=%h/.local/bin/agent-link server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

**Node mode** — `~/.config/systemd/user/agent-link.service`:

```ini
[Unit]
Description=Agent Link Node
After=network.target

[Service]
ExecStart=%h/.local/bin/agent-link node http://PANEL:3456 --name %H
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

`%H` = hostname, `%h` = home directory.

Enable and start:

```sh
systemctl --user daemon-reload
systemctl --user enable agent-link
systemctl --user start agent-link

# Persist after logout (services survive SSH disconnect):
loginctl enable-linger $USER
```

Check logs: `journalctl --user -u agent-link -f`

---

## SSH Tunnel as systemd Service

To keep the reverse tunnel alive as a service (before the node service):

```ini
# ~/.config/systemd/user/agent-link-tunnel.service
[Unit]
Description=Agent Link SSH Tunnel
After=network.target

[Service]
ExecStart=autossh -M 0 -N \
  -o "ServerAliveInterval=30" \
  -o "ServerAliveCountMax=3" \
  -o "ExitOnForwardFailure=yes" \
  -R 13456:localhost:3456 \
  user@panel-server
Restart=on-failure
RestartSec=15

[Install]
WantedBy=default.target
```

Then make the node service depend on the tunnel:

```ini
[Unit]
After=network.target agent-link-tunnel.service
Requires=agent-link-tunnel.service
```

---

## macOS launchd

```sh
cat > ~/Library/LaunchAgents/io.agent-link.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>io.agent-link</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOU/.local/bin/agent-link</string>
    <string>server</string>
  </array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardErrorPath</key> <string>/tmp/agent-link.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/io.agent-link.plist
```

---

## Gotchas

- `--accept-nodes` enables auth by default. First run prints the admin token and login URL.
  Subsequent runs reuse the stored token from `~/.agent-link/auth.json`.
- New nodes start as **PENDING** — approve them once in the web UI; they auto-approve on reconnect.
- Node connects outbound only — no firewall changes needed on the node side.
- SSH reverse tunnel (`-R`): the remote port (e.g. 13456) is local to the server, not the node.
  Use a non-standard port to avoid conflicting with any panel already running on the server.
- `GatewayPorts yes` is only needed if machines OTHER than the server need to reach the tunnel.
  For node-on-server-reaching-panel, default `GatewayPorts no` is sufficient.
- `loginctl enable-linger` is required for user services to survive after SSH logout.
  Without it, services stop when the last SSH session disconnects.
- autossh package required for persistent tunnels: `apt install autossh` / `brew install autossh`.
- On macOS, replace `/Users/YOU` with your actual home path in the plist.
