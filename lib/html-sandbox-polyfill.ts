/** Runs inside an opaque-origin preview, before the document's own scripts. */
export const SANDBOX_STORAGE_POLYFILL_SCRIPT = `<script data-pi-web-polyfill="storage">
(function() {
  function createMemoryStorage() {
    var store = Object.create(null);
    function hasKey(key) { return Object.prototype.hasOwnProperty.call(store, key); }
    var storage = Object.create({
      getItem: function(key) {
        if (arguments.length < 1) throw new TypeError("getItem requires a key");
        key = String(key);
        return hasKey(key) ? store[key] : null;
      },
      setItem: function(key, value) {
        if (arguments.length < 2) throw new TypeError("setItem requires a key and value");
        store[String(key)] = String(value);
      },
      removeItem: function(key) {
        if (arguments.length < 1) throw new TypeError("removeItem requires a key");
        delete store[String(key)];
      },
      clear: function() { store = Object.create(null); },
      key: function(index) {
        if (arguments.length < 1) throw new TypeError("key requires an index");
        var key = Object.keys(store)[(+index) >>> 0];
        return key === undefined ? null : key;
      },
      get length() { return Object.keys(store).length; }
    });
    // Storage also exposes its keys as named properties, apart from the API's
    // own names (which remain callable even if a key has the same name).
    return new Proxy(storage, {
      get: function(target, key, receiver) {
        if (typeof key === "string" && !(key in target)) return store[key];
        return Reflect.get(target, key, receiver);
      },
      set: function(target, key, value, receiver) {
        if (typeof key !== "string") return Reflect.set(target, key, value, receiver);
        target.setItem(key, value);
        return true;
      },
      deleteProperty: function(target, key) {
        if (typeof key !== "string") return Reflect.deleteProperty(target, key);
        target.removeItem(key);
        return true;
      },
      has: function(target, key) {
        return key in target || (typeof key === "string" && hasKey(key));
      },
      ownKeys: function(target) {
        var own = Reflect.ownKeys(target);
        return own.concat(Object.keys(store).filter(function(key) { return own.indexOf(key) === -1; }));
      },
      getOwnPropertyDescriptor: function(target, key) {
        var own = Reflect.getOwnPropertyDescriptor(target, key);
        if (own || typeof key !== "string" || !hasKey(key)) return own;
        return { value: store[key], writable: true, enumerable: true, configurable: true };
      }
    });
  }

  function polyfillStorage(type) {
    try {
      window[type].getItem("__pi_web_storage_probe__");
    } catch (error) {
      if (error && error.name === "SecurityError") {
        Object.defineProperty(window, type, {
          value: createMemoryStorage(), configurable: true, enumerable: true
        });
      }
    }
  }
  polyfillStorage("localStorage");
  polyfillStorage("sessionStorage");
})();
</script>`;

// Matched one at a time: nested in one pattern, the lazy comments retry every
// split when no head follows, and a few dozen of them freeze the page.
const PROLOGUE = /\uFEFF?(?:\s|<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\?[^>]*>)*/iy;
const HTML_TAG = /<html(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>(?:\s|<!--[\s\S]*?-->)*/iy;
const HEAD_TAG = /<head(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/iy;

function matchEnd(pattern: RegExp, html: string, from: number): number {
  pattern.lastIndex = from;
  return pattern.exec(html) ? pattern.lastIndex : from;
}

/** Add the shim to preview HTML only, without changing the file on disk. */
export function injectSandboxedHtmlPolyfill(html: string): string {
  if (!html || html.includes(SANDBOX_STORAGE_POLYFILL_SCRIPT)) return html;
  // Only match a head in the document prologue: a later match could be inside
  // a comment or script, or after a script that already needs storage.
  const prologue = matchEnd(PROLOGUE, html, 0);
  const afterHtml = matchEnd(HTML_TAG, html, prologue);
  const afterHead = matchEnd(HEAD_TAG, html, afterHtml);
  // Without an explicit head, the browser creates one for this script. Keep
  // the doctype ahead of it so standards-mode documents stay in standards mode.
  const pos = afterHead > afterHtml ? afterHead : prologue;
  return html.slice(0, pos) + SANDBOX_STORAGE_POLYFILL_SCRIPT + html.slice(pos);
}
