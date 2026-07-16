FROM node:24 AS build
WORKDIR /app
COPY . .

RUN corepack enable
RUN pnpm install
RUN pnpm --filter @kestrel/vm-provision build

FROM node:24 AS runtime
WORKDIR /app
COPY --from=build /app/orchestrator/vm-provision/dist ./dist

CMD ["node", "dist/index.js"]
