FROM node:24 AS build
WORKDIR /app
ENV CI=true
COPY . .

RUN npm install -g pnpm@10
RUN pnpm install
RUN pnpm --filter control-plane build

FROM node:24 AS runtime
WORKDIR /app
COPY --from=build /app/control-plane/dist ./dist

CMD ["node", "dist/index.js"]
