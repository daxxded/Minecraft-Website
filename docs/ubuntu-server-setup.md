# Ubuntu setup guide for the Minecraft control panel

This tutorial walks through deploying the control panel on an Ubuntu server
running a Minecraft Java server. It assumes you already have the Minecraft
server files on disk (e.g., `/srv/minecraft`).

## 1) Create a dedicated Minecraft user and directories
```bash
sudo adduser --system --home /srv/minecraft --group minecraft
sudo mkdir -p /srv/minecraft
sudo chown -R minecraft:minecraft /srv/minecraft
```

Copy your Minecraft server files into `/srv/minecraft` and make sure
`server.properties` exists there.

## 2) Install Java and Node.js
```bash
sudo apt update
sudo apt install -y openjdk-17-jre-headless curl
```

Install Node.js 20.x:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3) Create the systemd service for Minecraft
Create `/etc/systemd/system/minecraft.service`:
```ini
[Unit]
Description=Minecraft Server
After=network.target

[Service]
User=minecraft
WorkingDirectory=/srv/minecraft
EnvironmentFile=/etc/minecraft/launch.env
ExecStart=/usr/bin/java -Xms${MC_RAM} -Xmx${MC_RAM} -jar /srv/minecraft/server.jar nogui
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Create the RAM environment file:
```bash
sudo mkdir -p /etc/minecraft
echo "MC_RAM=4G" | sudo tee /etc/minecraft/launch.env
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable minecraft
sudo systemctl start minecraft
```

## 4) Configure sudo for the control panel
The control panel runs as a separate user (e.g., `mc-panel`) and needs permission
only to manage the Minecraft systemd service.

Create a user:
```bash
sudo adduser --system --home /opt/mc-panel --group mc-panel
```

Give the panel access to Minecraft files (logs/properties/files):
```bash
sudo usermod -aG minecraft mc-panel
sudo setfacl -R -m u:mc-panel:rwX /srv/minecraft
sudo setfacl -R -d -m u:mc-panel:rwX /srv/minecraft
```

Create `/etc/sudoers.d/mc-panel`:
```text
mc-panel ALL=NOPASSWD: /bin/systemctl start minecraft.service, /bin/systemctl stop minecraft.service, /bin/systemctl restart minecraft.service, /bin/systemctl is-active minecraft.service
```

## 5) Deploy the control panel
Clone the repo and install dependencies:
```bash
sudo -u mc-panel -H bash -c "cd /opt/mc-panel && git clone <YOUR_REPO_URL> ."
sudo -u mc-panel -H bash -c "cd /opt/mc-panel && npm install"
```

Copy the config example and edit:
```bash
sudo -u mc-panel -H bash -c "cd /opt/mc-panel && cp config.example.json config.json"
```

Edit `config.json` values for your environment:
- `sessionSecret`: random string
- `minecraft.serviceName`: `minecraft.service`
- `minecraft.envFile`: `/etc/minecraft/launch.env`
- `minecraft.logFile`: `/srv/minecraft/logs/latest.log`
- `minecraft.propertiesFile`: `/srv/minecraft/server.properties`
- `minecraft.rootDir`: `/srv/minecraft`
- `minecraft.ramMin` / `minecraft.ramMax`: allowed slider range
- `minecraft.propertyWhitelist`: keys you want editable in the UI

## 6) Create login users
Use the helper script to create users:
```bash
sudo -u mc-panel -H bash -c "cd /opt/mc-panel && npm run create-user -- admin <PASSWORD>"
```

This writes hashed credentials to the `userFile` path in your config.

## 7) Run the control panel as a service
Create `/etc/systemd/system/mc-panel.service`:
```ini
[Unit]
Description=Minecraft Control Panel
After=network.target

[Service]
User=mc-panel
WorkingDirectory=/opt/mc-panel
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/mc-panel/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mc-panel
sudo systemctl start mc-panel
```

## 8) (Recommended) Put the panel behind HTTPS
Use Caddy or Nginx. Example Caddyfile:
```text
panel.example.com {
  reverse_proxy localhost:3000
}
```

## 9) Access the panel
Visit `http://<server-ip>:3000`, log in, and manage your server.

## Troubleshooting
- Check service status: `sudo systemctl status minecraft`
- Check panel logs: `sudo journalctl -u mc-panel -f`
- If log streaming is empty, verify `minecraft.logFile` points to the current
  `latest.log` path.
