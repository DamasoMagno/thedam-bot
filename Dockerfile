FROM node:22.23.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/ytdlp && /opt/ytdlp/bin/pip install --no-cache-dir 'yt-dlp[default]'
ENV PATH="/opt/ytdlp/bin:$PATH" HOST=0.0.0.0 NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["npm", "run", "start:container"]
