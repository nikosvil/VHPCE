# VHPCE — Setup Guide

This guide gets **Visual HPC for Engineers** running on your machine, from "I just cloned the
repo" to "I can see it in my browser." It's written for students and instructors with varying
hardware — **everything below Tier 0 is optional**, and the app tells you what's available.

There are three tiers. Pick the one that matches your machine — you can always add the next tier
later without redoing anything.

| Tier | What you get | Needs |
|------|---------------|-------|
| **0 — Quick Start** | The full UI: Flagship (Model mode), `/learn`, `/reference`, `/lab`, the Code Playground UI | Node.js + pnpm only. Any OS, any hardware. |
| **1 — Measured (CPU)** | Real OpenMP/MPI compiles & runs on *your* CPU cores, behind the Model⇄Measured toggle; the Code Playground actually runs your code | + Docker |
| **2 — Measured (GPU)** | The CUDA experiments (GPU Occupancy, Coalescing, Divergence, Atomics) run on *your* NVIDIA GPU | + NVIDIA GPU, driver, `nvidia-container-toolkit` |

If you only do Tier 0, the app is **fully usable** — every experiment has a physically-grounded
model, deterministic explanations, and interactive 2D/3D visuals with no backend at all.

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

This installs dependencies for the whole monorepo (the Next.js app + its shared `@vhpce/*`
packages — there's no separate build step, packages are consumed as TypeScript source directly).

### 1.3 Run it

```bash
pnpm --filter web dev
```

Open **http://localhost:3000**. You should see the Flagship — pick an experiment (e.g. *False
Sharing*), it should render a chart, a 2D/3D scene, and a written diagnosis, all in **Model**
mode.

**What works at Tier 0:** `/` (Flagship, Model mode), `/learn`, `/reference`, `/lab` — all fully
interactive, all offline. The **Measured** toggle and the Playground's **Run** button need
Tier 1 (below); without it they show a banner explaining the gateway isn't running, and
Measured falls back to Model automatically.

---

## 2. Tier 1 — Measured mode (your CPU, via Docker)

This builds and runs the real OpenMP/MPI kernels in locked-down Docker containers, and powers
the Code Playground (compile + run arbitrary OpenMP C you write).

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

From the repo root (this builds the OpenMP bench kernels, the untrusted-code runner, and the MPI
image — **not** CUDA, which is large and GPU-only):

```bash
pnpm gateway:build:cpu
```

This is equivalent to
`docker compose -f infra/docker/compose.yml --profile build build bench runner mpi`. It pulls a
gcc/Ubuntu base image and compiles the kernels — a couple of minutes the first time.

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

With `pnpm --filter web dev` still running (Tier 0), reload **http://localhost:3000**. The
"gateway offline" banner should disappear. On the Flagship, switch **Model → Measured** — you're
now seeing real wall-clock timings from containers running on *your* CPU. On `/playground`, the
**Run** button now compiles and executes your code.

> **Note on core counts:** the measured sweep always tries thread/rank counts up to 24 (or 64 in
> the Playground), regardless of how many cores you have. If your machine has fewer cores, the
> curve will flatten or even dip past your core count — that's real **oversubscription**, not a
> bug, and it's its own useful lesson about scheduling overhead.

### 2.5 Stopping / updating

```bash
pnpm gateway:down                # stop redis + api + worker
pnpm gateway:logs                # follow logs
pnpm gateway:build:cpu           # rebuild after editing infra/docker/* or services/*
```

---

## 3. Tier 2 — GPU experiments (optional, NVIDIA only)

The CUDA experiments (GPU Occupancy, Memory Coalescing, Warp Divergence, Atomic Contention) need
an **NVIDIA GPU** with Docker GPU passthrough. This works on **Linux** and **Windows+WSL2**, not
on macOS (no NVIDIA GPUs) or AMD/Intel GPUs.

1. Install/update your **NVIDIA driver** (Windows users: the regular GeForce/Studio driver
   already includes WSL2 GPU support — no separate driver needed inside WSL).
2. Install the **NVIDIA Container Toolkit**:
   https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
