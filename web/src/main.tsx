import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadDeployment } from "./deployment-runtime";
import "./style.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="page">
        <h1>Let’s try that again.</h1>
        <p>The game could not load. Refresh the page to reconnect.</p>
        <button onClick={() => location.reload()}>Reload HamsterRun</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
async function start() {
  await loadDeployment();
  const [{ walletConfig }, { default: App }] = await Promise.all([
    import("./chain"),
    import("./App"),
  ]);
  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <WagmiProvider config={walletConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>,
  );
}
start().catch(() => {
  createRoot(document.getElementById("root")!).render(
    <main className="page startup-error">
      <h1>HamsterRun</h1>
      <p>Sepolia configuration could not load. Reload to retry.</p>
      <button className="button" onClick={() => location.reload()}>
        Reload game
      </button>
    </main>,
  );
});
