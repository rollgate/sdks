package rollgate

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRequestDeduplicator_Dedupe(t *testing.T) {
	t.Run("should execute function and return result", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		callCount := 0

		result, err := dedup.Dedupe("key", func() (any, error) {
			callCount++
			return "result", nil
		})

		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
		if result != "result" {
			t.Errorf("expected 'result', got %v", result)
		}
		if callCount != 1 {
			t.Errorf("expected function called once, got %d", callCount)
		}
	})

	t.Run("should deduplicate concurrent requests", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		var callCount int32

		var wg sync.WaitGroup
		results := make([]any, 3)
		errors := make([]error, 3)

		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				results[idx], errors[idx] = dedup.Dedupe("key", func() (any, error) {
					atomic.AddInt32(&callCount, 1)
					time.Sleep(50 * time.Millisecond)
					return "result", nil
				})
			}(i)
		}

		wg.Wait()

		for i, err := range errors {
			if err != nil {
				t.Errorf("request %d got error: %v", i, err)
			}
		}

		for i, result := range results {
			if result != "result" {
				t.Errorf("request %d expected 'result', got %v", i, result)
			}
		}

		if callCount != 1 {
			t.Errorf("expected function called once, got %d", callCount)
		}
	})

	t.Run("should allow new requests after previous completes", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		callCount := 0

		_, _ = dedup.Dedupe("key", func() (any, error) {
			callCount++
			return "result1", nil
		})

		_, _ = dedup.Dedupe("key", func() (any, error) {
			callCount++
			return "result2", nil
		})

		if callCount != 2 {
			t.Errorf("expected function called twice, got %d", callCount)
		}
	})

	t.Run("should handle different keys independently", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		var callCount1, callCount2 int32

		var wg sync.WaitGroup
		wg.Add(2)

		go func() {
			defer wg.Done()
			_, _ = dedup.Dedupe("key1", func() (any, error) {
				atomic.AddInt32(&callCount1, 1)
				time.Sleep(10 * time.Millisecond)
				return "result1", nil
			})
		}()

		go func() {
			defer wg.Done()
			_, _ = dedup.Dedupe("key2", func() (any, error) {
				atomic.AddInt32(&callCount2, 1)
				time.Sleep(10 * time.Millisecond)
				return "result2", nil
			})
		}()

		wg.Wait()

		if callCount1 != 1 {
			t.Errorf("expected key1 called once, got %d", callCount1)
		}
		if callCount2 != 1 {
			t.Errorf("expected key2 called once, got %d", callCount2)
		}
	})

	t.Run("should propagate errors to all callers", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		expectedErr := errors.New("test error")
		var callCount int32

		var wg sync.WaitGroup
		errs := make([]error, 3)

		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				_, errs[idx] = dedup.Dedupe("key", func() (any, error) {
					atomic.AddInt32(&callCount, 1)
					time.Sleep(50 * time.Millisecond)
					return nil, expectedErr
				})
			}(i)
		}

		wg.Wait()

		for i, err := range errs {
			if err != expectedErr {
				t.Errorf("request %d expected error %v, got %v", i, expectedErr, err)
			}
		}

		if callCount != 1 {
			t.Errorf("expected function called once, got %d", callCount)
		}
	})
}

func TestRequestDeduplicator_IsInflight(t *testing.T) {
	t.Run("should return true while request is in-flight", func(t *testing.T) {
		dedup := NewRequestDeduplicator()
		started := make(chan struct{})
		done := make(chan struct{})

		go func() {
			_, _ = dedup.Dedupe("key", func() (any, error) {
				close(started)
				<-done
				return "result", nil
			})
		}()

		<-started

		if !dedup.IsInflight("key") {
			t.Error("expected IsInflight to be true")
		}

		close(done)
		time.Sleep(10 * time.Millisecond)

		if dedup.IsInflight("key") {
			t.Error("expected IsInflight to be false after completion")
		}
	})

	t.Run("should return false for unknown key", func(t *testing.T) {
		dedup := NewRequestDeduplicator()

		if dedup.IsInflight("unknown") {
			t.Error("expected IsInflight to be false for unknown key")
		}
	})
}

func TestRequestDeduplicator_Clear(t *testing.T) {
	dedup := NewRequestDeduplicator()
	started := make(chan struct{})

	go func() {
		_, _ = dedup.Dedupe("key", func() (any, error) {
			close(started)
			time.Sleep(100 * time.Millisecond)
			return "result", nil
		})
	}()

	<-started

	if !dedup.IsInflight("key") {
		t.Error("expected IsInflight to be true before clear")
	}

	dedup.Clear()

	if dedup.IsInflight("key") {
		t.Error("expected IsInflight to be false after clear")
	}
}
