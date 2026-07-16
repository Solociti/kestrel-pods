import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>Orchestrator Dashboard</h1>
      <p>Client shell is ready.</p>
    </main>
  );
}

const appRoot = document.getElementById("app");

if (!appRoot) {
  throw new Error("Missing #app root element");
}

createRoot(appRoot).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
