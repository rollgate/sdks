import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { RollgateProvider, useFlag, useFlags, useRollgate, Feature } from './index';

// Mock fetch
const mockFetch = global.fetch as jest.Mock;

// Helper to create mock response with headers (needed for ETag support)
const createMockResponse = (
  data: unknown,
  options: { ok?: boolean; status?: number; etag?: string } = {}
) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => data,
  headers: {
    get: (name: string) => {
      if (name === 'ETag' && options.etag) return options.etag;
      return null;
    },
  },
});

beforeEach(() => {
  mockFetch.mockClear();
});

describe('RollgateProvider', () => {
  it('should render children', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <div data-testid="child">Hello</div>
      </RollgateProvider>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('should fetch flags on mount', async () => {
    mockFetch.mockResolvedValue(createMockResponse({ flags: { 'test-flag': true } }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <div>Test</div>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should include user_id when user provided', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: {} }));

    render(
      <RollgateProvider
        config={{ apiKey: 'test-key', enableStreaming: false }}
        user={{ id: 'user-123' }}
      >
        <div>Test</div>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user_id=user-123'),
        expect.any(Object)
      );
    });
  });
});

describe('useFlag', () => {
  it('should return flag value', async () => {
    mockFetch.mockResolvedValue(createMockResponse({ flags: { 'my-feature': true } }));

    function TestComponent() {
      const isEnabled = useFlag('my-feature');
      return <div data-testid="result">{isEnabled ? 'enabled' : 'disabled'}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('enabled');
    });
  });

  it('should return default value for unknown flags', async () => {
    mockFetch.mockResolvedValue(createMockResponse({ flags: {} }));

    function TestComponent() {
      const withDefault = useFlag('unknown', true);
      const withoutDefault = useFlag('unknown');
      return (
        <div>
          <span data-testid="with-default">{withDefault ? 'yes' : 'no'}</span>
          <span data-testid="without-default">{withoutDefault ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('with-default')).toHaveTextContent('yes');
      expect(screen.getByTestId('without-default')).toHaveTextContent('no');
    });
  });

  it('should throw when used outside provider', () => {
    function TestComponent() {
      useFlag('test');
      return null;
    }

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() => render(<TestComponent />)).toThrow(
      'useFlag must be used within a RollgateProvider'
    );

    errorSpy.mockRestore();
  });
});

describe('useFlags', () => {
  it('should return multiple flag values', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse({
        flags: {
          'flag-a': true,
          'flag-b': false,
          'flag-c': true,
        },
      })
    );

    function TestComponent() {
      const flags = useFlags(['flag-a', 'flag-b', 'flag-c']);
      return <div data-testid="result">{JSON.stringify(flags)}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    await waitFor(() => {
      const result = JSON.parse(screen.getByTestId('result').textContent || '{}');
      expect(result['flag-a']).toBe(true);
      expect(result['flag-b']).toBe(false);
      expect(result['flag-c']).toBe(true);
    });
  });
});

describe('useRollgate', () => {
  it('should provide loading state', async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(createMockResponse({ flags: {} })), 100))
    );

    function TestComponent() {
      const { isLoading } = useRollgate();
      return <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');

    await waitFor(
      () => {
        expect(screen.getByTestId('loading')).toHaveTextContent('ready');
      },
      { timeout: 200 }
    );
  });

  it('should provide error state on failure', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    function TestComponent() {
      const { isError } = useRollgate();
      return <div data-testid="error">{isError ? 'error' : 'ok'}</div>;
    }

    render(
      <RollgateProvider config={{ apiKey: 'invalid-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('error');
    });

    errorSpy.mockRestore();
  });

  it('should provide refresh function', async () => {
    mockFetch
      .mockResolvedValueOnce(createMockResponse({ flags: { flag: false } }))
      .mockResolvedValueOnce(createMockResponse({ flags: { flag: true } }));

    function TestComponent() {
      const { isEnabled, refresh } = useRollgate();
      return (
        <div>
          <span data-testid="value">{isEnabled('flag') ? 'on' : 'off'}</span>
          <button onClick={() => refresh()}>Refresh</button>
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <TestComponent />
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('off');
    });

    await act(async () => {
      screen.getByText('Refresh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('on');
    });
  });
});

describe('Feature', () => {
  it('should render children when flag is enabled', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: { 'show-feature': true } }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <Feature flag="show-feature">
          <div data-testid="feature">Feature Content</div>
        </Feature>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('feature')).toBeInTheDocument();
    });
  });

  it('should not render children when flag is disabled', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: { 'show-feature': false } }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <Feature flag="show-feature">
          <div data-testid="feature">Feature Content</div>
        </Feature>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
    });
  });

  it('should render fallback when flag is disabled', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: { 'new-feature': false } }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <Feature flag="new-feature" fallback={<div data-testid="fallback">Old Feature</div>}>
          <div data-testid="new">New Feature</div>
        </Feature>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('new')).not.toBeInTheDocument();
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });

  it('should render new content when flag is enabled', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ flags: { 'new-feature': true } }));

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: false }}>
        <Feature flag="new-feature" fallback={<div data-testid="fallback">Old Feature</div>}>
          <div data-testid="new">New Feature</div>
        </Feature>
      </RollgateProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('new')).toBeInTheDocument();
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
    });
  });
});

