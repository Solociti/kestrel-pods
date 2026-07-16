# Orchestrator Dashboard

This directory contains the dashboard UI and its backend server.

- `client/` is the Vite frontend.
- `server/` is the Node backend-for-frontend.
- `test/` is reserved for integration or end-to-end tests.

The server is bundled into a single output file to keep runtime images small and avoid service-local `node_modules`.
