// Runs in the website's page (every frame), in an isolated world: the page's scripts cannot see it
// and it changes nothing in the page. It tells the shell whether focus is in an editable field and
// forwards plain keys (no modifiers, not while typing) as console hotkeys. The page still receives
// every key. It also reports the operator's actions (clicks, typing, form submissions) to the
// recorder, describing each element the way a person or Playwright finds it: role and name.
import { ipcRenderer } from 'electron';

const editable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
};

addEventListener('focusin', (e) => ipcRenderer.send('site-editable', editable(e.target)), true);
addEventListener('focusout', () => ipcRenderer.send('site-editable', false), true);
addEventListener('DOMContentLoaded', () => ipcRenderer.send('site-editable', editable(document.activeElement)));
addEventListener(
  'keydown',
  (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || editable(e.target)) return;
    if (e.key.length !== 1 && e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    ipcRenderer.send('site-hotkey', e.key);
  },
  true
);

// ---------------------------------------------------------------- actions for the recorder

const INTERACTIVE =
  'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],[onclick]';
const MAX_VALUE = 10_000;

const clean = (s: string | null | undefined, max = 120): string | null => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'form') return 'form';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'range') return 'slider';
    if (type === 'search') return 'searchbox';
    return 'textbox';
  }
  return null;
}

function labelOf(el: Element): string | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return clean(label.textContent);
  }
  return clean(el.closest('label')?.textContent);
}

function nameOf(el: Element): string | null {
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'form') return clean(el.getAttribute('name'));
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const input = el as HTMLInputElement;
    if (['submit', 'button', 'reset'].includes(input.type)) return clean(input.value);
    return labelOf(el) ?? clean(el.getAttribute('placeholder')) ?? clean(el.getAttribute('title'));
  }
  return clean((el as HTMLElement).innerText) ?? clean(el.getAttribute('title')) ?? clean(el.querySelector('img')?.getAttribute('alt'));
}

function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement && parts.length < 5) {
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    const node: Element = cur;
    const tag = node.tagName.toLowerCase();
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName) : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
    cur = node.parentElement;
  }
  return parts.join(' > ');
}

function describe(el: Element) {
  const tag = el.tagName.toLowerCase();
  return {
    tag,
    role: el.getAttribute('role') ?? implicitRole(el),
    name: nameOf(el),
    selector: selectorOf(el),
    href: tag === 'a' ? (el as HTMLAnchorElement).href || null : tag === 'form' ? (el as HTMLFormElement).action || null : null,
    fieldName: el.getAttribute('name'),
    fieldType: tag === 'input' ? (el as HTMLInputElement).type : null
  };
}

const isSensitive = (el: Element): boolean =>
  (el as HTMLInputElement).type === 'password' || /password|one-time-code|cc-/i.test(el.getAttribute('autocomplete') ?? '');

const valueOf = (el: Element): string => {
  const input = el as HTMLInputElement;
  if (input.type === 'checkbox' || input.type === 'radio') return String(input.checked);
  return String(input.value ?? '').slice(0, MAX_VALUE);
};

const report = (kind: 'click' | 'submit' | 'input', el: Element, t: number, value: string | null = null) =>
  ipcRenderer.send('site-action', { t, kind, pageUrl: location.href, target: describe(el), value, sensitive: kind === 'input' && isSensitive(el) });

// Typing is reported once per field, when the operator pauses or moves on, with the time of the
// last keystroke; pending fields are reported before any click or submission so order holds.
const typing = new Map<Element, { timer: number; t: number }>();
const settle = (el: Element) => {
  const p = typing.get(el);
  if (!p) return;
  clearTimeout(p.timer);
  typing.delete(el);
  report('input', el, p.t, valueOf(el));
};
const settleAll = () => [...typing.keys()].forEach(settle);

addEventListener(
  'input',
  (e) => {
    const el = e.target as Element | null;
    if (!el || !editable(el)) return;
    const choice = el.tagName === 'SELECT' || ['checkbox', 'radio'].includes((el as HTMLInputElement).type);
    if (choice) return report('input', el, Date.now(), valueOf(el));
    clearTimeout(typing.get(el)?.timer);
    typing.set(el, { t: Date.now(), timer: window.setTimeout(() => settle(el), 600) });
  },
  true
);
addEventListener('change', (e) => e.target instanceof Element && settle(e.target), true);
addEventListener(
  'click',
  (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const t = Date.now();
    settleAll();
    const el = e.target.closest(INTERACTIVE) ?? (getComputedStyle(e.target).cursor === 'pointer' ? e.target : null);
    if (el) report('click', el, t);
  },
  true
);
addEventListener(
  'submit',
  (e) => {
    if (!(e.target instanceof Element)) return;
    settleAll();
    report('submit', e.target, Date.now());
  },
  true
);
addEventListener('pagehide', settleAll, true);

// ---------------------------------------------------------------- the operator's hands, for the autopilot

// A click, the wheel, scrolling keys or typing in the site while the autopilot flies means the
// operator took the controls (shell/autopilot-state.ts decides; the autopilot's own input is not
// the operator's). Scripted scrolling fires no wheel event, so the autopilot's scrolling does not count.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const touched = (e: Event) => {
  if (e.isTrusted) ipcRenderer.send('site-input', { t: Date.now(), kind: e.type });
};
addEventListener('pointerdown', touched, true);

// ---------------------------------------------------------------- the pointer, for click pass-through

// The top page reports where the pointer is (at most every 40 ms) and when it leaves the site view;
// the shell passes this on only while clicks go to the site (shell/main.ts). Frames inside the
// site would report in their own coordinates, so only the top page speaks.
if (window === window.top) {
  let lastMove = 0;
  addEventListener(
    'mousemove',
    (e) => {
      if (!e.isTrusted || e.timeStamp - lastMove < 40) return;
      lastMove = e.timeStamp;
      ipcRenderer.send('site-pointer', { x: e.clientX, y: e.clientY });
    },
    { capture: true, passive: true }
  );
  addEventListener('mouseout', (e) => !e.relatedTarget && ipcRenderer.send('site-pointer', { left: true }), true);
}
addEventListener('wheel', touched, { capture: true, passive: true });
addEventListener('keydown', (e) => (editable(e.target) || SCROLL_KEYS.has(e.key)) && touched(e), true);
