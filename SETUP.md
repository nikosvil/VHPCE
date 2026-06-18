# VHPCE — Setup Guide

Three tiers. Pick the one that matches your machine — you can always add the next tier later
without redoing anything.

| Tier | What you get | Needs |
|------|---------------|-------|
| **0 — Quick Start** | Full UI in Model mode — every page, every experiment, fully interactive | Node.js ≥ 20.9 + pnpm. Any OS. |
| **1 — Measured (CPU)** | Real OpenMP/MPI runs on your cores; the Code Playground actually compiles and runs your code | + Docker |
| **2 — Measured (GPU)** | CUDA experiments (GPU Occupancy, Coalescing, Divergence, Atomics) run on your NVIDIA GPU | + NVIDIA GPU + `nvidia-container-toolkit` |

Tier 0 is fully functional on its own — every experiment has an offline physics-based model with
2D/3D visuals and a written diagnosis. Tiers 1 and 2 add real hardware measurements on top.

---

## 0. Requirements matrix

| | Tier 0 (Quick Start) | Tier 1 (CPU Measured) | Tier 2 (GPU Measured) |
|---|---|---|---|
| OS | Windows, macOS, Linux | Windows (with WSL2), macOS, Linux | Linux or WSL2 only (NVIDIA GPUs aren't available to Docker on macOS / Windows-native) |
| Node.js | **≥ 20.9** (Next.js 16's minimum; 22/24 work fine) | same | same |
| pnpm | 11.5.1 (via `corepack`, see below) | same | same |
| Docker | not needed | Docker Desktop (Win/macOS) or Docker Engine + Compose plugin (Linux) | same, plus `nvidia-container-toolkit` |
| GPU | not needed | not needed | NVIDIA GPU + recent driver |
| Disk space | ~1 GB (`node_modules`) | + ~2-3 GB for the CPU sandbox images | + ~5-7 GB for the CUDA devel image (one-time pull) |
| RAM | 4 GB+ | 8 GB+ recommended | 8 GB+ recommended |

**No local install at all?** This repo includes a [Dev Container](.devcontainer/devcontainer.json).
Open it in **GitHub Codespaces** ("Code → Codespaces → Create codespace") and Tier 0 is ready
immediately (`pnpm install` runs automatically); Tier 1 also works inside the Codespace via
Docker-in-Docker.

---

## 1. Tier 0 — Quick Start (Model mode, no Docker)

### 1.1 Install Node.js and pnpm

Install **Node.js 20.9 or newer** (22 or 24 recommended) from
[nodejs.org](https://nodejs.org/) (or via [nvm](https://github.com/nvm-sh/nvm) /
[volta](https://volta.sh/) if you manage multiple versions). Then enable **pnpm** via Node's
built-in `corepack` (no separate install):

```bash
corepack enable
```

Verify:

```bash
node -v     # v20.9.0 or higher
pnpm -v     # 11.5.1 (pinned in package.json — corepack picks this up automatically)
```

### 1.2 Clone and install

```bash
git clone https://github.com/nikosvil/VHPCE.git
cd VHPCE
pnpm install
```

### 1.3 Run it

```bash
pnpm --filter web dev
```

Open **http://localhost:3000**. Pick any experiment — it should show a chart, 2D/3D animation, and a written diagnosis in Model mode.

The **Measured** toggle and Playground **Run** button show a banner until the gateway is running (Tier 1). Everything else works offline.

---

## 2. Tier 1 — Measured mode (your CPU, via Docker)

This builds and runs real OpenMP/MPI kernels in locked-down Docker containers, and powers the Code Playground.

### 2.1 Install Docker

Pick your OS:

<details>
<summary><b>Windows</b></summary>

1. Install **WSL2**: open PowerShell as Administrator and run `wsl --install`, then reboot if
   prompted. (Microsoft's guide: https://learn.microsoft.com/windows/wsl/install)
2. Install **Docker Desktop** (https://www.docker.com/products/docker-desktop/). During/after
   install, open Docker Desktop → **Settings → Resources → WSL Integration** and enable
   integration with your default WSL distro.
3. You can run all the commands below from PowerShell *or* a WSL terminal — both reach the same
   Docker daemon.

</details>

<details>
<summary><b>macOS</b></summary>

1. Install **Docker Desktop** for Mac (https://www.docker.com/products/docker-desktop/) — Intel
   or Apple Silicon both work for the CPU images.
2. Start Docker Desktop and wait for the whale icon to show "running."

</details>

<details>
<summary><b>Linux</b></summary>

1. Install **Docker Engine** + the **Compose plugin** for your distro
   (https://docs.docker.com/engine/install/).
2. Add your user to the `docker` group so you don't need `sudo` for every command, then
   **log out and back in**:
   ```bash
   sudo usermod -aG docker $USER
   ```

</details>

### 2.2 Build the CPU sandbox images

```bash
pnpm gateway:build:cpu
```

This builds the OpenMP bench kernels, the code runner, and the MPI image (not CUDA — that's Tier 2). First run takes a couple of minutes to pull the base image.

### 2.3 Start the gateway

```bash
pnpm gateway:up
```

This starts Redis + the FastAPI gateway + the Arq worker (`infra/docker/compose.yml`). Check it's
healthy:

```bash
curl http://localhost:8000/api/health
# {"ok":true,"redis":true,"docker":true,"cores":<your CPU count>}
```

### 2.4 Use it

With the dev server still running, reload **http://localhost:3000**. The "gateway offline" banner disappears. Switch any experiment to **Measured** — you're now seeing real timings from your CPU. On `/playground`, the **Run** button compiles and executes your code.

> **Core count note:** the measured sweep tries thread/rank counts up to 24 regardless of how many cores you have. If your machine has fewer, the curve will flatten or dip past your core count — that's real oversubscription, not a bug.

### 2.5 Stopping / updating

```bash
pnpm gateway:down                # stop redis + api + worker
pnpm gateway:logs                # follow logs
pnpm gateway:build:cpu           # rebuild after editing infra/docker/* or services/*
```

---

## 3. Tier 2 — GPU experiments (optional, NVIDIA only)

Requires an **NVIDIA GPU** with Docker GPU passthrough. Works on Linux and Windows+WSL2. Not supported on macOS or AMD/Intel GPUs.

1. Make sure your **NVIDIA driver** is up to date. On Windows, the standard GeForce/Studio driver already includes WSL2 GPU support.
2. Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
3. Verify GPU passthrough works:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu24.04 nvidia-smi
   ```
   Your GPU should appear in the output. If this fails, fix it before continuing.
4. Build the CUDA image (large — one-time download of several GB):
   ```bash
   pnpm gateway:build:gpu
   ```
5. Reload the app — the GPU experiments now run on your GPU in Measured mode.

**No compatible GPU?** Nothing breaks. CUDA experiments stay in Model mode and revert automatically if you try Measured without a GPU.

---

## 4. Environment variables (optional)

```bash
cp apps/web/.env.example apps/web/.env.local
```

Edit the file, then restart the dev server.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VHPCE_API` | `http://localhost:8000` | Where the web app looks for the gateway. Change this if your gateway runs on a different host (e.g. a shared classroom server). |
| `ANTHROPIC_API_KEY` | _(unset)_ | Enables the **"Ask the AI"** panel for all users. Without a server-side key, each user can paste their own key in the panel — it stays in the browser tab and is never sent to the server. |

---

## 5. Verifying your install

| Check | Expected |
|---|---|
| `http://localhost:3000/` | Flagship loads, an experiment renders a chart + 2D/3D scene + diagnosis |
| `http://localhost:3000/learn` | Six animated concept cards (OpenMP/MPI basics) |
| `http://localhost:3000/reference` | Searchable directive library (~214 entries) |
| `http://localhost:3000/lab` | 2D heat-equation simulation animates |
| `http://localhost:3000/playground` | Monaco editor loads with a worked example |
| `http://localhost:8000/api/health` *(Tier 1)* | `{"ok":true,...}` |
| Flagship **Measured** toggle *(Tier 1)* | No "gateway offline" banner; numbers change to reflect your machine |
| Flagship CUDA tabs, **Measured** *(Tier 2)* | Real occupancy/timing numbers from your GPU |

---

## 6. For instructors: a shared classroom gateway

Students only need Node.js — no Docker, no GPU — if you run one shared gateway for the class.

1. On a server, follow Tier 1 (and optionally Tier 2) to start `infra/docker/compose.yml` on port `8000`.
2. On student machines, set `NEXT_PUBLIC_VHPCE_API=https://your-server:8000` in `apps/web/.env.local`, then run the dev server as normal.
3. Students get Measured mode and a working Playground without installing Docker.

**Security:** the code runner is sandboxed (`--network none`, `--cap-drop ALL`, read-only filesystem, memory/PID/time limits), but you're still running untrusted student code. Put the gateway behind a private network or VPN — don't expose port `8000` to the public internet without authentication.

---

## 7. Troubleshooting

- **`node`/`pnpm` not found after install** — close and reopen your terminal so PATH picks up the new install.
- **`pnpm install` fails with a registry error** — check your network or VPN; pnpm needs to reach `registry.npmjs.org`.
- **Docker commands need `sudo` on Linux** — you weren't added to the `docker` group, or didn't log out and back in after being added (see §2.1).
- **`docker run --gpus all` fails ("could not select device driver")** — the NVIDIA Container Toolkit isn't installed or configured correctly (§3, steps 2–3).
- **Port 3000 or 8000 already in use** — stop the conflicting process, or start the dev server on a different port: `pnpm --filter web exec next dev -p 3001`.
- **First CUDA build is slow** — the CUDA base image is 5–7 GB; it's a one-time download.
- **`tsc --noEmit` complains about `.next/dev/types`** — delete the generated folder: `rm -rf apps/web/.next/dev/types`.
- **`/api/health` returns `"docker": false`** — Docker Desktop may still be starting; wait a few seconds and retry.

---

## 8. Updating

```bash
git pull
pnpm install
# If infra/docker/* or services/* changed:
pnpm gateway:build:cpu   # and/or gateway:build:gpu
pnpm gateway:down && pnpm gateway:up
```
