---
title: "Self-hosting SearXNG: Your Own Private Search Engine"
date: "2026-06-11 11:50:00"
categories:
  - Self-Hosting
tags:
  - SearXNG
  - Docker
  - Tailscale
  - Privacy
thumbnail: "https://docs.searxng.org/_static/searxng-wordmark.svg"
---

Every time you search Google, your query is logged, profiled, and tied to your identity across devices. Over time this builds a detailed picture of your interests, health concerns, political leanings, and more — all stored on someone else's servers.

[SearXNG](https://github.com/searxng/searxng) is a free, open-source **metasearch engine** that solves this differently. Instead of running its own search index, it forwards your query to multiple search engines (Google, Bing, DuckDuckGo, Wikipedia, and many others), strips out the tracking, and returns the combined results to you. The upstream search engines only see a request from your server — not from you.

By self-hosting SearXNG you get:

- **Privacy** — no search profiling, no filter bubble, no ads
- **Control** — you pick which engines to use, how results are ranked, and who can access the instance
- **Quality** — results aggregated from multiple engines often beat any single source
- **No vendor lock-in** — your search engine can't be shut down, enshittified, or acquired

This post walks through setting up SearXNG with Docker, verifying it works locally, then exposing it securely over [Tailscale](https://tailscale.com/) so you can reach it from any device. (Adapted from [Replace Google with SearXNG - a privacy respecting, self-hosted search engine](https://www.youtube.com/watch?v=cg9d87PuanE))

---

## Prerequisites: Docker on Linux

First, install Docker on your Linux machine:

```bash
curl -fsSL https://get.docker.com | sh
```

After installation, add your user to the Docker group so you don't need `sudo` every time:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

You can find the full post-installation steps in the [official Docker docs](https://docs.docker.com/engine/install/linux-postinstall/).

---

## Install Tailscale

To reach your SearXNG instance from anywhere (not just your local network), install [Tailscale](https://tailscale.com/) and connect the machine to your tailnet:

```bash
sudo tailscale up --ssh
```

We'll use `tailscale serve` later to expose SearXNG over HTTPS — but first, let's get SearXNG running.

---

## Setting Up SearXNG with Docker

Follow the [official SearXNG Docker installation guide](https://docs.searxng.org/admin/installation-docker.html#installation-container).

### 1. Create the environment

```bash
mkdir -p ./searxng/core-config/
cd ./searxng/

curl -fsSL \
    -O https://raw.githubusercontent.com/searxng/searxng/master/container/docker-compose.yml \
    -O https://raw.githubusercontent.com/searxng/searxng/master/container/.env.example
```

### 2. Configure the environment

Copy and edit the `.env` file:

```bash
cp -i .env.example .env
nano .env
```

At minimum, set a secret key for cookie signing. Generate one with:

```bash
openssl rand -hex 32
```

Then paste the output into `.env`:

```
SEARXNG_SECRET="<paste the hex string here>"
```

### 3. Start the services

```bash
docker compose up -d
```

### 4. Verify it works locally

Before going further, check that SearXNG is actually running. Open a browser and visit your server's Tailscale domain over plain HTTP on port 8080:

```
http://my-server.tailabcd1234.ts.net:8080
```

You should see the SearXNG search page. Try a search to confirm results are coming back.

If something's wrong, check the container logs:

```bash
docker compose logs -f
```

Common issues:

- **Port conflict** — if port 8080 is already in use, edit `docker-compose.yml` to change the port mapping (e.g. `8081:8080`)
- **Container not starting** — run `docker compose ps` to see the container status, and `docker compose logs` for error messages
- **No results** — some engines may be temporarily blocked; check `core-config/settings.yml` to enable/disable specific engines

To stop the services:

```bash
docker compose down
```

---

## Expose SearXNG over Tailscale

Once SearXNG works locally, you can expose it to your tailnet over HTTPS. No need to open any public ports — Tailscale handles TLS and access control.

```bash
sudo tailscale serve --bg 8080
```

This creates an HTTPS endpoint like:

```
https://my-server.tailabcd1234.ts.net
```

Where:

- `my-server` — your machine's Tailscale **machine name** (set during `tailscale up`, or changed later in the [Tailscale admin console](https://login.tailscale.com/admin/machines))
- `tailabcd1234.ts.net` — your **tailnet's MagicDNS domain** (unique to your account)

You can rename both the machine name and the tailnet domain from the Tailscale admin console at any time.

Now set your `SEARXNG_BASE_URL` in `.env` to match:

```
SEARXNG_BASE_URL="https://my-server.tailabcd1234.ts.net"
```

Then restart SearXNG for the change to take effect:

```bash
docker compose down && docker compose up -d
```

Visit the `https://` URL from any device on your tailnet to confirm it works.

---

## Customize SearXNG Settings

Edit `core-config/settings.yml` to tailor SearXNG to your needs. The [official settings documentation](https://docs.searxng.org/admin/settings/index.html) covers everything in detail, but here are some options worth knowing about:

- **`engines`** — enable, disable, or reorder search engines (Google, Bing, DuckDuckGo, Wikipedia, etc.)
- **`server.limiter`** — rate limiting to protect your instance from abuse; useful if you share the instance with others
- **`server.image_proxy`** — proxy image results through your server so upstream CDNs don't see your IP
- **`ui.theme`** — pick a theme (`simple`, `ocavue`, etc.)
- **`search.default_lang`** — set a default language for results

After editing, restart:

```bash
docker compose restart
```

---

## Set SearXNG as Your Default Search Engine in Chrome

Once your instance is running, you can configure Chrome to use it as the default search engine. Follow [this guide](https://blog.ktz.me/replacing-google-with-searxng-as-the-default-in-chrome/) for step-by-step instructions.

---

## Recap

| Step               | What it does                               |
| ------------------ | ------------------------------------------ |
| Install Docker     | Container runtime for SearXNG              |
| Install Tailscale  | Secure networking — no public ports needed |
| Deploy SearXNG     | Private metasearch via Docker Compose      |
| Verify locally     | Confirm everything works before exposing   |
| Tailscale serve    | HTTPS endpoint on your tailnet             |
| Customize settings | Engines, rate limiting, theme, language    |
| Configure browser  | Use SearXNG as your default search engine  |

That's it — you now have a fully private search engine under your control. No more sending every query to Google.

## Going Further

- **[SearXNG on GitHub](https://github.com/searxng/searxng)** — source code, issues, and contributions
- **[Local Deep Research](https://github.com/LearningCircuit/local-deep-research)** — an open-source research tool that uses SearXNG under the hood to retrieve and synthesize information from the web
