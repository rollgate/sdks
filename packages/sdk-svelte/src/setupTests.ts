import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock EventSource for SSE tests
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(_type: string, _handler: EventListener) {
    // Store handlers for testing
  }

  close() {
    // Clean up
  }
}

(global as any).EventSource = MockEventSource;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock performance.now
if (typeof performance === 'undefined') {
  (global as any).performance = {
    now: vi.fn(() => Date.now()),
  };
}
