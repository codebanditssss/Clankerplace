# pods-ml/sandbox-ubuntu:1.0 — full Ubuntu sandbox image for FuelBorn.
#
# Built directly on the Wings host (no registry round-trip). Pelican Wings
# spawns server containers from this image as the `container` user (UID 998)
# with a READ-ONLY root filesystem + no_new_privileges + 11 dropped caps, so
# packages CANNOT be apt-installed at runtime: sudo can't escalate (setuid is
# neutered) AND `/usr`/`/var` are read-only. Anything needed at the system
# level (shared libs, browsers, CLIs) must be baked in HERE at build time.
# For everything else, agents self-serve at runtime WITHOUT root via the
# userspace package managers baked below (micromamba/uv/pip/npm), installing
# into the writable, persistent /home/container volume.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Etc/UTC \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONIOENCODING=utf-8

# Core OS + dev tools. Kept in one layer + cache cleaned for image size.
RUN apt-get update && apt-get install -y --no-install-recommends \
      sudo bash ca-certificates curl wget gnupg lsb-release software-properties-common \
      git build-essential pkg-config \
      python3 python3-venv python3-pip python3-dev \
      tmux screen vim nano less \
      htop tree jq ripgrep fd-find \
      iputils-ping iproute2 net-tools dnsutils netcat-openbsd \
      tini procps locales \
      openssh-client openssh-server unzip xz-utils zstd bzip2 \
      file ncdu psmisc \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# Add NodeSource for current Node 20 LTS.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm config set fund false \
    && npm i -g pnpm

# Headless-browser runtime libraries. Agent browser tools (Hermes' browser
# skill / Playwright / Puppeteer) download the Chromium *binary* at runtime
# into the writable ~/.cache (on the /home/container volume), but Chromium's
# shared libraries (libnss3, libgbm1, libatk*, …) live under /usr — read-only
# at runtime and un-installable inside a running pod (read-only rootfs +
# no_new_privileges). So bake the deps at build time, where the rootfs is
# still writable. `playwright install-deps` resolves the exact, version-correct
# Ubuntu 24.04 package names (the t64 ABI transition renamed many of them).
RUN apt-get update \
    && npx --yes playwright@latest install-deps chromium \
    && apt-get install -y --no-install-recommends \
         fonts-liberation fonts-noto-color-emoji fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

# Common runtime libraries for agent + connector workloads. These are /usr
# system libs that CANNOT be apt-installed inside a running pod (read-only
# rootfs + no_new_privileges), so bake the high-frequency ones at build time.
# The long tail of less-common deps is handled by micromamba/uv into $HOME.
#   - ffmpeg + libopus0 + libsndfile1 : audio/video, Discord/voice connectors,
#       TTS-into-voice, whisper/soundfile/librosa
#   - libgl1 + libglib2.0-0t64        : OpenCV / Pillow / headless image+CV
#   - poppler-utils + tesseract-ocr   : PDF text/image extraction + OCR
#   - libxml2 + libxslt1.1            : lxml (web scraping / XML)
#   - libmagic1t64                    : file-type detection (python-magic)
#   - libpq5                          : Postgres client (psycopg2)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ffmpeg libopus0 libsndfile1 \
         libgl1 libglib2.0-0t64 \
         poppler-utils tesseract-ocr tesseract-ocr-eng \
         libxml2 libxslt1.1 libmagic1t64 libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Pre-bake the common MCP server packages so `npx -y <pkg>` (how Hermes
# launches MCP servers — see frontend/src/lib/mcp-catalog.ts) resolves them
# instantly and offline instead of downloading on first use. Installed globally
# into /usr/local/lib/node_modules (on the gateway PATH). Per-package tolerance:
# a deprecated/removed package never breaks the build — that MCP just falls back
# to an on-demand npx download at runtime. Chromium for the playwright/puppeteer
# MCPs still downloads once at runtime (its system libs are baked above).
RUN set -eux; \
    for p in \
      @modelcontextprotocol/server-filesystem \
      @modelcontextprotocol/server-memory \
      @modelcontextprotocol/server-sequential-thinking \
      @modelcontextprotocol/server-everything \
      @modelcontextprotocol/server-github \
      @modelcontextprotocol/server-brave-search \
      @modelcontextprotocol/server-postgres \
      @modelcontextprotocol/server-sqlite \
      @modelcontextprotocol/server-slack \
      @modelcontextprotocol/server-puppeteer \
      @playwright/mcp \
      @notionhq/notion-mcp-server \
      exa-mcp-server \
      tavily-mcp \
      mcp-linear \
    ; do npm i -g "$p" || echo "[mcp-bake] skipped $p (not on npm / deprecated)"; done; \
    npm cache clean --force

# Userspace package managers — the durable answer to "agents will always need
# new things." The pod is hardened (read-only rootfs, no sudo), so `apt` is
# out; these let an agent install almost anything WITHOUT root, into the
# persistent /home/container volume:
#   - micromamba (conda-forge): installs *compiled* packages that bundle their
#     own shared libs (ffmpeg, opencv, postgres, ML/CV/audio libs, even
#     browsers) — i.e. the cases that would otherwise need libs in /usr.
#   - uv: fast Python package/venv/interpreter manager.
# Both are single static binaries in /usr/local/bin (read-only, shared by all
# pods); everything they create lives under the user's $HOME and persists.
ENV MAMBA_ROOT_PREFIX=/home/container/.micromamba \
    MAMBA_EXE=/usr/local/bin/micromamba
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "$ARCH" in \
      amd64) MARCH=linux-64 ;; \
      arm64) MARCH=linux-aarch64 ;; \
      *) MARCH=linux-64 ;; \
    esac; \
    curl -Ls "https://micro.mamba.pm/api/micromamba/${MARCH}/latest" \
      | tar -xj -C /usr/local bin/micromamba; \
    chmod 0755 /usr/local/bin/micromamba; \
    curl -LsSf https://astral.sh/uv/install.sh \
      | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh; \
    /usr/local/bin/micromamba --version; \
    /usr/local/bin/uv --version

