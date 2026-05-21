FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
EXPOSE 5000
CMD ["node", "dist/index.mjs"]
