export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface CircuitusDesktop {
  version: string;
  browser: {
    open(url: string): void;
    setBounds(b: { x: number; y: number; width: number; height: number }): void;
    show(): void;
    hide(): void;
    close(): void;
    back(): void;
    forward(): void;
    reload(): void;
    onState(cb: (s: BrowserState) => void): () => void;
  };
  onBossKey(cb: () => void): () => void;
}

declare global {
  interface Window {
    circuitusDesktop?: CircuitusDesktop;
  }
}