# Ubuntu 24.04 ships with a default `ubuntu` user at UID 1000. Remove it
# (and any preexisting account at our target UID) so our `container` user
# matches Pelican Wings's expected UID/GID with passwordless sudo.
RUN userdel -r ubuntu 2>/dev/null || true \
 && (getent passwd 998 && userdel "$(getent passwd 998 | cut -d: -f1)" || true) \
 && (getent group 998 && groupdel "$(getent group 998 | cut -d: -f1)" || true) \
 && groupadd -g 998 container \
 && useradd -u 998 -g 998 -G sudo -m -d /home/container -s /bin/bash container \
 && echo 'container ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/container \
 && chmod 0440 /etc/sudoers.d/container

# A friendly MOTD on every interactive shell. Uses `%b` so the \e[..m
# sequences are interpreted into real ESC bytes when /etc/motd is written.
RUN printf '%b\n' \
      '' \
      '  \033[36m┌──────────────────────────────────────────────────────────┐\033[0m' \
      '  \033[36m│\033[0m  Welcome to your FuelBorn sandbox.                        \033[36m│\033[0m' \
      '  \033[36m│\033[0m                                                          \033[36m│\033[0m' \
      '  \033[36m│\033[0m  This is a private, hardened Ubuntu 24.04 container.     \033[36m│\033[0m' \
      '  \033[36m│\033[0m  Persistence: /home/container. Install in userspace      \033[36m│\033[0m' \
      '  \033[36m│\033[0m  (pip --user, pnpm, ~/.local/bin) — system FS is locked. \033[36m│\033[0m' \
      '  \033[36m│\033[0m                                                          \033[36m│\033[0m' \
      '  \033[36m│\033[0m  Run `hermes` to start the agent, or `hermes setup` to   \033[36m│\033[0m' \
      '  \033[36m│\033[0m  reconfigure providers / messaging.                      \033[36m│\033[0m' \
      '  \033[36m└──────────────────────────────────────────────────────────┘\033[0m' \
      '' > /etc/motd \
 && echo 'if [ -t 1 ] && [ -f /etc/motd ] && [ -z "$PODS_ML_MOTD_SHOWN" ]; then cat /etc/motd; export PODS_ML_MOTD_SHOWN=1; fi' \
      >> /etc/bash.bashrc

# Reasonable bash defaults for the user.
#
# The `hermes` shell function intercepts `hermes gateway {start,stop,restart,
# status,enable,disable,logs}` and routes it to `pod-gateway` — our non-
# blocking supervisor wrapper. Without this, `hermes gateway restart` blocks
# the user's shell (the real hermes CLI starts the gateway in the foreground
# of the calling process), which made the in-pod UX feel un-Linux-ish.
# `hermes gateway run` and every other subcommand fall through to the real
# binary in $HOME/.local/bin/hermes via `command hermes …`.
RUN printf '%s\n' \
      'export PATH="$HOME/.local/bin:$HOME/.micromamba/bin:$HOME/hermes-agent/venv/bin:$PATH"' \
      'export HERMES_HOME="$HOME/.hermes"' \
      'export EDITOR=vim' \
      'export HISTSIZE=10000' \
      'export HISTFILESIZE=20000' \
      'export HISTCONTROL=ignoreboth' \
      'shopt -s histappend checkwinsize' \
      '# Append every command to ~/.bash_history immediately so it' \
      '# survives even ungraceful shell deaths (closing the browser tab' \
      '# kills the docker exec session — without `history -a` only the' \
      '# in-memory ring of the dying shell knew about new commands).' \
      'PROMPT_COMMAND="history -a;${PROMPT_COMMAND:-}"' \
      'alias ll="ls -lah"' \
      'alias gs="git status"' \
      'PS1="\[\033[36m\]pods\[\033[0m\]:\[\e[33m\]\w\[\033[0m\]\$ "' \
      'hermes() {' \
      '  if [ "$1" = "gateway" ] && [ "$#" -ge 2 ]; then' \
      '    case "$2" in' \
      '      start|stop|restart|status|enable|disable|logs)' \
      '        command pod-gateway "$2"' \
      '        return $?' \
      '        ;;' \
      '    esac' \
      '  fi' \
      '  command hermes "$@"' \
      '}' \
      'export -f hermes 2>/dev/null || true' \
      > /etc/profile.d/pods-ml.sh

# Pod supervisor + user-facing helper. Both are root-installed so any user
# can run them. The init script does NOT need root at runtime — Wings runs
# this container as the `container` user.
COPY pods-ml-pod-init.sh /usr/local/bin/pods-ml-pod-init.sh
COPY pod-gateway          /usr/local/bin/pod-gateway
RUN chmod 0755 /usr/local/bin/pods-ml-pod-init.sh /usr/local/bin/pod-gateway

USER container
WORKDIR /home/container

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/usr/local/bin/pods-ml-pod-init.sh"]
