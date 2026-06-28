// ── Suppress noisy dev-only console messages ──
// Filter out React's "Download the React DevTools" info log without
// touching __REACT_DEVTOOLS_GLOBAL_HOOK__ (which breaks Vite Fast Refresh).
const SUPPRESSED_PATTERNS = [
  /Download the React DevTools/,
];

for (const method of ['log', 'info'] as const) {
  const original = console[method];
  console[method] = (...args: any[]) => {
    if (args.length > 0 && typeof args[0] === 'string' && SUPPRESSED_PATTERNS.some(p => p.test(args[0]))) {
      return; // swallow
    }
    original.apply(console, args);
  };
}

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector: string, text: string) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const dependency of ['chrome', 'node', 'electron']) {
    replaceText(`${dependency}-version`, process.versions[dependency] as string);
  }
});
