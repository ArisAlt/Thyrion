// Resources belong to a scenario from the moment they are acquired, including
// when setup fails before it can return a state object.
export function cleanupScope() {
  const callbacks = [];
  let closed = false;
  return {
    get closed() { return closed; },
    defer(fn) {
      if (closed) throw new Error('the scenario has already ended');
      callbacks.push(fn);
    },
    async close() {
      if (closed) return;
      closed = true;
      const errors = [];
      for (const fn of callbacks.reverse()) {
        try { await fn(); } catch (e) { errors.push(e); }
      }
      if (errors.length) throw new AggregateError(errors, 'scenario cleanup failed');
    },
  };
}

export function selectTests(tests, file, only) {
  const wanted = (name) => !only || name.toLowerCase().includes(only) || file.toLowerCase().includes(only);
  const last = tests.findLastIndex(([name]) => wanted(name));
  return tests.slice(0, last + 1).map(([name, fn, opts]) => [name, fn, opts, wanted(name)]);
}

// These are dependent steps, not independent tests. Never continue after a
// failure: even an assertion failure can leave the app in an unknown state.
export async function runSteps(tests, context, { onResult = async () => {}, onFailure = async () => {} } = {}) {
  let blockedBy;
  const results = [];
  for (const [name, fn, opts = {}, shown = true] of tests) {
    if (blockedBy) {
      if (shown) {
        const result = { name, blocked: blockedBy };
        results.push(result);
        await onResult(result);
      }
      continue;
    }
    const started = Date.now();
    let timer;
    let result;
    try {
      await Promise.race([
        Promise.resolve().then(() => fn(context())),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`"${name}" took longer than ${opts.timeoutMs ?? 30000} ms`)), opts.timeoutMs ?? 30000);
        }),
      ]);
      if (shown) result = { name, ok: true, durationMs: Date.now() - started };
    } catch (e) {
      blockedBy = name;
      result = { name, ok: false, error: e.stack ?? String(e), preparation: !shown };
      // The caller closes the app/inspector, so timed-out work cannot send
      // more input or launch a replacement while later scenarios run.
      await onFailure(result);
    } finally {
      clearTimeout(timer);
    }
    if (result) {
      results.push(result);
      await onResult(result);
    }
  }
  return results;
}
