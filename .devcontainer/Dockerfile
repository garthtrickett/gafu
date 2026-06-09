FROM mcr.microsoft.com/devcontainers/javascript-node:22

# 1. Install system dependencies under root
RUN apt-get update && apt-get install -y \
    libvips-dev \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Bun under the non-privileged node user
USER node
RUN curl -fsSL https://bun.sh/install | bash

# 3. Symlink Bun globally under root so it's universally accessible in the path
USER root
RUN ln -sf /home/node/.bun/bin/bun /usr/local/bin/bun

# 4. Pre-download and cache Playwright Chromium browser inside the image
USER node
RUN npx playwright install chromium
