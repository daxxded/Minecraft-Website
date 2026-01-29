# Minecraft server control panel plan

## Goal
Build a small, self-hosted web app that lets trusted users log in and manage a
Minecraft Java server on an Ubuntu host. This includes starting/stopping the
server, choosing RAM allocation at launch time, toggling `server.properties`
settings, streaming console output, and limited file access.

## Recommended architecture (simple + safe)
1. **Backend API (Node.js/Express or Python/FastAPI)**
   - Runs on the same Ubuntu host as the Minecraft server.
   - Exposes authenticated endpoints to start/stop the server, read logs, and
     update config.
2. **Frontend (simple HTML/JS or React)**
   - Login page, then a protected dashboard page.
   - Uses the backend API with cookies or tokens.
3. **System control**
   - Use a dedicated system user (e.g., `minecraft`) and a `systemd` service to
     run the server.
   - The web app talks to `systemd` (start/stop) and edits config files through
     controlled backend logic (not direct arbitrary access).
4. **Security**
   - Put the app behind HTTPS (Caddy or Nginx + LetsEncrypt).
   - Strong passwords + rate limiting + session expiry.
   - Optional: IP allowlist or VPN.

## Key feature breakdown

### 1) Login page
- Use server-side sessions (secure, HTTP-only cookies).
- Store user credentials in a database or a local JSON file **hashed** with
  bcrypt/argon2.
- Keep the frontend minimal: username/password -> POST `/login`.

### 2) Start button + RAM slider
- RAM slider selects X GB; backend validates range (e.g., 2–12 GB) and converts
  to JVM flags: `-Xms${ram}G -Xmx${ram}G`.
- Use a `systemd` template or environment file to pass RAM:
  - Example: `/etc/minecraft/launch.env` with `MC_RAM=6G`.
  - The backend updates this file, then calls `systemctl restart mc.service`.

### 3) Toggle settings in `server.properties`
- Read `server.properties`, parse key/value pairs, and expose a whitelist of
  options in the UI (e.g., `pvp`, `online-mode`, `difficulty`).
- Only allow toggling whitelisted keys to avoid unintended edits.
- Write back the file in the original format (preserve comments if possible).

### 4) Console output
- Stream output from the server log or `journalctl -u mc.service -f`.
- Use Server-Sent Events (SSE) or WebSockets to stream to the dashboard.
- For command input, send commands to the server via RCON or `mcrcon`.

### 5) File system access (limited)
- Provide a *scoped* file browser to a single directory, e.g.
  `/srv/minecraft`.
- Expose only read/download and a small set of safe write operations
  (upload/rename/delete) guarded by validation.
- Disallow `..` path traversal and symlinks escaping the root.

## Suggested stack (minimal)
- Backend: **Node.js + Express** or **Python + FastAPI**.
- Auth: session cookies + bcrypt.
- Process control: `systemd` + `sudo` with a locked-down sudoers rule.
- Console/log streaming: SSE or WebSocket.
- Frontend: minimal HTML/CSS/JS or a tiny React app.

## Implementation outline
1. Create a backend service with endpoints:
   - `POST /login`
   - `POST /server/start` (with RAM)
   - `POST /server/stop`
   - `GET /server/status`
   - `GET /logs/stream`
   - `GET /properties`
   - `PUT /properties` (whitelisted keys only)
   - `GET /files` (directory listing)
   - `GET /files/download` (file download)
   - `POST /files/upload`
2. Create a simple UI with:
   - Login screen
   - Dashboard with Start/Stop, RAM slider, properties toggles, log output, and
     file manager panel
3. Add security:
   - HTTPS, session timeouts, and rate limiting
   - Use environment variables or a `.env` file for secrets

## Deployment notes
- Run the web app as a systemd service as well (e.g., `mc-panel.service`).
- Keep backups of `server.properties` before writing.
- Avoid running the web app as root.

## Caveats
- Exposing server control on the internet carries risk. Prefer a VPN or IP
  allowlist for production.
- Validate all inputs; never pass user input into shell commands.
