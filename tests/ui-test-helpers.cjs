const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, overrides = {}, cache = new Map()) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const exports = {};
  cache.set(absolute, exports);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  let sequence = 0;
  vm.runInNewContext(code, {
    exports, Date, Float64Array, AbortController, Error,
    crypto: { randomUUID: () => `request-${++sequence}` },
    fetch: overrides.fetch ?? (() => { throw new Error('Unexpected API call'); }),
    window: { setTimeout, clearTimeout },
    require(id) {
      if (id in overrides) return overrides[id];
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), id);
        const target = fs.existsSync(base) && fs.statSync(base).isFile() ? base : ['.ts', '.tsx'].map(ext => base + ext).find(file => fs.existsSync(file));
        return load(target, overrides, cache);
      }
      return require(id);
    },
  });
  return exports;
}

function hooks() {
  const slots = [];
  let cursor, dirty, effects;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const react = {
    Suspense: 'suspense',
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        const old = slots[i]; slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  return { react, render(fn) {
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; effects = [];
      const result = fn();
      for (const effect of effects) effect();
      if (!dirty) return result;
    }
    throw new Error('Render did not settle');
  } };
}

function elements(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, predicate, found);
  return found;
}

module.exports = { load, hooks, elements };
