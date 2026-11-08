# Deploying runcheck

These steps set up runcheck on a fresh Ubuntu 24.04 server, serving plain HTTP on port 3000. Run them as a non-root user with `sudo` access.

Each verification can use 1 GB of memory and 1 CPU, and 2 can run at once, so use a server with at least 2 CPUs and 4 GB of memory.

## 1. Install system packages and Docker

```bash
sudo apt update
sudo apt install -y git curl ca-certificates docker.io
sudo systemctl enable --now docker
```

Let your user run Docker, then log out and back in so the change applies:

```bash
sudo usermod -aG docker "$USER"
exit
```

After logging back in, check that it works and download the sandbox image. Doing this now keeps the first verification from having to wait for it:

```bash
docker pull node:22-bookworm
```

Anyone who can use Docker effectively has root on the server, so don't add other users to this group.

## 2. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

## 3. Clone and build

```bash
cd ~
git clone https://github.com/dacryptoeth1/runcheck.git
cd runcheck
npm ci
npm run build
```

If the GitHub repo is private, `git clone` will ask you to sign in.

Optional: to raise the GitHub API rate limit, add a token before starting the app. See "Optional: GitHub token" in the [README](README.md).

```bash
echo 'GITHUB_TOKEN=your_token_here' > .env.local
chmod 600 .env.local
```

## 4. Block containers from private networks

Do this before the app starts taking requests. Verifications run untrusted code, and without these rules that code can reach cloud metadata services and other machines on your private network.

Docker's `DOCKER-USER` chain is the supported place for rules like these. Create a script that holds them:

```bash
sudo tee /usr/local/sbin/runcheck-firewall > /dev/null <<'EOF'
#!/bin/sh
set -eu
iptables -F DOCKER-USER
iptables -A DOCKER-USER -i docker0 -d 169.254.0.0/16 -j DROP
iptables -A DOCKER-USER -i docker0 -d 10.0.0.0/8 -j DROP
iptables -A DOCKER-USER -i docker0 -d 172.16.0.0/12 -j DROP
iptables -A DOCKER-USER -i docker0 -d 192.168.0.0/16 -j DROP
EOF
sudo chmod 755 /usr/local/sbin/runcheck-firewall
```

- `-F` clears the chain first, so the script is safe to run repeatedly. It also removes any other rules you've added to `DOCKER-USER`, so add those to this script instead.
- `-i docker0` matches only traffic coming from containers on Docker's default bridge, which is where runcheck's containers run. Traffic to any other address carries on to Docker's own rules, so internet access still works.
- The `172.16.0.0/12` rule also stops containers from reaching each other, because the Docker bridge is inside that range.

Make the rules persistent with a systemd service that runs after Docker starts, and again whenever Docker restarts:

```bash
sudo tee /etc/systemd/system/runcheck-firewall.service > /dev/null <<'EOF'
[Unit]
Description=Block runcheck containers from private networks
Requires=docker.service
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/runcheck-firewall

[Install]
WantedBy=docker.service
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now runcheck-firewall
```

> Don't use the `iptables-persistent` package for this. On Ubuntu it conflicts with `ufw`, so installing it removes `ufw`. It would also save and restore Docker's own generated rules.

Check that the four rules are loaded:

```bash
sudo iptables -L DOCKER-USER -n -v --line-numbers
```

Check that private addresses are blocked. Each address should print `000` after 3 seconds:

```bash
docker run --rm --dns=1.1.1.1 node:22-bookworm sh -c '
  for ip in 169.254.169.254 10.0.0.1 172.16.0.1 192.168.0.1; do
    curl -s -m 3 -o /dev/null -w "$ip %{http_code}\n" "http://$ip/"
  done'
```

Check that the internet still works. This should print `200`:

```bash
docker run --rm --dns=1.1.1.1 node:22-bookworm curl -s -m 10 -o /dev/null -w '%{http_code}\n' https://github.com
```

## 5. Open the firewall

Allow SSH first, or enabling `ufw` can lock you out:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
sudo ufw enable
sudo ufw status verbose
```

Keep `ufw` enabled. The `DOCKER-USER` rules only cover traffic passing through the server. `ufw` is what limits containers to the same ports on the server itself that the internet can reach (here, SSH and 3000).

If your cloud provider has its own firewall or security group, allow TCP port 3000 there too.

## 6. Run with pm2

```bash
sudo npm install -g pm2
cd ~/runcheck
pm2 start server.mjs --name runcheck
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME"
```

Run only one instance, and don't use pm2's cluster mode (`-i`). The concurrency and rate limits are held in memory, so each extra process would get its own separate limits.

Use `server.mjs` rather than `next start`. It records each client's real IP address. With `next start`, a client could fake that address and get around the rate limit.

## 7. Check the deployment

```bash
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/vercel/next-learn","demoUrl":"https://nextjs.org"}'
```

Then open `http://YOUR_SERVER_IP:3000`. A `Sandbox unavailable` error means the app can't use Docker, and `pm2 logs runcheck` shows why. Each verification, including this one, counts toward your IP address's limit of 5 per hour.

`runcheck` also accepts only IPv4 connections, so use the server's IPv4 address.

## Updating

```bash
cd ~/runcheck
git pull
npm ci
npm run build
pm2 restart runcheck
```

Restarting ends any verification in progress and resets the rate limits. Interrupted containers stop themselves within about 8 minutes.

## Adding HTTPS or a reverse proxy later

`server.mjs` treats the connecting address as the client. Behind a proxy such as nginx, that address is always the proxy's, so all visitors would share one limit of 5 verifications per hour.

Before adding a proxy, change `server.mjs` to use the client address the proxy reports, and have the proxy overwrite `X-Forwarded-For` rather than append to it. Then remove `3000/tcp` from `ufw`, and set the proxy's response timeout to at least 8 minutes.
