FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_PATH=/data/moneywise-sync.sqlite

RUN mkdir -p /data/backups

EXPOSE 8787

CMD ["npm", "start"]
