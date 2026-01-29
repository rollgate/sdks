import "@testing-library/jest-dom";

// Mock fetch globally
global.fetch = jest.fn();

// Mock EventSource for SSE tests
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, handler: EventListener) {
    // Store handlers for testing
  }

  close() {
    // Clean up
  }
}

(global as any).EventSource = MockEventSource;
