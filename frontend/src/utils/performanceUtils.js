// Performance optimization utilities for smooth typing and scrolling

/**
 * Debounce function - delays function execution until after wait time has elapsed
 * since the last time the debounced function was invoked
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function - ensures function is called at most once in specified interval
 * using requestAnimationFrame for smooth performance
 */
export function throttle(func, limit) {
  let inThrottle;
  let lastArgs;
  let lastContext;

  return function() {
    const context = this;
    const args = arguments;

    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;

      requestAnimationFrame(() => {
        inThrottle = false;
        if (lastArgs) {
          func.apply(lastContext, lastArgs);
          lastArgs = null;
        }
      });
    } else {
      lastArgs = args;
      lastContext = context;
    }
  };
}

/**
 * Smooth scroll to position using requestAnimationFrame
 */
export function smoothScrollTo(element, targetTop, duration = 300) {
  const start = element.scrollTop;
  const change = targetTop - start;
  const startTime = performance.now();

  function animateScroll(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function for smooth animation
    const easeInOutQuad = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    element.scrollTop = start + change * easeInOutQuad;

    if (elapsed < duration) {
      requestAnimationFrame(animateScroll);
    }
  }

  requestAnimationFrame(animateScroll);
}

/**
 * Check if element is near viewport bottom (with threshold)
 */
export function isNearBottom(element, threshold = 100) {
  if (!element) return false;

  const { scrollTop, scrollHeight, clientHeight } = element;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * Optimized intersection observer wrapper
 */
export class OptimizedObserver {
  constructor(callback, options = {}) {
    this.callback = callback;
    this.options = {
      rootMargin: '0px',
      threshold: 0.1,
      ...options
    };
    this.observers = new Map();

    // Use requestAnimationFrame to batch observation callbacks
    this.pendingObservations = [];
    this.isProcessing = false;

    this.processObservations = this.processObservations.bind(this);
  }

  processObservations() {
    if (this.pendingObservations.length === 0) {
      this.isProcessing = false;
      return;
    }

    const batch = this.pendingObservations.slice();
    this.pendingObservations.length = 0;

    // Group observations by element for batch processing
    const groupedObservations = new Map();

    for (const observation of batch) {
      if (!groupedObservations.has(observation.target)) {
        groupedObservations.set(observation.target, []);
      }
      groupedObservations.get(observation.target).push(observation);
    }

    // Process grouped observations
    for (const [target, observations] of groupedObservations) {
      const entries = observations.map(obs => ({
        target,
        isIntersecting: obs.isIntersecting,
        intersectionRatio: obs.intersectionRatio,
        boundingClientRect: obs.boundingClientRect,
        intersectionRect: obs.intersectionRect,
        rootBounds: obs.rootBounds,
        time: obs.time
      }));

      this.callback(entries, this);
    }

    this.isProcessing = false;
  }

  observe(target, options = {}) {
    if (!this.observers.has(target)) {
      const observer = new IntersectionObserver((entries) => {
        this.pendingObservations.push(...entries.map(entry => ({
          ...entry,
          target
        })));

        if (!this.isProcessing) {
          this.isProcessing = true;
          requestAnimationFrame(this.processObservations);
        }
      }, { ...this.options, ...options });

      observer.observe(target);
      this.observers.set(target, observer);
    }
  }

  unobserve(target) {
    const observer = this.observers.get(target);
    if (observer) {
      observer.unobserve(target);
      this.observers.delete(target);
    }
  }

  disconnect() {
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }
    this.observers.clear();
  }
}

/**
 * Memory-safe scroll listener that cleans up automatically
 */
export function createScrollListener(element, callback, options = {}) {
  if (!element) return null;

  const {
    debounceTime = 16, // ~60fps
    throttleTime = 16,
    useDebounce = false
  } = options;

  const handler = useDebounce
    ? debounce(callback, debounceTime)
    : throttle(callback, throttleTime);

  element.addEventListener('scroll', handler, { passive: true });

  return {
    destroy: () => {
      element.removeEventListener('scroll', handler);
    },
    update: (newOptions) => {
      const updatedOptions = { ...options, ...newOptions };
      return createScrollListener(element, callback, updatedOptions);
    }
  };
}

/**
 * Virtual scroll utility for large lists
 */
export class VirtualScroll {
  constructor(options = {}) {
    this.itemHeight = options.itemHeight || 50;
    this.containerHeight = options.containerHeight || 400;
    this.items = options.items || [];
    this.renderItem = options.renderItem || (() => null);
    this.scrollElement = options.scrollElement;
    this.onScroll = options.onScroll;

    this.startIndex = 0;
    this.endIndex = Math.min(this.items.length - 1, this.getVisibleItemCount());
    this.buffer = options.buffer || 5;
  }

  getVisibleItemCount() {
    return Math.ceil(this.containerHeight / this.itemHeight);
  }

  updateViewport() {
    if (!this.scrollElement) return;

    const scrollTop = this.scrollElement.scrollTop;
    const startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
    const endIndex = Math.min(
      this.items.length - 1,
      startIndex + this.getVisibleItemCount() + this.buffer * 2
    );

    if (startIndex !== this.startIndex || endIndex !== this.endIndex) {
      this.startIndex = startIndex;
      this.endIndex = endIndex;
      this.onScroll?.({ startIndex, endIndex });
    }
  }

  setItems(items) {
    this.items = items;
    this.updateViewport();
  }

  destroy() {
    if (this.scrollElement) {
      this.scrollElement.removeEventListener('scroll', this.updateViewport);
    }
  }
}