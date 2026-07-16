FROM node:24 AS build
WORKDIR /app
ENV CI=true

COPY . .

RUN npm install -g pnpm@10
RUN pnpm install
RUN pnpm --filter @kestrel/orchestrator-dashboard-client build
RUN pnpm --filter @kestrel/orchestrator-dashboard-server build

FROM node:24 AS runtime
WORKDIR /app

COPY --from=build /app/orchestrator/dashboard/server/dist/server.cjs ./server.cjs
COPY --from=build /app/orchestrator/dashboard/server/public ./public

EXPOSE 8080
CMD ["node", "server.cjs"]
