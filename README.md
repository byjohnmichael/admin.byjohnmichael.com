# admin.byjohnmichael.com

Private admin panel for the byjohnmichael.com server: system overview,
live performance, a one-screen monitor, Minecraft and WoW management, and
Bob the Orb (a status orb you can chat with) docked on every page.

Next.js 16 app (`next start` on port 3100), meant to sit behind nginx.

```bash
npm install          # also installs bob-the-orb from GitHub (see below)
npm run build
npm start            # :3100
npm run bob          # Bob's chat backend (normally a systemd service)
```

## Pages

| Tab | What it shows |
| --- | --- |
| `./overview` | System, specs, services (start/stop/pin), to-dos, quick server status, reboot |
| `./performance` | Per-component detail: CPU, RAM, SSD, GPU, PSU, NET, OS + processes, each in its own colour |
| `./monitor` | Every component's vitals plus Minecraft/WoW status on one screen, sized for 1920×1080 |
| `./minecraft` | Server health (TPS, tick time, Spark reports, backups), players, whitelist and location requests, BlueMap markers, trailers |
| `./wow` | Characters and account requests |

## Logging in

You sign in with a real account on the server, using its normal password. There is no separate admin password anymore.

- Only accounts in the **`wheel`** group may log in (`ADMIN_LOGIN_GROUP`
  changes the group; `ADMIN_LOGIN_USERS=jm,alice` replaces the group check
  with an explicit list).
- The password is checked with `unix_chkpwd`, the same helper PAM's
  `pam_unix` uses. It only checks *other* users' passwords when run as root,
  so the site (which doesn't run as root) calls it through `sudo -n`. Add this
  sudoers rule for the user the site runs as (`visudo -f /etc/sudoers.d/admin-site`):

  ```
  # let the admin panel verify login passwords (and nothing else)
  jm ALL=(root) NOPASSWD: /usr/bin/unix_chkpwd
  ```

  Replace `jm` with the service's user. On Debian/Ubuntu the helper lives at
  `/usr/sbin/unix_chkpwd`; set `UNIX_CHKPWD` to match.
- Sessions are signed with **`SESSION_SECRET`** (required, 16+ characters):
  `openssl rand -hex 32`. `ADMIN_PASSWORD` is no longer used — remove it.
  Existing sessions are invalidated by this change; everyone logs in once more.
- Failed logins are rate limited (`LOGIN_RATE_LIMIT_MAX`, default 5 per
  `LOGIN_RATE_LIMIT_WINDOW_MIN`, default 15 minutes). The error never says
  whether the username exists.
- If the sudo rule is missing, the login page says *"Password check is not set
  up on the server."* and the reason is logged (`journalctl -u admin-site`).

Note: `unix_chkpwd` checks the password hash directly. It doesn't run the
rest of the PAM stack (no `pam_faillock`, no 2FA modules); the site's own rate
limit stands in for lockout.

## Bob the Orb

Bob lives in the bottom-right corner of every page. The orb shows the
server's state at a glance (colour per component, a face for the overall
mood); click it to open a chat with Bob.

The bob-the-orb update split Bob into two halves, both installed by
`npm install`:

1. **Frontend:** the orb and the chat panel, imported from `bob-the-orb`
   (`src/components/FloatingBob.tsx`).
2. **Backend:** `bob-the-orb-server`, a small Node server the chat talks to
   over a WebSocket. It now has two engines. This site uses the **API
   engine**, which calls the Anthropic API with an API key; the old default
   needed a logged-in `claude` CLI.

### Installing the package

`package.json` depends on `github:byjohnmichael/bob-the-orb`, and
`package-lock.json` pins the exact commit. The repo is private, so the
machine running `npm install` needs GitHub access to it: an SSH key or
deploy key on the account that runs npm (`ssh -T git@github.com` should
greet you). npm builds the package on install (its `prepare` script), so the
first install takes a little longer.

To pick up a newer Bob, run `npm install github:byjohnmichael/bob-the-orb`
and commit the updated lockfile.

### Running the backend

Bob gets a shell and file tools on the server. Run the backend as an
unprivileged user, bound to localhost, with its working directory limited to
what Bob should be able to touch.

`/etc/admin-bob.env` (`chmod 600`, owned by the service user):

```bash
BOB_ENGINE=api
ANTHROPIC_API_KEY=sk-ant-...        # billed to this key
BOB_HOST=127.0.0.1                  # never expose the backend directly
BOB_BACKEND_PORT=8787
BOB_SESSION_CWD=/home/jm            # Bob's shell/file tools start here and file edits stay inside it
# BOB_MODEL=claude-opus-5-5         # default in API mode
# BOB_EFFORT=medium                 # low | medium | high | xhigh | max
```

`/etc/systemd/system/admin-bob.service`:

```ini
[Unit]
Description=Bob the Orb backend for admin.byjohnmichael.com
After=network-online.target

[Service]
User=jm
WorkingDirectory=/path/to/admin.byjohnmichael.com
EnvironmentFile=/etc/admin-bob.env
ExecStart=/usr/bin/npm run bob
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now admin-bob
# if the old Claude Code backend is still installed, retire it:
systemctl --user disable --now bob-claude-adapter
```

### nginx: put Bob behind the admin login

