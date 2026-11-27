FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    FFMPEG_PATH=/usr/bin/ffmpeg

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
COPY src ./src
COPY scripts ./scripts
COPY web ./web
RUN npm run check && npm run doctor
CMD ["node", "index.js"]
