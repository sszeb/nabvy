# Self-hosted CI runner

Owner's decision, 2026-09-24: Nabvy pays GitHub nothing for Actions. While the repository is
public (owner, 22:40: until the production beta is about 90% built) GitHub-hosted runners are free
and `.github/workflows/ci.yml` uses `runs-on: ubuntu-24.04`. When the owner makes the repository
private again, the reviewer or coordinator asks the owner to install a runner from this page, then
switches every `runs-on` to `[self-hosted, linux, x64]` in the same pull request. Never run a
self-hosted runner for a public repository. While no runner with those labels is online, jobs
queue (they do not fail); the queue drains when one comes up.

## What the machine needs

Any 64-bit Linux box that is on most of the day: a spare desktop, a home server, a small VPS.
The four jobs together take about 15 minutes per pull request; two runners let two PRs check at
once.

| Need | Why |
| --- | --- |
| Ubuntu 22.04 or 24.04 (or Debian 12), 4 GB RAM, 20 GB free disk | The runner, Node and the pnpm store |
| `git`, `curl`, `tar` | Checkout and the gitleaks download |
| Docker Engine, with the runner user in the `docker` group | The migration dry-run starts a `postgres:17` service container and runs `docker exec` into it |
| `postgresql-client` | `psql` and `createdb` for `scripts/db-dry-run.sh` |
| Outbound HTTPS | GitHub, the npm registry, Docker Hub, the gitleaks release |

Node itself is not installed by hand: `actions/setup-node` downloads the version in `.nvmrc`
into the runner's tool cache on first use and reuses it afterwards.

## Install (about ten minutes)

Run as a normal user, never as root, and give that user no sudo. All commands are on the runner
machine.

1. Prerequisites:
   ```bash
   sudo apt-get update
   sudo apt-get install -y git curl tar postgresql-client docker.io
   sudo usermod -aG docker "$USER"
   newgrp docker
   docker run --rm hello-world   # proves Docker works without sudo
   ```
2. In GitHub open the repository, then **Settings → Actions → Runners → New self-hosted runner**,
   choose **Linux / x64**. GitHub shows a download command, a checksum line and a `config.sh`
   line that carries a one-hour registration token. Run those three exactly as shown, in a fresh
   folder such as `~/actions-runner`. When `config.sh` asks:
   - runner group: press Enter (Default);
   - runner name: the machine's name;
   - additional labels: press Enter (the defaults `self-hosted`, `linux`, `x64` are the ones the
     workflow uses);
   - work folder: press Enter (`_work`).
3. Install it as a service so it survives reboots and log-outs:
   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```
4. Back in GitHub the runner shows as **Idle** under Settings → Actions → Runners. Re-run any
   queued workflow (Actions tab → the run → **Re-run all jobs**) and watch it pick the runner.

A second runner is the same steps in a second folder (`~/actions-runner-2`) with a new
registration token; give it a different name.

## Keeping it safe

- The repository is private, so only its own workflows reach the runner. Never point this runner
  at a public repository: a pull request from a fork would run arbitrary code on the machine.
- The runner user has no sudo and no secrets on disk. The workflow needs none: the migration
  dry-run uses a throwaway Postgres container with the password `ci-only`.
- Keep the machine patched; `apt-get upgrade` monthly is enough. The runner updates itself.
- Tidy the disk now and then: `docker system prune -f` and delete `~/actions-runner/_work/_tool`
  if Node versions pile up.

## Cost reference

Before this change each pull request cost about 25 GitHub-hosted runner-minutes across the four
jobs, and the build wave on 2026-09-24 produced over 240 runs, which exhausted the plan's minutes
at about 22:11 UTC and made every new job fail two seconds after creation with no runner assigned
and no log. Self-hosted runners have no minute limit.

## Removing a runner

On the machine: `sudo ./svc.sh stop && sudo ./svc.sh uninstall && ./config.sh remove --token
<removal token from Settings → Actions → Runners → the runner → Remove>`.
