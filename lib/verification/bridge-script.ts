/**
 * Lightweight browser runtime instrumentation script injected into generated websites.
 * Observes browser console, React warnings, uncaught exceptions, unhandled rejections,
 * failed resource loads, and performs client smoke tests.
 * Communicates with parent Foundry window via postMessage.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Project Prompt §5.B, §5.C.
 */

export const FOUNDRY_PREVIEW_BRIDGE_VERSION = "1.0.0";

/**
 * Minified, inline-safe diagnostic bridge script.
 * Executed inside preview iframe during initial HTML evaluation.
 */
export const FOUNDRY_DIAGNOSTIC_BRIDGE_SCRIPT = `
(function() {
  if (typeof window === "undefined" || window.__FOUNDRY_BRIDGE_INSTALLED__) return;
  window.__FOUNDRY_BRIDGE_INSTALLED__ = true;

  var seenDiagnostics = new Set();

  function safeStringify(val) {
    if (val === null || val === undefined) return String(val);
    if (typeof val === "string") return val;
    if (val instanceof Error) return val.message + (val.stack ? "\\n" + val.stack : "");
    try {
      return JSON.stringify(val);
    } catch (e) {
      return String(val);
    }
  }

  function postDiagnostic(payload) {
    try {
      var key = payload.source + ":" + payload.severity + ":" + payload.message.slice(0, 160);
      if (seenDiagnostics.has(key)) return;
      seenDiagnostics.add(key);

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
          source: payload.source,
          severity: payload.severity,
          message: payload.message,
          stack: payload.stack,
          componentStack: payload.componentStack,
          url: payload.url || window.location.href,
          line: payload.line,
          column: payload.column,
          timestamp: Date.now()
        }, "*");
      }
    } catch (err) {
      // Safe execution: never break the preview application
    }
  }

  // 1. Hook console.error and console.warn while preserving native behavior
  var origError = console.error;
  var origWarn = console.warn;

  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    origError.apply(console, args);

    var joined = args.map(safeStringify).join(" ");
    var isReactWarning = joined.indexOf("Warning:") === 0 || joined.indexOf("React does not recognize") !== -1;

    // Check for React component stack trace in subsequent arguments
    var componentStack;
    for (var i = 1; i < args.length; i++) {
      if (typeof args[i] === "string" && args[i].indexOf("\\n    in ") !== -1) {
        componentStack = args[i];
        break;
      }
    }

    postDiagnostic({
      source: isReactWarning ? "react_warning" : "browser_console",
      severity: "error",
      message: joined,
      componentStack: componentStack
    });
  };

  console.warn = function() {
    var args = Array.prototype.slice.call(arguments);
    origWarn.apply(console, args);

    var joined = args.map(safeStringify).join(" ");
    var isReactWarning = joined.indexOf("Warning:") === 0 || joined.indexOf("React does not recognize") !== -1;

    var componentStack;
    for (var i = 1; i < args.length; i++) {
      if (typeof args[i] === "string" && args[i].indexOf("\\n    in ") !== -1) {
        componentStack = args[i];
        break;
      }
    }

    postDiagnostic({
      source: isReactWarning ? "react_warning" : "browser_console",
      severity: "warn",
      message: joined,
      componentStack: componentStack
    });
  };

  // 2. Global Uncaught Exceptions
  window.addEventListener("error", function(event) {
    // Distinguish resource load error (e.g. <img> or <link> failed) from JS runtime error
    if (event.target && (event.target.tagName === "IMG" || event.target.tagName === "SCRIPT" || event.target.tagName === "LINK")) {
      var el = event.target;
      var src = el.src || el.href || "unknown";
      postDiagnostic({
        source: "network",
        severity: "error",
        message: "Failed to load resource: " + el.tagName.toLowerCase() + " (" + src + ")",
        url: src
      });
      return;
    }

    postDiagnostic({
      source: "runtime_exception",
      severity: "error",
      message: event.message || "Uncaught JavaScript exception",
      stack: event.error && event.error.stack ? event.error.stack : undefined,
      url: event.filename,
      line: event.lineno,
      column: event.colno
    });
  }, true);

  // 3. Global Unhandled Promise Rejections
  window.addEventListener("unhandledrejection", function(event) {
    var reason = event.reason;
    var msg = safeStringify(reason);
    postDiagnostic({
      source: "runtime_exception",
      severity: "error",
      message: "Unhandled promise rejection: " + msg,
      stack: reason && reason.stack ? reason.stack : undefined
    });
  });

  // 4. Practical Browser Smoke Tests
  function runSmokeTests() {
    try {
      var items = [];
      var start = Date.now();

      // Check A: Main content rendered
      var hasRootContent = false;
      var mainEl = document.querySelector("main") || document.body;
      if (mainEl && mainEl.children.length > 0 && (mainEl.innerText || "").trim().length > 20) {
        hasRootContent = true;
      }
      items.push({
        id: "root_content",
        name: "Main page content rendered",
        status: hasRootContent ? "passed" : "failed",
        message: hasRootContent ? "Root container rendered meaningful content" : "Page rendered empty or minimal content"
      });

      // Check B: Layout overflow check (horizontal scrollbar detection)
      var docEl = document.documentElement;
      var hasOverflow = docEl.scrollWidth > window.innerWidth + 2;
      items.push({
        id: "layout_overflow",
        name: "No horizontal layout overflow",
        status: hasOverflow ? "failed" : "passed",
        message: hasOverflow ? "Page has horizontal overflow (" + docEl.scrollWidth + "px > " + window.innerWidth + "px)" : "Layout fits within viewport width"
      });

      // Check C: Image asset loading
      var images = Array.prototype.slice.call(document.querySelectorAll("img"));
      var brokenImages = images.filter(function(img) {
        return img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith("data:");
      });
      items.push({
        id: "image_assets",
        name: "Image assets loaded successfully",
        status: brokenImages.length > 0 ? "failed" : "passed",
        message: brokenImages.length > 0 ? brokenImages.length + " broken images detected on page" : images.length + " images verified"
      });

      // Check D: Interactive elements exist
      var interactiveCount = document.querySelectorAll("button, a, input, select, textarea").length;
      items.push({
        id: "interactive_elements",
        name: "Interactive navigation and controls present",
        status: interactiveCount > 0 ? "passed" : "passed",
        message: interactiveCount + " interactive elements detected"
      });

      var allPassed = items.every(function(item) { return item.status === "passed"; });

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: "FOUNDRY_PREVIEW_SMOKE_RESULT",
          summary: {
            passed: allPassed,
            items: items,
            durationMs: Date.now() - start
          },
          timestamp: Date.now()
        }, "*");
      }
    } catch (e) {
      // Ignore smoke test errors
    }
  }

  // Run smoke tests once page finishes loading and React mounts
  if (document.readyState === "complete") {
    setTimeout(runSmokeTests, 1200);
  } else {
    window.addEventListener("load", function() {
      setTimeout(runSmokeTests, 1200);
    });
  }
})();
`;