3. Smoke-test GPU passthrough:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu24.04 nvidia-smi
   ```
   You should see your GPU listed. If this fails, fix it before continuing — the steps below
   will fail the same way.
4. Build the CUDA image (large — pulls a multi-GB CUDA devel image the first time):
   ```bash
   pnpm gateway:build:gpu
   ```
5. Reload the app — the GPU experiments under the Flagship's CUDA tabs now run on your GPU in
   Measured mode.

**Don't have a compatible GPU?** Nothing breaks. The CUDA experiments stay in Model mode (which
already shows the lesson — e.g. register-pressure-limited occupancy) — switching to Measured
without a GPU shows a clear error and reverts to Model automatically.

---

## 4. Environment variables (optional)

Copy `apps/web/.env.example` to `apps/web/.env.local` and edit as needed, then restart
`pnpm --filter web dev`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VHPCE_API` | `http://localhost:8000` | Where the web app looks for the gateway. Only change this if the gateway runs elsewhere (see "For instructors" below). |
| `ANTHROPIC_API_KEY` | _(unset)_ | Enables the server-side **"Ask the AI"** panel for everyone. Without it, each user can paste their own key in the UI (kept per-tab, never sent to the server). Get a key at https://console.anthropic.com/. |

---

## 5. Verifying your install

| Check | Expected |
|---|---|
| `http://localhost:3000/` | Flagship loads, an experiment renders a chart + 2D/3D scene + diagnosis |
| `http://localhost:3000/learn` | Six animated concept cards (OpenMP/MPI basics) |
| `http://localhost:3000/reference` | Searchable directive library (~150+ entries) |
| `http://localhost:3000/lab` | 2D heat-equation simulation animates |
| `http://localhost:3000/playground` | Monaco editor loads with a worked example |
| `http://localhost:8000/api/health` *(Tier 1)* | `{"ok":true,...}` |
| Flagship **Measured** toggle *(Tier 1)* | No "gateway offline" banner; numbers change to reflect your machine |
| Flagship CUDA tabs, **Measured** *(Tier 2)* | Real occupancy/timing numbers from your GPU |

---

## 6. For instructors: a shared classroom gateway

Students don't need Docker (or even a powerful machine) if you run **one shared gateway** for the
class:

1. On a server (with or without a GPU), follow Tier 1 (and Tier 2 if it has an NVIDIA GPU) to get
   `infra/docker/compose.yml` running, exposing port `8000`.
2. On student machines (or in one shared deployment of `apps/web`), set:
   ```
   NEXT_PUBLIC_VHPCE_API=https://your-server:8000
   ```
   in `apps/web/.env.local`, then `pnpm --filter web dev` (or deploy the Next app and set the env
   var at deploy time).
3. Students get full Measured mode and a working Playground without installing Docker.

**Security note:** the runner sandboxes are locked down (`--network none`, `--cap-drop ALL`,
read-only filesystem, memory/PID/time limits — see `infra/docker/runner.Dockerfile` and
`services/api/README.md`), but a shared gateway is still an **untrusted-code-execution service**.
Put it behind authentication and/or a private network (campus VPN, etc.) for a real class — don't
expose `:8000` to the open internet unauthenticated.

---

## 7. Troubleshooting

- **`node`/`pnpm` not found after install** — close and reopen your terminal so `PATH` picks up
  the new install (Windows especially).
- **`pnpm install` fails with a permissions/registry error** — check your network/VPN/proxy; pnpm
  needs to reach `registry.npmjs.org`.
- **Docker commands need `sudo` / "permission denied" on Linux** — you weren't added to the
  `docker` group, or didn't log out/in after being added (§2.1).
- **`docker run --gpus all` fails ("could not select device driver")** — the NVIDIA Container
  Toolkit isn't installed/configured (§3 step 2-3); GPU experiments will simply stay in Model
  mode until this is fixed.
- **Port `3000` or `8000` already in use** — stop whatever else is using it, or run Next on
  another port: `pnpm --filter web exec next dev -p 3001` (and update
  `NEXT_PUBLIC_VHPCE_API`/your bookmark accordingly).
- **First CUDA build is slow / looks stuck** — the CUDA devel base image is ~5-7 GB; it's a
  one-time download.
- **`pnpm --filter web exec tsc --noEmit` complains about `.next/dev/types`** — delete that
  generated folder first (`rm -rf apps/web/.next/dev/types`); it can get out of sync if `tsc` runs
  while the dev server is also writing to it.
- **`/api/health` returns `"docker": false`** — Docker Desktop may still be starting up; wait a
  few seconds and retry. The Playground's Run button isn't hard-gated on this check.

---

## 8. Updating

```bash
git pull
pnpm install
# If infra/docker/* or services/* changed:
pnpm gateway:build:cpu   # and/or gateway:build:gpu
pnpm gateway:down && pnpm gateway:up
```