**Bob's backend has no authentication of its own**, and its approval mode
starts in "auto": anyone who can reach its WebSocket can make it run shell
commands. Keep `BOB_HOST=127.0.0.1`, and let nginx pass `/ws` through only
for a logged-in admin. The site's `/api/bob/auth` route answers 204 for a
valid session and 401 otherwise:

```nginx
# inside the server { } block for admin.byjohnmichael.com
location = /_bob_auth {
    internal;
    proxy_pass http://127.0.0.1:3100/api/bob/auth;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
}

location /ws {
    auth_request /_bob_auth;
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

Check it: logged out, `curl -i https://admin.byjohnmichael.com/ws` must
return **401**, not a WebSocket upgrade.

Inside the chat, the **Auto / Manual** toggle decides whether Bob's shell
commands and file writes run immediately or wait for your Allow/Deny.

## Configuration

Everything machine-specific comes from environment variables, so a
different box (or a swapped part) mostly needs a different env file, not
code changes. Hardware is detected at runtime: CPU (any vendor), cores and
threads, memory slots (`dmidecode`), disks and filesystems, network
interfaces, temperatures (hwmon) and NVMe health (`nvme-cli`). Swapping a
CPU, RAM, a drive or a NIC is picked up automatically after a restart.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | — (required) | Signs login sessions |
| `ADMIN_LOGIN_GROUP` | `wheel` | Group allowed to log in |
| `ADMIN_LOGIN_USERS` | — | Comma list of allowed users; replaces the group check |
| `UNIX_CHKPWD` | `/usr/bin/unix_chkpwd` | Password-check helper path |
| `LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MIN` | `5` / `15` | Login attempt limit |
| `SITE_UNITS` | the three byjohnmichael.com sites | `label=unit.service,…` shown as site dots |
| `ADMIN_SERVERS_FILE` | built-in list | JSON file describing the servers on Performance (see below) |
| `MANAGED_UNITS` | all `.service` units | Restrict the Overview service list: `unit.service=Label,…` |
| `ADMIN_SELF_UNIT` | `admin-site.service` | This app's own unit (restarts are deferred) |
| `MC_CONTAINER` | `minecraft` | Minecraft container (RCON, logs, Spark) |
| `MC_DATA_DIR` / `MC_WORLD_DIR` | `/opt/minecraft/server/data` / `…/world` | Minecraft server data |
| `MC_BACKUP_HOURLY_CONTAINER` / `_MONTHLY_` | `mc-backup-hourly` / `mc-backup-monthly` | restic backup containers |
| `SITE_DATA_DIR` | see note | Shared data with mc.byjohnmichael.com (requests, medals, markers) |
| `BLUEMAP_MAPS_DIR` | under `MC_DATA_DIR` | BlueMap marker files |
| `TRAILERS_DIR` | `/var/www/mc.byjohnmichael.com/mc-media/trailers` | Trailer uploads |
| `WOW_*_CONTAINER`, `WOW_DB_USER`, `WOW_DB_PASSWORD` | `wow-wotlk-*-1`, `mangos` | WoW containers and DB login |
| `WOW_SITE_DATA_DIR` | `/var/www/wow.byjohnmichael.com/wow-site-data` | Shared data with wow.byjohnmichael.com |
| `PERF_NET_IFACE` / `PERF_DISK_DEV` | auto | Pin the interface / disk the graphs follow |
| `PERF_NVIDIA_SMI` | `nvidia-smi` | GPU stats binary |
| `PERF_RAPL_PATH` / `PERF_RAPL_DRAM_PATH` | `intel-rapl:0` / auto | CPU / DRAM power counters (also used on AMD) |
| `PERF_FAN_COUNT` | `3` | Fans in the PSU power estimate |
| `PERF_DISABLE_PERF` | — | `1` turns off `perf stat` (IPC / cycles) |

`ADMIN_SERVERS_FILE` example:

```json
[
  { "key": "minecraft", "label": "Minecraft", "unit": "minecraft.service", "containers": ["minecraft"] },
  { "key": "jellyfin", "label": "Jellyfin", "composeFile": "/opt/jellyfin/docker-compose.yml", "containers": ["jellyfin"] },
  { "key": "nginx", "label": "Nginx (Websites)", "unit": "nginx.service", "procNames": ["nginx"] }
]
```

### What's still tied to this setup

- **GPU: NVIDIA only.** GPU stats come from `nvidia-smi`. With an AMD or Intel GPU the GPU panels show "No GPU detected"; the rest of the site works.
- **Games run in Docker** under the container names above. A server run some other way needs its env vars (and possibly code) adjusted.
- **Default paths disagree in two places.** If these variables aren't set, different parts of the app fall back to different folders, so **set both explicitly**:
  - `SITE_DATA_DIR` defaults to `/var/www/mc-site-data` in `store.ts` but `/var/www/mc.byjohnmichael.com/mc-site-data` in `bluemapMarkers.ts`.
  - `MC_DATA_DIR` defaults to `/opt/minecraft/server/data` in most files but `/opt/mc/data` in `bluemapMarkers.ts`.
- **Logins need sudo access to `unix_chkpwd`** (above), which assumes a PAM-based Linux with shadow passwords. That's standard on Arch, Debian and Fedora.
- **The PSU figure is an estimate:** measured RAPL/GPU watts plus per-part guesses, not a reading from the PSU.