describe('SSE streaming integration', () => {
  let mockEventSource: jest.Mock;
  let eventListeners: Map<string, ((event: MessageEvent) => void)[]>;
  let mockEventSourceInstance: {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
    close: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };

  beforeEach(() => {
    eventListeners = new Map();

    mockEventSourceInstance = {
      onmessage: null,
      onerror: null,
      close: jest.fn(),
      addEventListener: jest.fn((type: string, handler: (event: MessageEvent) => void) => {
        const handlers = eventListeners.get(type) || [];
        handlers.push(handler);
        eventListeners.set(type, handlers);
      }),
      removeEventListener: jest.fn(),
    };

    mockEventSource = jest.fn().mockImplementation(() => mockEventSourceInstance);
    (global as any).EventSource = mockEventSource;
  });

  afterEach(() => {
    delete (global as any).EventSource;
  });

  const triggerEvent = (type: string, data: any) => {
    const handlers = eventListeners.get(type) || [];
    handlers.forEach((handler) => handler({ data: JSON.stringify(data) } as MessageEvent));
  };

  it('should start streaming when enableStreaming is true', async () => {
    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: true }}>
        <div data-testid="child">Content</div>
      </RollgateProvider>
    );

    expect(mockEventSource).toHaveBeenCalledWith(expect.stringContaining('/api/v1/sdk/stream'));
  });

  it('should update flags when SSE init event received', async () => {
    function TestComponent() {
      const { isLoading } = useRollgate();
      const isEnabled = useFlag('dynamic-flag');
      return (
        <div>
          <span data-testid="loading">{isLoading ? 'loading' : 'ready'}</span>
          <span data-testid="flag-value">{isEnabled ? 'enabled' : 'disabled'}</span>
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: true }}>
        <TestComponent />
      </RollgateProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('flag-value')).toHaveTextContent('disabled');

    await act(async () => {
      triggerEvent('init', { flags: { 'dynamic-flag': true } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
      expect(screen.getByTestId('flag-value')).toHaveTextContent('enabled');
    });
  });

  it('should update single flag when SSE flag-update event received', async () => {
    function TestComponent() {
      const isEnabled = useFlag('single-flag');
      const otherFlag = useFlag('other-flag');
      return (
        <div>
          <span data-testid="single-flag">{isEnabled ? 'enabled' : 'disabled'}</span>
          <span data-testid="other-flag">{otherFlag ? 'enabled' : 'disabled'}</span>
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: true }}>
        <TestComponent />
      </RollgateProvider>
    );

    await act(async () => {
      triggerEvent('init', { flags: { 'single-flag': false, 'other-flag': true } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('single-flag')).toHaveTextContent('disabled');
      expect(screen.getByTestId('other-flag')).toHaveTextContent('enabled');
    });

    await act(async () => {
      triggerEvent('flag-update', { key: 'single-flag', enabled: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('single-flag')).toHaveTextContent('enabled');
      expect(screen.getByTestId('other-flag')).toHaveTextContent('enabled');
    });
  });

  it('should handle SSE errors gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    function TestComponent() {
      const { isError } = useRollgate();
      const isEnabled = useFlag('error-flag');
      return (
        <div>
          <span data-testid="error">{isError ? 'error' : 'ok'}</span>
          <span data-testid="flag">{isEnabled ? 'on' : 'off'}</span>
        </div>
      );
    }

    render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: true }}>
        <TestComponent />
      </RollgateProvider>
    );

    await act(async () => {
      triggerEvent('init', { flags: { 'error-flag': true } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('flag')).toHaveTextContent('on');
      expect(screen.getByTestId('error')).toHaveTextContent('ok');
    });

    await act(async () => {
      if (mockEventSourceInstance.onerror) {
        mockEventSourceInstance.onerror();
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('error');
    });

    expect(screen.getByTestId('flag')).toHaveTextContent('on');

    warnSpy.mockRestore();
  });

  it('should clean up EventSource on unmount', async () => {
    const { unmount } = render(
      <RollgateProvider config={{ apiKey: 'test-key', enableStreaming: true }}>
        <div>Content</div>
      </RollgateProvider>
    );

    expect(mockEventSource).toHaveBeenCalled();

    unmount();

    expect(mockEventSourceInstance.close).toHaveBeenCalled();
  });
});
