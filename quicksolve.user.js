// ==UserScript==
// @name         QuickSolve AI
// @namespace    https://learning.ccbp.in/
// @author       Aman
// @homepageURL  https://github.com/aman-dev23/QuickSolve-Extention-for-Nxtwave
// @supportURL   https://github.com/aman-dev23/QuickSolve-Extention-for-Nxtwave/issues
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/aman-dev23/QuickSolve-Extention-for-Nxtwave/main/quicksolve.user.js
// @downloadURL  https://raw.githubusercontent.com/aman-dev23/QuickSolve-Extention-for-Nxtwave/main/quicksolve.user.js
// @version      1.7.3
// @description  AI-powered practice assistant (Gemini) — keyboard engine works offline
// @match        https://learning.ccbp.in/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      ccbp.in
// @connect      docs.google.com
// @connect      api.groq.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @connect      *
// ==/UserScript==

// QuickSolve AI — Copyright (c) 2026 Aman — MIT License (see LICENSE). Keep this notice in copies.

(function () {
'use strict';
// ───── settings ─────
const GMX = {
  get(k, d) {
    try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) {}
    try { const v = localStorage.getItem('qs:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { if (typeof GM_setValue === 'function') return GM_setValue(k, v); } catch (e) {}
    try { localStorage.setItem('qs:' + k, JSON.stringify(v)); } catch (e) {}
  },
  http(opts) {
    if (typeof GM_xmlhttpRequest !== 'function') { if (opts.onerror) opts.onerror({ error: 'GM_xmlhttpRequest unavailable (not running in Tampermonkey)' }); return; }
    return GM_xmlhttpRequest(opts);
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// >>> PASTE YOUR GEMINI API KEY BETWEEN THE QUOTES (get one free at https://aistudio.google.com/apikey) <<<
const GEMINI_API_KEY = '';
// >>> OPTIONAL: Groq key (free at https://console.groq.com/keys) — or paste it in ⚙ Settings <<<
const GROQ_API_KEY = '';
// Max tokens Groq may write per answer. Groq rejects a request when (input tokens + this number) is over your per-minute limit (8000 on the free tier).
// If you still see "request too large", lower this; if answers get "cut off", raise it a little.
const GROQ_MAX_OUT = 3500;

const DEFAULTS = {
  enabled: true, keyboard: true,
  numberKeys: 9,
  keys: { submit: 'Enter', ctrlSubmit: 'Ctrl+Enter', next: 'Alt+N', ai: 'Alt+A', toggle: 'Alt+H', power: 'Alt+S', mode: 'Alt+M', hide: 'Alt+Q', provider: 'Alt+P', ask: 'Alt+K' },
  ver: 4, answerVisible: true, autoApply: true, autoSubmit: false, submitUnanswered: false,
  detail: 'short', theme: 'auto',
  apiKey: '', model: 'gemini-3.1-flash-lite',
  provider: 'auto', groqKey: '', groqModel: 'openai/gpt-oss-120b', review: true,
  sites: ['learning.ccbp.in'], pos: null, minimized: false, width: 260, fbEmail: ''
};

const Settings = {
  cur: null, listeners: [],
  load() {
    const saved = GMX.get('settings', {}) || {};
    if (saved.ver !== 4) { delete saved.apiMode; delete saved.backendUrl; saved.autoApply = true; saved.numberKeys = 9; saved.ver = 4; } // one-time upgrade
    this.cur = Object.assign({}, DEFAULTS, saved, { keys: Object.assign({}, DEFAULTS.keys, saved.keys || {}) });
    this.cur.model = (this.cur.model || '').trim(); if (!/^gemini/i.test(this.cur.model)) this.cur.model = DEFAULTS.model;
    this.cur.groqModel = (this.cur.groqModel || '').trim() || DEFAULTS.groqModel;
    this.cur.width = Math.max(200, Math.min(500, +this.cur.width || 260));
  },
  set(patch) {
    const next = Object.assign({}, this.cur, patch);
    if (patch.keys) next.keys = Object.assign({}, this.cur.keys, patch.keys);
    this.cur = next;
    GMX.set('settings', this.cur);
    this.listeners.forEach(fn => { try { fn(this.cur); } catch (e) {} });
  },
  onChange(fn) { this.listeners.push(fn); }
};

// ───── dom helpers ─────
const BTN_KINDS = {
  submit: /^submit(?: answer| code| assignment)?$/i,
  run: /^run(?: code)?$/i,
  next: /^(?:next|next question|save\s*(?:&|and)\s*next)$/i,
  cont: /^continue$/i,
  save: /^save$/i
};
const EDITOR_SEL = '.ace_editor,.monaco-editor,.CodeMirror,.cm-editor';

const Dom = {
  norm(t) { return (t || '').replace(/\s+/g, ' ').trim(); },

  visible(el) {
    if (!el || !el.isConnected) return false;
    let n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 25) {
      if (n.hidden) return false;
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      n = n.parentElement;
    }
    return true;
  },

  isEditable(t) {
    if (!t || t.nodeType !== 1) return false;
    const tag = t.tagName;
    if (tag === 'SELECT') return true;
    if (tag === 'TEXTAREA') return !t.readOnly || !!t.closest(EDITOR_SEL);
    if (tag === 'INPUT') {
      const ty = (t.type || 'text').toLowerCase();
      return !['radio', 'checkbox', 'button', 'submit', 'reset', 'image', 'file', 'color', 'range'].includes(ty);
    }
    if (t.isContentEditable) return true;
    return !!t.closest(EDITOR_SEL + ',[contenteditable="true"],[contenteditable=""]');
  },

  isDisabled(el) {
    return !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(el.className || ''));
  },

  label(el) {
    return this.norm(el.getAttribute('aria-label') || el.value && el.tagName === 'INPUT' && el.value || el.textContent || el.title);
  },

  buttons(scope) {
    const out = [];
    (scope || document).querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]').forEach(el => {
      if (!this.visible(el)) return;
      const label = this.label(el);
      if (!label) return;
      let kind = 'other';
      for (const k in BTN_KINDS) if (BTN_KINDS[k].test(label)) { kind = k; break; }
      out.push({ el, label, kind, enabled: !this.isDisabled(el) });
    });
    return out;
  },

  buttonsOfKind(scope, kind) { return this.buttons(scope).filter(b => b.kind === kind); },

  hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
};

// ───── observer ─────
const Observer = {
  version: 0, fp: '', listeners: [], _t: 0, mo: null,

  start() {
    if (this.mo) return;
    this.mo = new MutationObserver(recs => {
      let relevant = false;
      for (const r of recs) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el && el.closest && el.closest('.ace_editor,#qs-host')) continue;
        relevant = true; break;
      }
      if (!relevant) return;
      this.version++;
      if (!this._t) this._t = setTimeout(() => { this._t = 0; this.refresh(); }, 120);
    });
    this.mo.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled', 'aria-checked', 'hidden'] });
    this.fp = this.computeFp();
  },

  computeFp() {
    const root = Ccbp.root();
    if (!root) return '';
    const d = Ccbp.descriptionEl(root);
    return Dom.hash((d.textContent || '').slice(0, 600) + '|' + Ccbp.options(root).length + '|' + location.pathname + location.search);
  },

  refresh() {
    const f = this.computeFp();
    if (f !== this.fp) { this.fp = f; this.listeners.forEach(fn => { try { fn(f); } catch (e) {} }); }
  },
  onQuestionChange(fn) { this.listeners.push(fn); }
};

// ───── CCBP site adapter ─────
// MCQ page   : #exam-question-wrapper-id = question text only; [data-testid="radioGroupOptions"] is a sibling.
// Coding page: #codingQuestionInfoContainer = the whole description card (title, text, images, samples).
const SKIP_SEL = '[data-testid$="GroupOptions"],.ace_editor,button,textarea,script,style,svg,.katex-html';
const GROUP_SEL = '[data-testid$="GroupOptions"]';
const ANSWER_SEL = GROUP_SEL + ',textarea:not(.ace_text-input),input[type="radio"],input[type="checkbox"]';
const NOISE_LINES = ['Description', 'Submissions', 'Tutorial', 'Get Help', 'In Progress', 'Helpful', 'Give Feedback'];
const LANG_TAB = /^(html|css|javascript|js|typescript|python|java|c\+\+|c#|sql|php|ruby|go|kotlin|swift|rust)$/i;

const Ccbp = {
  name: 'ccbp', mode: 'loose',
  _root: null, _rootV: -1, _opts: null, _optsV: -1,

  _pane(w) {
    let n = w;
    for (let i = 0; i < 10 && n.parentElement && n.parentElement !== document.body; i++) {
      n = n.parentElement;
      if (n.querySelector(ANSWER_SEL)) return n;
    }
    return w;
  },

  _descPane() {
    const it = document.evaluate("//*[not(self::script or self::style)][text()[normalize-space(.)='Description']]", document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    let el;
    while ((el = it.iterateNext())) {
      if (el.closest('.ace_editor')) continue;
      let n = el;
      while (n.parentElement && n.parentElement !== document.body && !n.parentElement.querySelector('.ace_editor')) n = n.parentElement;
      while (n.textContent.length < 120 && n.parentElement && n.parentElement !== document.body) n = n.parentElement;
      return n;
    }
    return null;
  },

  root() {
    if (this._rootV === Observer.version && this._root && this._root.isConnected) return this._root;
    let r = null, mode = 'loose';
    let w = document.querySelector('#exam-question-wrapper-id');
    if (!w && document.querySelector(GROUP_SEL)) w = document.querySelector('[class*="QuestionDescriptionContainer"]');
    const info = document.querySelector('#codingQuestionInfoContainer');
    if (w) { r = this._pane(w); mode = 'mcq'; }
    else if (info) { r = info; mode = 'coding'; }
    else if (document.querySelector('.ace_editor')) { r = this._descPane(); if (r) mode = 'coding'; }
    if (!r) { const g = document.querySelector(GROUP_SEL); if (g) { r = g.parentElement || g; mode = 'mcq'; } }
    if (!r) { r = document.body; mode = 'loose'; }
    this._root = r; this.mode = mode; this._rootV = Observer.version;
    return r;
  },

  fallbackQuestion() {             // last resort: the nearest block with text/picture that comes before the options
    let n = document.querySelector(GROUP_SEL);
    for (let i = 0; n && i < 6; i++, n = n.parentElement) {
      let s = n.previousElementSibling;
      while (s) { if (!s.closest('#qs-host') && (Dom.norm(s.textContent).length > 10 || s.querySelector('img'))) return s; s = s.previousElementSibling; }
    }
    return null;
  },

  descriptionEl(root) {
    if (this.mode === 'mcq') {
      const ok = (el) => el && !el.closest(GROUP_SEL) && (Dom.norm(el.textContent) || el.querySelector('img'));
      const qd = document.querySelector('[class*="QuestionDescriptionContainer"]'); if (ok(qd)) return qd;
      for (const el of root.querySelectorAll('[data-testid="html"]')) if (ok(el)) return el;
      const w = document.querySelector('#exam-question-wrapper-id'); if (ok(w)) return w;
      return this.fallbackQuestion() || root;
    }
    return root;
  },

  answerFields() { const r = this.root(); return this.mode === 'mcq' ? TextareaAdapter.fields(r) : []; },

  options(root) {
    root = root || this.root();
    if (!root) return [];
    if (this._optsV === Observer.version && this._opts && this._opts.root === root) return this._opts.list;
    const group = root.querySelector(GROUP_SEL) || document.querySelector(GROUP_SEL);
    const list = [];
    const collect = (scope) => {
      scope.querySelectorAll('input[type="radio"],input[type="checkbox"]').forEach(input => {
        const host = input.closest('label') || input.parentElement || input;
        if (!Dom.visible(host)) return;
        list.push({ el: input, input, kind: input.type, checked: () => input.checked });
      });
    };
    if (group) {
      collect(group);
      if (!list.length) group.querySelectorAll('[role="radio"],[role="checkbox"]').forEach(el => {
        if (!Dom.visible(el)) return;
        list.push({ el, input: null, kind: el.getAttribute('role'), checked: () => el.getAttribute('aria-checked') === 'true' });
      });
    }
    if (!list.length && this.mode === 'mcq') collect(root);   // last resort on MCQ pages
    this._opts = { root, list }; this._optsV = Observer.version;
    return list;
  },

  optionHost(o) {                  // the element holding ONE option's visible content (text and/or picture)
    const lab = (o.input && o.input.labels && o.input.labels[0]) || o.el.closest('label');
    let n = lab || o.el.parentElement || o.el;
    const group = o.el.closest(GROUP_SEL);
    const cnt = (x) => x.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]').length;
    while (n.parentElement && n !== group && n.parentElement !== group && !Dom.norm(n.textContent) && !n.querySelector('img,svg,canvas') && cnt(n.parentElement) <= 1) n = n.parentElement;
    return n;
  },

  optionLabel(o, idx) {
    const lab = (o.input && o.input.labels && o.input.labels[0]) || o.el.closest('label');
    const host = this.optionHost(o);
    let t = Dom.norm(host.textContent);
    const imgs = host.querySelectorAll('img');
    const pic = idx == null ? '' : ' option ' + (idx + 1);
    if (imgs.length) { const alts = Array.from(imgs).map(i => i.alt).filter(Boolean).join(' / '); t = Dom.norm(t + ' [image' + pic + (alts ? ': ' + alts : '') + ']'); }
    if (!t && lab && lab.dataset && lab.dataset.testid) t = lab.dataset.testid;   // CCBP stores the option text here too
    if (!t) t = '[picture' + pic + ']';
    return t;
  },

  clickOption(o) {
    o.el.click();
    if (o.input && o.kind === 'radio' && !o.checked()) { const l = o.el.closest('label'); if (l) l.click(); }
  },

  langTabs() {                     // HTML / CSS / JAVASCRIPT tabs above the editors
    const out = [];
    if (this.mode !== 'coding' || !document.querySelector('.ace_editor')) return out;
    document.querySelectorAll('div,span,button,li,a,[role="tab"]').forEach(el => {
      if (el.closest('.ace_editor') || el.children.length > 3) return;
      const t = Dom.norm(el.textContent);
      if (t.length > 12 || !LANG_TAB.test(t)) return;
      const lang = normLang(t);
      if (out.some(x => x.lang === lang) || !Dom.visible(el)) return;
      out.push({ lang, el });
    });
    return out;
  },

  selectedLang() {                 // "Python 3.10" style language dropdown
    for (const el of document.querySelectorAll('button,div,span')) {
      if (el.children.length > 2 || el.closest('.ace_editor')) continue;
      const t = Dom.norm(el.textContent);
      const m = /^(python|java|javascript|c\+\+|c|sql|node\.?js)\b[\s\d.]*$/i.exec(t);
      if (m && Dom.visible(el)) return normLang(m[1].replace(/^node\.?js$/i, 'javascript'));
    }
    return '';
  },

  testCases() {                    // the "Testcases" panel under the editor (✓ passed / ✗ failed)
    let rows = Array.from(document.querySelectorAll('[class*="TestCaseHeadingAndReason"]')).filter(el => Dom.visible(el) && !el.closest('#qs-host'));
    if (!rows.length) rows = Array.from(document.querySelectorAll('div,p,span,li')).filter(el => !el.closest('#qs-host,.ace_editor') && el.children.length < 3 && /^(page|the page|code|output)\s+should\b/i.test(Dom.norm(el.textContent)) && Dom.visible(el));
    rows = rows.filter(el => !rows.some(o => o !== el && o.contains(el)));
    const rgb = (c) => { const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c || ''); return m ? [+m[1], +m[2], +m[3]] : null; };
    const status = (row) => {
      const host = row.parentElement || row;
      const cls = (host.className || '') + ' ' + (row.className || '');
      for (const svg of host.querySelectorAll('svg')) {
        const els = [svg].concat(Array.from(svg.querySelectorAll('path,circle')).slice(0, 2));
        for (const e of els) {
          const cs = getComputedStyle(e);
          for (const c of [cs.color, cs.fill, cs.stroke]) {
            const v = rgb(c); if (!v) continue;
            if (v[0] > v[1] + 40 && v[0] > v[2] + 40) return 'FAILED';
            if (v[1] > v[0] + 30 && v[1] >= v[2]) return 'PASSED';
          }
        }
      }
      if (/fail|error|wrong/i.test(cls)) return 'FAILED';
      if (/pass|success/i.test(cls)) return 'PASSED';
      return 'UNKNOWN';
    };
    const sum = document.querySelector('[class*="TestCaseSummaryContainer"]');
    return { summary: sum ? Dom.norm(sum.textContent) : '', list: rows.map(r => ({ text: Dom.norm(r.textContent), status: status(r) })) };
  },

  testCasesText() {
    const t = this.testCases(); if (!t.list.length) return '';
    return (t.summary ? 'SUMMARY: ' + t.summary + '\n' : '') + t.list.map((x, i) => (i + 1) + '. [' + x.status + '] ' + x.text).join('\n');
  }
};

// ───── plain answer fields ─────
const TextareaAdapter = {
  fields(root) {
    const out = [];
    (root || document).querySelectorAll('textarea,input[type="text"],input:not([type]),[contenteditable="true"]').forEach(el => {
      if (el.closest(EDITOR_SEL + ',#qs-host')) return;
      if (!Dom.visible(el)) return;
      out.push({ el, id: el.id || el.name || '', placeholder: el.getAttribute('placeholder') || '' });
    });
    return out;
  },
  getValue(el) { return el.isContentEditable && !('value' in el) ? el.textContent : el.value; },
  set(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return this.getValue(el) === text;
  }
};

// ───── Ace editor access ─────
// Page-context bridge (Ace instances live in the page's JS world). If the page's CSP blocks it,
// we fall back to driving the editor's hidden textarea (select-all + paste).
function __qsPageBridge(token) {
  const reply = (m) => window.postMessage(Object.assign({ qs: 'res', token }, m), location.origin);
  const getEd = (el) => (el && el.env && el.env.editor) || null;
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (ev.origin !== location.origin || !d || d.qs !== 'req' || d.token !== token || typeof d.id !== 'number') return;
    try {
      if (d.op === 'ping') return reply({ id: d.id, ok: true });
      const els = Array.prototype.slice.call(document.querySelectorAll('.ace_editor'));
      if (d.op === 'list') {
        return reply({ id: d.id, ok: true, editors: els.map((el, i) => {
          const ed = getEd(el); let mode = '';
          try { mode = ed.session.getMode().$id || ''; } catch (e) {}
          return { index: i, elId: el.id || '', mode: String(mode), value: ed ? String(ed.getValue()) : null,
                   readOnly: ed ? !!ed.getReadOnly() : null, hasApi: !!ed };
        }) });
      }
      if (d.op === 'set') {
        const ed = getEd(els[d.index]);
        if (!ed) return reply({ id: d.id, ok: false, error: 'editor API not reachable' });
        if (typeof d.value !== 'string') return reply({ id: d.id, ok: false, error: 'bad value' });
        ed.setValue(d.value, -1);
        return reply({ id: d.id, ok: true, value: String(ed.getValue()) });
      }
      reply({ id: d.id, ok: false, error: 'unknown op' });
    } catch (e) { reply({ id: d.id, ok: false, error: String(e && e.message || e) }); }
  });
}

const isWritable = (e) => e && e.kind === 'ace' && (e.hasApi || e.domWritable) && !e.readOnly;

const AceAdapter = {
  token: null, ready: null, seq: 1, pending: {},

  _listen() {
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (ev.origin !== location.origin || !d || d.qs !== 'res' || d.token !== this.token) return;
      const p = this.pending[d.id]; if (!p) return;
      delete this.pending[d.id]; clearTimeout(p.t); p.resolve(d);
    });
  },

  _req(op, extra) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      const t = setTimeout(() => { delete this.pending[id]; reject(new Error('Editor bridge timeout')); }, 1500);
      this.pending[id] = { resolve, t };
      window.postMessage(Object.assign({ qs: 'req', token: this.token, id, op }, extra || {}), location.origin);
    });
  },

  _inject(asBlob) {
    const code = '(' + __qsPageBridge.toString() + ')(' + JSON.stringify(this.token) + ');';
    const s = document.createElement('script');
    try {
      if (asBlob) { s.src = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); }
      else { s.textContent = code; }
      (document.documentElement).appendChild(s); s.remove();
    } catch (e) {}
  },

  async ensure() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const a = new Uint32Array(4); crypto.getRandomValues(a);
      this.token = Array.from(a).map(n => n.toString(36)).join('');
      this._listen();
      for (const blob of [false, true]) {
        this._inject(blob);
        try { await this._req('ping'); return true; } catch (e) {}
      }
      return false;
    })();
    return this.ready;
  },

  modeToLang(mode, elId) {
    let l = (mode || '').split('/').pop().toLowerCase();
    if (!l) l = (elId || '').toLowerCase().replace(/editor$/, '');
    if (!l || l === 'text') l = Ccbp.selectedLang() || 'code';
    return l === 'js' ? 'javascript' : l;
  },

  _domInfo(el, i, extra) {
    const ta = el.querySelector('textarea.ace_text-input');
    const code = Array.from(el.querySelectorAll('.ace_text-layer .ace_line')).map(l => l.textContent).join('\n');
    return Object.assign({ kind: 'ace', index: i, id: el.id || '', language: this.modeToLang('', el.id), code, empty: !code.trim(),
      readOnly: !!(ta && ta.readOnly), hasApi: false, domWritable: !!ta && !ta.readOnly, visible: Dom.visible(el) }, extra || {});
  },

  async list() {
    const els = Array.from(document.querySelectorAll('.ace_editor'));
    if (!els.length) return [];
    if (!(await this.ensure())) return els.map((el, i) => this._domInfo(el, i, { error: 'Page blocked the editor bridge (CSP) — using slower fallback' }));
    let r;
    try { r = await this._req('list'); } catch (e) { return els.map((el, i) => this._domInfo(el, i, { error: e.message })); }
    return (r.editors || []).map(e => {
      const el = els[e.index]; if (!el) return null;
      const d = this._domInfo(el, e.index);
      if (!e.hasApi) return Object.assign(d, { error: 'editor API not reachable' });
      const code = e.value || '';
      return Object.assign(d, { id: e.elId, language: this.modeToLang(e.mode, e.elId), code, empty: !code.trim(),
        readOnly: e.readOnly !== null ? !!e.readOnly : d.readOnly, hasApi: true, domWritable: true });
    }).filter(Boolean);
  },

  async _domSet(index, code) {            // fallback: select-all + paste into Ace's hidden textarea
    const el = document.querySelectorAll('.ace_editor')[index];
    const ta = el && el.querySelector('textarea.ace_text-input');
    if (!ta) throw new Error('editor input not found');
    ta.focus();
    const ctrlA = { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true };
    ta.dispatchEvent(new KeyboardEvent('keydown', ctrlA));
    ta.dispatchEvent(new KeyboardEvent('keyup', ctrlA));
    const dt = new DataTransfer(); dt.setData('text/plain', code);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(200);
    const first = (code.split('\n').find(l => l.trim()) || '').trim();
    const shown = Array.from(el.querySelectorAll('.ace_text-layer .ace_line')).map(l => l.textContent).join('\n');
    return !first || shown.includes(first.slice(0, 40));
  },

  async set(index, code) {
    if (await this.ensure()) {
      try {
        const r = await this._req('set', { index, value: code });
        if (r.ok) return r.value === code;
      } catch (e) {}
    }
    return this._domSet(index, code);
  }
};

// ───── editor manager ─────
const LANG_ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', 'c++': 'cpp', 'c_cpp': 'cpp', htm: 'html', python3: 'python' };
const normLang = (l) => { l = (l || '').toLowerCase().trim(); return LANG_ALIAS[l] || l; };

const Editors = {
  async list() {
    const out = await AceAdapter.list();
    if (document.querySelector('.monaco-editor,.CodeMirror,.cm-editor')) out.push({ kind: 'unsupported', language: 'unknown', hasApi: false, readOnly: false, code: '', error: 'Monaco/CodeMirror editors are not supported yet' });
    return out;
  },

  _match(list, lang) { return list.filter(e => isWritable(e) && normLang(e.language) === lang); },

  async setByLanguage(lang, code) {
    lang = normLang(lang);
    let hit = this._match(await this.list(), lang);
    if (!hit.length) {
      const tab = Ccbp.langTabs().find(t => t.lang === lang);
      if (tab) {
        tab.el.click();
        for (let i = 0; i < 12 && !hit.length; i++) { await sleep(120); hit = this._match(await this.list(), lang); }
      }
    }
    if (hit.length > 1) { const v = hit.filter(e => e.visible); if (v.length === 1) hit = v; }
    if (!hit.length) throw new Error('No editable ' + lang + ' editor found');
    if (hit.length > 1) throw new Error('More than one ' + lang + ' editor — ambiguous');
    if (!(await AceAdapter.set(hit[0].index, code))) throw new Error('Verification failed for ' + lang);
    return true;
  }
};

// ───── images ─────
const Images = {
  collect(descEl) {
    const out = [];
    descEl.querySelectorAll('img').forEach((img) => {
      if (img.closest(SKIP_SEL)) return;
      if (img.naturalWidth && img.naturalWidth < 32 && img.naturalHeight < 32) return;
      const fig = img.closest('figure');
      out.push({ index: out.length, url: img.currentSrc || img.src || '', alt: img.alt || '', w: img.naturalWidth || 0, h: img.naturalHeight || 0,
                 caption: fig && fig.querySelector('figcaption') ? Dom.norm(fig.querySelector('figcaption').textContent) : '', el: img });
    });
    return out;
  },

  collectPage() {                 // question / page images only: no header, nav, logo, avatar or tiny icons
    const out = [];
    document.querySelectorAll('img').forEach((img) => {
      if (img.closest('#qs-host,header,nav,footer,[class*="eader"],[class*="avbar"],[class*="ogo"]')) return;
      if (/logo|avatar|favicon|profile|icon/i.test((img.src || '') + ' ' + (img.alt || '') + ' ' + (img.className || ''))) return;
      if (!Dom.visible(img) || (img.naturalWidth || 0) < 48 || (img.naturalHeight || 0) < 48) return;
      const fig = img.closest('figure');
      out.push({ index: out.length, url: img.currentSrc || img.src || '', alt: img.alt || '', w: img.naturalWidth, h: img.naturalHeight,
                 caption: fig && fig.querySelector('figcaption') ? Dom.norm(fig.querySelector('figcaption').textContent) : '', el: img });
    });
    return out;
  },

  collectOptions() {              // pictures inside the answer options; an option drawn without <img> is captured as a screenshot of that option
    const out = [];
    Ccbp.options().forEach((o, i) => {
      const host = Ccbp.optionHost(o), label = 'Option ' + (i + 1) + ' image';
      const els = Array.from(host.querySelectorAll('img')).filter(im => !(im.naturalWidth && im.naturalWidth < 6));
      els.forEach(im => out.push({ index: i, label, url: im.currentSrc || im.src || '', alt: im.alt || '', caption: '', w: im.naturalWidth || 0, h: im.naturalHeight || 0, el: im }));
      if (!els.length && !Dom.norm(host.textContent)) { const r = host.getBoundingClientRect(); out.push({ index: i, label, url: '', alt: '', caption: '', w: Math.round(r.width), h: Math.round(r.height), el: host, capture: true }); }
    });
    return out;
  },

  sniff(u8) {
    if (u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
    if (u8[0] === 0xFF && u8[1] === 0xD8) return 'image/jpeg';
    if (u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[9] === 0x45) return 'image/webp';
    return null;
  },
  b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },

  async _bytes(url) {
    if (url.startsWith('data:')) { const r = await fetch(url); return new Uint8Array(await r.arrayBuffer()); }
    try { const r = await fetch(url, { credentials: 'include' }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) {}
    return new Promise((res, rej) => GMX.http({ method: 'GET', url, responseType: 'arraybuffer', timeout: 20000,
      onload: (r) => r.status >= 200 && r.status < 300 ? res(new Uint8Array(r.response)) : rej(new Error('HTTP ' + r.status)),
      onerror: () => rej(new Error('blocked or network error')), ontimeout: () => rej(new Error('timeout')) }));
  },

  async normalize(u8, hint) {            // any browser-decodable format (GIF/SVG/AVIF/BMP/huge PNG) → JPEG/PNG/WebP Gemini accepts
    const mt = this.sniff(u8);
    if (mt && u8.length <= 4 * 1024 * 1024) return { mediaType: mt, data: this.b64(u8) };
    const url = URL.createObjectURL(new Blob([u8], { type: mt || hint || 'image/png' }));
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('cannot decode image')); i.src = url; });
      return this._canvas(img);
    } finally { URL.revokeObjectURL(url); }
  },
  _canvas(img) {
    const w0 = img.naturalWidth || img.width || 800, h0 = img.naturalHeight || img.height || 600;
    const k = Math.min(1, 1800 / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return { mediaType: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.92).split(',')[1] };
  },

  async palette(r) {          // real colours measured from the pixels, so the AI does not have to guess hex values
    try {
      const bin = atob(r.data), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: r.mediaType }));
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      URL.revokeObjectURL(url);
      const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data, bins = new Map(); let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const b = bins.get(key) || [0, 0, 0, 0]; b[0]++; b[1] += d[i]; b[2] += d[i + 1]; b[3] += d[i + 2]; bins.set(key, b); n++;
      }
      const hex = (v) => ('0' + Math.round(v).toString(16)).slice(-2), out = [];
      Array.from(bins.values()).sort((a, b) => b[0] - a[0]).forEach(b => {
        const rgb = [b[1] / b[0], b[2] / b[0], b[3] / b[0]];
        if (b[0] / n < 0.015 || out.length >= 8) return;
        if (out.some(o => Math.abs(o.rgb[0] - rgb[0]) + Math.abs(o.rgb[1] - rgb[1]) + Math.abs(o.rgb[2] - rgb[2]) < 40)) return;
        out.push({ rgb, p: b[0] / n });
      });
      return out.map(o => '#' + hex(o.rgb[0]) + hex(o.rgb[1]) + hex(o.rgb[2]) + ' ' + Math.round(o.p * 100) + '%').join(', ');
    } catch (e) { return ''; }
  },

  async fetchAll(list) {
    const MAX_IMAGES = 8;
    const out = [];
    for (const im of list) {
      const rec = { index: im.index, label: im.label, url: im.url, alt: im.alt, caption: im.caption, w: im.w, h: im.h, supplied: false };
      if (out.length >= MAX_IMAGES) { rec.reason = 'image limit reached'; out.push(rec); continue; }
      try {
        let r;
        if (im.capture) r = await Shot.el(im.el);
        else try {
          const u8 = await this._bytes(im.url);
          if (u8.length > 25 * 1024 * 1024) throw new Error('larger than 25 MB');
          r = await this.normalize(u8);
        } catch (e1) {
          try { r = this._canvas(im.el); } catch (e2) { throw e1; }   // last resort: draw the already-loaded <img>
        }
        rec.supplied = true; rec.mediaType = r.mediaType; rec.data = r.data;
        rec.palette = await this.palette(r);
      } catch (e) { rec.reason = e.message; }
      out.push(rec);
    }
    return out;
  }
};

// ───── question extraction ─────
const BLOCK_TAG = /^(P|DIV|SECTION|ARTICLE|UL|OL|TABLE|TR|H[1-6]|BLOCKQUOTE|FIGURE|FIGCAPTION|HR)$/;

function qsTextOf(root, imgs) {
  let out = '';
  (function walk(n) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1 || (n !== root && n.matches(SKIP_SEL))) return;
    const t = n.tagName;
    if (t === 'PRE') { out += '\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n'; return; }
    if (t === 'IMG') { const k = imgs.findIndex(i => i.el === n); out += '[Image ' + (k + 1) + (n.alt ? ': ' + n.alt : '') + ']'; return; }
    if (t === 'CODE') { out += '`' + n.textContent + '`'; return; }
    if (t === 'STRONG' || t === 'B') { out += '**'; n.childNodes.forEach(walk); out += '**'; return; }
    if (t === 'BR') { out += '\n'; return; }
    if (n.classList && n.classList.contains('katex')) {
      const a = n.querySelector('annotation[encoding="application/x-tex"]');
      out += a ? '$' + a.textContent + '$' : n.textContent; return;
    }
    if (t === 'LI') out += '\n- '; else if (BLOCK_TAG.test(t)) out += '\n';
    n.childNodes.forEach(walk);
    if (BLOCK_TAG.test(t)) out += '\n';
    if (t === 'TD' || t === 'TH') out += ' | ';
  })(root);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const Extractor = {
  async extract() {
    const root = Ccbp.root();
    if (!root) return null;
    const descEl = Ccbp.descriptionEl(root);
    const images = Images.collect(descEl);
    const heading = Ccbp.mode === 'loose' ? null : descEl.querySelector('h1,h2,h3,h4');
    const options = Ccbp.options(root).map((o, i) => ({
      index: i, label: Ccbp.optionLabel(o, i), value: o.input ? o.input.value : null, type: o.kind, checked: o.checked()
    }));
    const description = qsTextOf(descEl, images).split('\n').filter(l => !NOISE_LINES.includes(l.trim())).join('\n').trim();
    const q = {
      site: Ccbp.name, mode: Ccbp.mode, url: location.href, fingerprint: Observer.computeFp(),
      title: heading ? Dom.norm(heading.textContent) : '',
      description,
      options, multiSelectAllowed: options.some(o => o.type === 'checkbox'),
      images, editors: await Editors.list(),
      languageTabs: Ccbp.langTabs().map(t => t.lang),
      testCases: Ccbp.testCasesText(),
      textFields: Ccbp.answerFields().map((f, i) => ({ index: i, id: f.id, placeholder: f.placeholder, value: TextareaAdapter.getValue(f.el) })),
      buttons: Dom.buttons(root).map(b => ({ label: b.label, kind: b.kind, enabled: b.enabled }))
    };
    q.classification = Classifier.classify(q);
    q.type = q.classification.type;
    return q;
  }
};

// Answer controls decide the type. Options always beat text boxes and editors
// (editors beside an MCQ are just read-only reference code).
const Classifier = {
  classify(q) {
    const reasons = [];
    const checks = q.options.filter(o => o.type === 'checkbox').length;
    const radios = q.options.length - checks;
    const editable = q.editors.filter(isWritable);
    const langs = Array.from(new Set(editable.map(e => normLang(e.language)).concat(q.languageTabs))).filter(Boolean);
    let type = 'unknown', confidence = 0;

    if (checks) { type = 'multiple_choice'; confidence = 0.95; reasons.push('checkbox options'); }
    else if (radios) { type = 'single_choice'; confidence = 0.95; reasons.push('radio options'); }
    else if (q.mode === 'coding' && editable.length) {
      type = langs.length > 1 ? 'coding_multi_language' : 'coding_single_language';
      confidence = 0.9; reasons.push('editable code editor(s): ' + langs.join(', '));
    }
    else if (q.textFields.length) { type = 'text'; confidence = 0.9; reasons.push('answer text box'); }
    else if (editable.length) {
      type = langs.length > 1 ? 'coding_multi_language' : 'coding_single_language';
      confidence = 0.8; reasons.push('editable code editor(s): ' + langs.join(', '));
    } else reasons.push(q.editors.length ? 'editors found but not writable' : 'no answer controls found');
    return { type, confidence, reasons, languages: langs };
  }
};

// ───── apply answers ─────
const Actions = {
  async apply(res, q) {
    if (res.type === 'single_choice' || res.type === 'multiple_choice') return this.applyChoice(res, q);
    if (res.type === 'text') return this.applyText(res);
    if (res.type.startsWith('coding')) return this.applyCode(res);
    return { ok: false, msg: 'Unsupported question type' };
  },

  async applyChoice(res, q) {
    let opts = Ccbp.options();
    if (opts.length !== q.options.length) return { ok: false, msg: 'Options changed; not applied' };
    const want = new Set(res.selected);
    if (res.type === 'single_choice') {
      const o = opts[res.selected[0]];
      if (!o.checked()) Ccbp.clickOption(o);
    } else {
      opts.forEach((o, i) => { if (o.checked() !== want.has(i)) Ccbp.clickOption(o); });
    }
    await sleep(120);
    opts = Ccbp.options();
    const okAll = opts.length === q.options.length && opts.every((o, i) => o.checked() === want.has(i));
    return okAll ? { ok: true, msg: 'Selected option ' + res.selected.map(i => i + 1).join(', ') }
                 : { ok: false, msg: 'Page did not reflect the selection' };
  },

  applyText(res) {
    const fields = Ccbp.answerFields();
    if (fields.length !== 1) return { ok: false, msg: fields.length ? 'Several text fields — not applied' : 'No text field found' };
    return TextareaAdapter.set(fields[0].el, res.text) ? { ok: true, msg: 'Answer inserted' } : { ok: false, msg: 'Text field did not accept the value' };
  },

  async applyCode(res) {
    const done = [], failed = [];
    for (const lang of Object.keys(res.code)) {
      try { await Editors.setByLanguage(lang, res.code[lang]); done.push(lang); }
      catch (e) { failed.push(lang + ': ' + e.message); }
    }
    if (failed.length) return { ok: false, msg: 'Code failed — ' + failed.join('; ') + (done.length ? ' (inserted: ' + done.join(', ') + ')' : '') };
    return { ok: true, msg: 'Code inserted & verified: ' + done.join(', ') };
  }
};

// ───── submit / next ─────
const Submit = {
  busyUntil: 0,

  _pick(kind) {
    const root = Ccbp.root();
    let c = root ? Dom.buttonsOfKind(root, kind) : [];
    if (!c.length) c = Dom.buttonsOfKind(document, kind);
    if (kind === 'next' && !c.length) c = Dom.buttonsOfKind(document, 'cont');
    if (c.length > 1) { const en = c.filter(b => b.enabled); if (en.length === 1) c = en; }
    return c;
  },

  _answered() {
    const opts = Ccbp.options();
    if (opts.length) return opts.some(o => o.checked());
    const f = Ccbp.answerFields();
    if (f.length) return f.some(x => (TextareaAdapter.getValue(x.el) || '').trim());
    return true;
  },

  submit(src) {
    const now = Date.now();
    if (now < this.busyUntil) return UI.toast('Submission already in progress', 'warn');
    const c = this._pick('submit');
    if (!c.length) return UI.toast('No Submit button found', 'err');
    if (c.length > 1) return UI.toast('Several Submit buttons — not guessing', 'err');
    const b = c[0];
    if (!b.enabled) return UI.toast('Submit is disabled', 'warn');
    if (/submitting|loading|please wait/i.test(b.label) || b.el.getAttribute('aria-busy') === 'true') return UI.toast('Submission already in progress', 'warn');
    if (!Settings.cur.submitUnanswered && !this._answered()) return UI.toast('Nothing answered yet', 'warn');
    this.busyUntil = now + 2000;
    const before = { fp: Observer.fp, label: b.label, v: Observer.version };
    b.el.click();
    setTimeout(() => {
      const changed = !b.el.isConnected || Dom.isDisabled(b.el) || Dom.label(b.el) !== before.label || Observer.version !== before.v;
      UI.toast(changed ? 'Submitted' : 'Clicked Submit — no visible change yet', changed ? 'ok' : 'warn');
      if (changed) this.busyUntil = 0;
    }, 1000);
  },

  next() {
    const c = this._pick('next');
    if (!c.length) return UI.toast('No Next control found', 'err');
    let list = c.filter(b => b.enabled);
    if (list.length > 1) { const strict = list.filter(b => /^next/i.test(b.label)); if (strict.length) list = strict; }
    if (list.length !== 1) return UI.toast(list.length ? 'Several Next controls — not guessing' : 'Next is disabled', 'warn');
    const before = Observer.fp;
    list[0].el.click();
    setTimeout(() => { Observer.refresh(); UI.toast(Observer.fp !== before ? 'Moved to next question' : 'Clicked Next — page did not change', Observer.fp !== before ? 'ok' : 'warn'); }, 900);
  }
};
Observer.onQuestionChange(() => { Submit.busyUntil = 0; });

// ───── keyboard engine ─────
const Keyboard = {
  combos: null,

  parse(str) {
    const p = String(str || '').split('+').map(x => x.trim().toLowerCase()).filter(Boolean);
    const key = p.pop() || '';
    return { ctrl: p.includes('ctrl') || p.includes('cmd') || p.includes('meta'), alt: p.includes('alt') || p.includes('option'), shift: p.includes('shift'), key };
  },
  match(e, c) {
    if (!c || c.alt !== e.altKey || c.shift !== e.shiftKey || c.ctrl !== (e.ctrlKey || e.metaKey)) return false;
    const k = (e.key || '').toLowerCase();
    if (k === c.key) return true;
    if (/^[a-z]$/.test(c.key)) return e.code === 'Key' + c.key.toUpperCase();
    if (/^\d$/.test(c.key)) return e.code === 'Digit' + c.key;
    return false;
  },
  rebuild() {
    const k = Settings.cur.keys, p = {};
    for (const n in k) p[n] = this.parse(k[n]);
    this.combos = p;
  },

  // True when the user is really typing. On option questions the page also shows a READ-ONLY Ace editor
  // (the question's code) and focus often sits in it — digits / Enter must still drive the options there.
  isTyping(t) {
    if (!Dom.isEditable(t)) return false;
    if (t.closest && t.closest(EDITOR_SEL) && Ccbp.options().length) return false;
    return true;
  },

  init() {
    if (window.__qsKeyboard) return;
    window.__qsKeyboard = true;
    this.rebuild(); Settings.onChange(() => this.rebuild());
    document.addEventListener('keydown', (e) => this.onKey(e), true);
  },

  onKey(e) {
    const s = Settings.cur, c = this.combos;
    if (e.isComposing) return;

    if (this.match(e, c.power)) { e.preventDefault(); e.stopPropagation(); Main.togglePower(); return; }
    if (this.match(e, c.hide)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Main.toggleHidden(); return; }
    if (!s.enabled) return;

    if (this.match(e, c.ai))     { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Main.solve(); return; }
    if (this.match(e, c.mode))   { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Main.toggleAuto(); return; }
    if (this.match(e, c.provider)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Main.cycleProvider(); return; }
    if (this.match(e, c.ask))      { e.preventDefault(); e.stopPropagation(); UI.focusAsk(); return; }
    if (this.match(e, c.toggle)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Main.toggleVisible(); return; }
    if (this.match(e, c.next))   { e.preventDefault(); e.stopPropagation(); if (!e.repeat) Submit.next(); return; }
    if (!s.keyboard) return;

    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (t && t.id === 'qs-host') return;          // typing inside QuickSolve's own ask box

    if (e.key === 'Enter' && this.match(e, c.ctrlSubmit)) {
      e.preventDefault(); e.stopPropagation(); if (!e.repeat) Submit.submit('ctrl'); return;
    }

    if (this.isTyping(t)) return;

    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) {
        const n = +m[1];
        if (n > s.numberKeys || e.repeat) return;
        const o = Ccbp.options()[n - 1];
        if (!o) return;
        e.preventDefault(); e.stopPropagation(); Ccbp.clickOption(o);
        UI.toast('Option ' + n + (o.checked() ? ' selected' : ' toggled'), 'ok');
        return;
      }
    }

    if (this.match(e, c.submit) && !e.repeat) {
      const tag = t && t.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || (t && t.getAttribute && t.getAttribute('role') === 'button')) return;
      e.preventDefault(); e.stopPropagation(); Submit.submit('enter');
    }
  }
};

// ───── prompt ─────
const ASSIST_SYS = 'You are a careful personal assistant for a student doing programming practice (NxtWave CCBP: Python, JavaScript, HTML, CSS, Bootstrap, SQL). Answer the request using the text, any PAGE DATA (a text dump of the whole page: question, options, editor code, field values, test cases) and any attached images / screenshot. If the image shows a multiple-choice question, start with "Option N: <option text>" (options numbered from 1, top to bottom; several correct → "Options 2, 4"), then give a 1–2 sentence reason. If it shows a coding task, give the COMPLETE code in a fenced block, then one line of notes. Obey every constraint in the question about WHICH properties, tags or approach must be used — a mandated technique matters as much as the result. If TEST CASES are given, every FAILED one must be fixed without breaking the PASSED ones. Trace code carefully before stating an output. Be concise, no filler. If something is not visible or unclear, say exactly what is missing.';

const Prompt = {
  BASE: [
    'You are an expert tutor answering practice questions on NxtWave CCBP (Python, JavaScript, HTML, CSS, Bootstrap, SQL, DSA). Correctness matters more than speed.',
    '',
    'HOW TO WORK',
    '1. Read everything: question text, REFERENCE CODE blocks (part of the question), every option, images. If the QUESTION TEXT is empty or unclear, do NOT invent a question: say so in "explanation" and set "confidence" to 0.',
    '2. Code-tracing questions: run the code line by line, tracking every variable. Watch: in-place methods returning None, copies vs references, int vs float division, // and % with negatives, 0-based indexes, exclusive slice ends, string immutability, truthiness, scope, short-circuiting, precedence, string sort order (digits < UPPER < lower), print formatting, JS coercion/hoisting. Compare your result with each option character by character.',
    '3. If the code raises an error, the right option is the one saying so.',
    '4. Concept questions: judge each option separately and eliminate wrong ones. "Select all that apply": check every option on its own.',
    '5. Verify the final choice against the question and the exact option text.',
    '6. If something needed is missing (e.g. an image not received), say so in "explanation" and lower "confidence". Never guess silently.',
    '',
    'OUTPUT',
    'Reply with ONE JSON object only (no fences, no text outside). Put brief private working in "analysis" FIRST (under 150 words for choice/text questions, unlimited for coding), then the answer fields in the shape below.'
  ].join('\n'),

  schema(q) {
    const n = q.options.length;
    if (q.type === 'single_choice' || q.type === 'multiple_choice') {
      const multi = q.type === 'multiple_choice';
      return 'This is a ' + (multi ? 'MULTIPLE-CHOICE question (checkboxes): select EVERY correct option and no others.' : 'SINGLE-CHOICE question (radio buttons): exactly one option is correct.') +
        ' The options are numbered 1 to ' + n + ' in the order listed.\n' +
        (multi ? 'IMPORTANT: "select all that apply" means ONE OR MORE options are correct (often two or more). Never stop at the first correct option. Treat EVERY option as its own true/false statement about the question and fill "verdicts" with one entry for ALL ' + n + ' options: {"n":<option number>,"correct":true|false,"why":"max 8 words"}. Then "option_numbers" must be exactly the n values marked correct.\n' : '') +
        (q.optionImageResults && q.optionImageResults.length ? 'Some options are PICTURES (attached as "Option N image"): in "analysis" first say what each picture shows (logo / app / icon name, any text), then decide.\n' : '') +
        'Shape: {"analysis":"...",' + (multi ? '"verdicts":[{"n":1,"correct":true,"why":"..."},...],' : '') + '"option_numbers":[' + (multi ? '2,4' : '3') + '],"chosen_texts":[' + (multi ? '"<exact text of option 2>","<exact text of option 4>"' : '"<exact text of option 3>"') + '],"confidence":0.0-1.0,"explanation":"..."}\n' +
        '"option_numbers" = the option NUMBERS exactly as listed (1-based). "chosen_texts" = the exact text of each chosen option, copied from the list, in the same order. They must agree.';
    }
    if (q.type === 'text') {
      return 'This is a TEXT-ANSWER question: the page has a box where the answer is typed.\n' +
        'Shape: {"analysis":"...","text":"...","confidence":0.0-1.0,"explanation":"..."}\n' +
        '"text" is ONLY what must be typed into the box, exactly as it should appear: no markdown, no surrounding quotes unless they would really be printed, no labels such as "Output:", no explanation. For output questions give exactly what the program prints, with line breaks written as \\n. For short-answer questions give the shortest complete correct answer.';
    }
    const langs = Array.from(new Set(q.editors.filter(isWritable).map(e => normLang(e.language)).concat(q.languageTabs))).filter(Boolean);
    return 'This is a CODING assignment. Editors / language tabs available: ' + (langs.join(', ') || 'unknown') + '.\n' +
      'Shape: {"analysis":"...","requirements":[{"req":"short rule taken from the instructions","must_contain":["literal text"],"must_not_contain":["literal text"]}],"languages":{' + langs.map(l => '"' + l + '":{"required":true|false,"code":"..."|null}').join(',') + '},"confidence":0.0-1.0,"explanation":"..."}\n' +
      'Rules:\n' +
      '- First fill "requirements" with EVERY rule in the instructions (and every FAILED test case), especially HOW to build it: "use only / do not use" properties, tags, classes, units, selectors, frameworks; exact class names, ids, text, attribute values, image URLs, breakpoints. A mandated technique is as binding as the visual result; add nothing the instructions do not allow. Words in `backticks` or **bold** are exact names/values. Rules may be written inside images.\n' +
      '- "must_contain"/"must_not_contain" = literal strings (only ones you are certain of); your code is machine-checked against them and misses are sent back for repair.\n' +
      '- required=true ONLY for languages you must write or change; otherwise required=false and code=null.\n' +
      '- "code" = the COMPLETE new content of that editor (no diff, no fences). Keep the starter code\'s names, signatures and scaffolding; replace placeholders.\n' +
      '- Follow instructions literally (e.g. "Size >= 576px" = @media (min-width: 576px); add the Bootstrap CDN if told to use it; use the IMAGES urls verbatim). Use the measured colours listed under IMAGES. If a reference image is SUPPLIED, match its layout, order, colours, spacing and text; if not, say so in "explanation".\n' +
      '- HTML must be a valid document, CSS selectors must match the HTML, JS must run without errors.\n' +
      '- Python/other: complete working program; read input and print EXACTLY as the statement/starter says; mentally run the sample and check edge cases (N=0/1, empty, large, negative).';
  },

  system(q) {
    const simple = q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'text';
    const detailed = Settings.cur.detail === 'detailed';
    if (simple) {
      return this.BASE + '\n\n' + this.schema(q) +
        '\n\nANSWER STYLE: Give ONLY the answer. For choice questions: the option number(s) and nothing else of substance. For text questions: exactly the text that can be pasted into the box, with no labels, no quotes, no jargon.' +
        '\n"explanation": ' + (detailed ? 'up to 5 sentences.' : 'ONE short sentence in plain words, no jargon.');
    }
    return this.BASE + '\n\n' + this.schema(q) +
      '\n\nANSWER STYLE (coding): Do NOT shorten, abbreviate or skip anything in the code. Write the full, complete, working solution for every required editor, however long it is. Never use placeholders like "...", "rest of code" or "same as before". The length limit on "analysis" does NOT apply here: use as much space as the problem needs.' +
      '\n"explanation": ONLY the key idea / thought process in 1–3 very short lines (' + (detailed ? 'up to 5 short lines' : 'no more than 3') + '). No code in it.';
  },

  slow: '\n\nTAKE YOUR TIME: reason as long as needed; prefer slow and right. For web-dev tasks list EVERY requirement (tag, class, id, text, attribute, colour, spacing, breakpoint, framework, image URL), build, then check each against your code and fix gaps before answering.',

  content(q) {
    const imgs = q.imageResults || [];
    const choiceOrText = q.type === 'single_choice' || q.type === 'multiple_choice' || q.type === 'text';
    const L = [];
    L.push('QUESTION TYPE (decided from the page controls): ' + q.type);
    if (q.title) L.push('TITLE: ' + q.title);
    L.push('QUESTION TEXT (verbatim):\n' + q.description);
    const ref = q.editors.filter(e => e.kind === 'ace' && (choiceOrText || e.readOnly) && e.code.trim());
    ref.forEach(e => L.push('REFERENCE CODE' + (e.language && e.language !== 'unknown' && e.language !== 'code' ? ' (' + e.language + ')' : '') + ' — shown beside the question, read-only:\n' + e.code));
    if (q.options.length) L.push('OPTIONS (choose by number):\n' + q.options.map(o => (o.index + 1) + '. ' + o.label).join('\n'));
    if (q.type === 'text' && q.textFields.length) L.push('ANSWER BOX placeholder: ' + (q.textFields[0].placeholder || '(none)'));
    if (!choiceOrText) {
      q.editors.filter(isWritable).forEach(e =>
        L.push('EDITOR language=' + normLang(e.language) + (e.id ? ' (id ' + e.id + ')' : '') + (e.empty ? ' — currently empty' : ' — current content:') + (e.empty ? '' : '\n' + e.code)));
      if (q.testCases) L.push('TEST CASES on the page (as of the last Run). Every FAILED case is a hard requirement: add it to "requirements" and satisfy it without breaking PASSED ones:\n' + q.testCases);
      if (q.languageTabs.length) L.push('LANGUAGE TABS ON PAGE: ' + q.languageTabs.join(', ') + ' (only the active tab\'s content is visible to you)');
    }
    if (imgs.length) {
      L.push('IMAGES in the question:\n' + imgs.map(i => 'Image ' + (i.index + 1) + ': ' + (i.supplied ? 'SUPPLIED below' : 'NOT supplied (' + i.reason + ')') +
        ' | url: ' + i.url + (i.w ? ' | size: ' + i.w + 'x' + i.h + 'px' : '') + (i.palette ? ' | measured colours (hex, share of pixels): ' + i.palette : '') + (i.alt ? ' | alt: ' + i.alt : '') + (i.caption ? ' | caption: ' + i.caption : '')).join('\n'));
    }
    const oimgs = q.optionImageResults || [];
    if (oimgs.length) L.push('OPTION IMAGES (the answer options are pictures; each is attached below as "Option N image", N = option number):\n' + oimgs.map(i => i.label + ': ' + (i.supplied ? 'SUPPLIED below' : 'NOT supplied (' + i.reason + ')') + (i.url ? ' | url: ' + i.url : '') + (i.alt ? ' | alt: ' + i.alt : '')).join('\n'));
    return { text: L.join('\n\n'), imgs, oimgs, choiceOrText };
  },

  build(q, extra) {
    const c = this.content(q), imgs = c.imgs, choiceOrText = c.choiceOrText;
    const parts = [{ text: c.text + (extra || '') }];
    imgs.filter(i => i.supplied).forEach(i => {
      parts.push({ text: 'Image ' + (i.index + 1) + ':' });
      parts.push({ inline_data: { mime_type: i.mediaType, data: i.data } });
    });
    c.oimgs.filter(i => i.supplied).forEach(i => {
      parts.push({ text: i.label + ':' });
      parts.push({ inline_data: { mime_type: i.mediaType, data: i.data } });
    });
    return {
      systemInstruction: { parts: [{ text: this.system(q) }] },
      contents: [{ role: 'user', parts }],
      generationConfig: Object.assign({ responseMimeType: 'application/json', maxOutputTokens: choiceOrText ? 6144 : 32768 }, imgs.concat(c.oimgs).some(i => i.supplied) ? { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } : {})
    };
  }
};

// ───── response parser ─────
const Parser = {
  parse(raw, q) {
    let o;
    try {
      let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b < a) throw new Error('no JSON');
      o = JSON.parse(t.slice(a, b + 1));
    } catch (e) { return { ok: false, error: 'AI reply was not valid JSON — try again' }; }

    const res = { type: q.type, selected: [], text: null, code: {},
      confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0,
      explanation: String(o.explanation || '').slice(0, 1500) };

    if (q.type === 'single_choice' || q.type === 'multiple_choice') {
      let nums = o.option_numbers;
      if (q.type === 'multiple_choice' && Array.isArray(o.verdicts) && o.verdicts.length === q.options.length) {   // one true/false per option is more reliable than the summary list
        const v = o.verdicts.filter(x => x && (x.correct === true || x.correct === 'true')).map(x => Number(x.n)).sort((a, b) => a - b);
        if (v.length && v.every(n => Number.isInteger(n) && n >= 1 && n <= q.options.length)) {
          if (!Array.isArray(nums) || nums.map(Number).sort((a, b) => a - b).join() !== v.join()) res.explanation += ' (selection taken from the per-option verdicts)';
          nums = v;
        }
      }
      if (!Array.isArray(nums) && o.answer && Array.isArray(o.answer.selected_options)) nums = o.answer.selected_options.map(i => Number(i) + 1);
      if (!Array.isArray(nums) || !nums.length) return { ok: false, error: 'AI gave no option number' };
      nums = Array.from(new Set(nums.map(Number)));
      if (!nums.every(n => Number.isInteger(n) && n >= 1 && n <= q.options.length)) return { ok: false, error: 'AI chose an option that does not exist' };

      // cross-check numbers against the option TEXT the AI says it chose (guards against off-by-one)
      if (Array.isArray(o.chosen_texts) && o.chosen_texts.length === nums.length) {
        const sq = (s) => String(s).replace(/\s+/g, '');
        const byText = o.chosen_texts.map(t => {
          const hits = q.options.map((op, i) => sq(op.label) === sq(t) ? i : -1).filter(i => i >= 0);
          return hits.length === 1 ? hits[0] : -1;
        });
        if (byText.every(i => i >= 0)) {
          const a = byText.slice().sort((x, y) => x - y).join(), b = nums.map(n => n - 1).sort((x, y) => x - y).join();
          if (a !== b) { nums = byText.map(i => i + 1); res.explanation += ' (number corrected from option text)'; }
        }
      }
      if (q.type === 'single_choice' && nums.length !== 1) return { ok: false, error: 'AI chose ' + nums.length + ' options for a single-choice question' };
      res.selected = nums.map(n => n - 1).sort((x, y) => x - y);
    } else if (q.type === 'text') {
      const t = typeof o.text === 'string' ? o.text : (o.answer && o.answer.text);
      if (typeof t !== 'string' || !t.trim()) return { ok: false, error: 'AI gave an empty text answer' };
      res.text = t.replace(/^\n+|\n+$/g, '');
    } else if (q.type.startsWith('coding')) {
      const langs = o.languages;
      if (!langs || typeof langs !== 'object') return { ok: false, error: 'AI returned no code' };
      res.requirements = Array.isArray(o.requirements) ? o.requirements.filter(r => r && typeof r === 'object').slice(0, 40) : [];
      const known = new Set(q.editors.filter(isWritable).map(e => normLang(e.language)).concat(q.languageTabs));
      for (const k of Object.keys(langs)) {
        const e = langs[k];
        if (!e || e.required !== true) continue;
        const l = normLang(k);
        if (typeof e.code !== 'string' || !e.code.trim()) return { ok: false, error: 'AI returned empty code for ' + l };
        if (!known.has(l)) return { ok: false, error: 'AI wrote ' + l + ' but the page has no such editor' };
        res.code[l] = e.code;
      }
      if (!Object.keys(res.code).length) return { ok: false, error: 'AI returned no code to insert' };
    } else return { ok: false, error: 'Unsupported question type' };
    return { ok: true, data: res };
  }
};

// ───── Gemini client ─────
const AI = {
  call(payload) {
    const s = Settings.cur;
    const key = (s.apiKey || GEMINI_API_KEY || '').trim();
    if (!key) return Promise.reject(new Error('No Gemini API key — paste it at the top of the script or in ⚙ Settings'));
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent((s.model || '').trim() || DEFAULTS.model) + ':generateContent';
    return new Promise((resolve, reject) => {
      GMX.http({
        method: 'POST', url, timeout: 120000,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        data: JSON.stringify(payload),
        onload: (r) => {
          let b = null; try { b = JSON.parse(r.responseText); } catch (e) {}
          const msg = b && b.error && b.error.message ? ': ' + b.error.message.slice(0, 160) : '';
          if (r.status === 400 && /resolution/i.test(msg) && payload.generationConfig && payload.generationConfig.mediaResolution) { delete payload.generationConfig.mediaResolution; return resolve(AI.call(payload)); }   // model without that option → retry plain
          if (r.status === 401 || r.status === 403) return reject(new Error('Gemini auth failed' + msg));
          if (r.status === 400 && /api key/i.test(msg)) return reject(new Error('Invalid Gemini API key'));
          if (r.status === 429) return reject(new Error('Rate limit / free quota reached — wait a bit' + msg));
          if (r.status < 200 || r.status >= 300) return reject(new Error('Gemini error ' + r.status + msg));
          if (!b) return reject(new Error('Gemini returned non-JSON'));
          if (b.promptFeedback && b.promptFeedback.blockReason) return reject(new Error('Gemini blocked the prompt: ' + b.promptFeedback.blockReason));
          const c = b.candidates && b.candidates[0];
          const parts = c && c.content && c.content.parts;
          if (!parts) return reject(new Error('Gemini gave no answer' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '')));
          if (c.finishReason === 'MAX_TOKENS') return reject(new Error('Answer was cut off (too long) — try again'));
          resolve(parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join(''));
        },
        onerror: () => reject(new Error('Network error reaching Gemini')),
        ontimeout: () => reject(new Error('AI request timed out'))
      });
    });
  },

  hasKey(p) { const s = Settings.cur; return !!(((p === 'groq' ? (s.groqKey || GROQ_API_KEY) : (s.apiKey || GEMINI_API_KEY)) || '').trim()); },

  callGroq(system, user, maxTok) {
    const s = Settings.cur;
    const key = (s.groqKey || GROQ_API_KEY || '').trim();
    if (!key) return Promise.reject(new Error('No Groq API key — add it in ⚙ Settings (free at console.groq.com/keys)'));
    const model = s.groqModel || 'openai/gpt-oss-120b';
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_completion_tokens: maxTok || 7000 };
    if (/gpt-oss/i.test(model)) body.reasoning_effort = 'medium';
    return new Promise((resolve, reject) => {
      GMX.http({
        method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions', timeout: 240000,
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
        data: JSON.stringify(body),
        onload: (r) => {
          let b = null; try { b = JSON.parse(r.responseText); } catch (e) {}
          const msg = b && b.error && b.error.message ? ': ' + b.error.message.slice(0, 160) : '';
          if (r.status === 401 || r.status === 403) return reject(new Error('Groq auth failed' + msg));
          if (r.status === 413 || r.status === 429) return reject(new Error('Groq rate limit / request too large' + msg));
          if (r.status < 200 || r.status >= 300) return reject(new Error('Groq error ' + r.status + msg));
          const c = b && b.choices && b.choices[0];
          if (!c || !c.message) return reject(new Error('Groq gave no answer'));
          if (c.finish_reason === 'length') return reject(new Error('Groq answer was cut off — try again'));
          resolve(String(c.message.content || ''));
        },
        onerror: () => reject(new Error('Network error reaching Groq')),
        ontimeout: () => reject(new Error('Groq request timed out'))
      });
    });
  },

  // Groq's gpt-oss is text-only, so a Gemini vision call turns reference images into a precise written spec first.
  async describeImages(imgs) {
    const sup = imgs.filter(i => i.supplied);
    if (!sup.length) return '';
    if (!this.hasKey('gemini')) throw new Error('no Gemini key to read the images');
    const parts = [{ text: 'Describe each image below in precise detail for a developer who must recreate it with HTML/CSS, or who must answer a quiz question about it (name every logo, app, icon or product you recognise, e.g. "Google Calendar icon"): overall layout and element order, EVERY piece of visible text exactly as written (including any instructions, tables or property lists shown inside the image), colours (best-guess hex), relative font sizes/weights, spacing, alignment, borders/shadows, image contents and aspect ratios, and, when the images show different screen widths, exactly how the layout differs (columns, stacking, hidden items). Give estimated pixel sizes (element widths/heights, gaps, paddings, font sizes), using each image\'s natural size as the scale, and note what is centred, equal-width, aligned or overlapping. Label each description with the exact label that precedes the image. Describe only what you see.' }];
    sup.forEach(i => { parts.push({ text: (i.label || 'Image ' + (i.index + 1)) + (i.w ? ' (natural size ' + i.w + 'x' + i.h + 'px)' : '') + ':' }); parts.push({ inline_data: { mime_type: i.mediaType, data: i.data } }); });
    return this.call({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8192, mediaResolution: 'MEDIA_RESOLUTION_HIGH' } });
  },

  async assist(text, images, call) {       // free-form assistant: text + attached images / screenshot → plain-text answer
    const g = this.hasKey('gemini'), r = this.hasKey('groq');
    const useGroq = !images.length && r && (Settings.cur.provider === 'groq' || !g);
    if (call) { call.prov = useGroq ? 'groq' : 'gemini'; call.sys = ASSIST_SYS; call.user = text; call.att = images.map((im, i) => ({ label: im.label || im.name || 'Image ' + (i + 1), kb: Math.round(im.data.length * 0.75 / 1024) })); }
    if (useGroq) return this.callGroq(ASSIST_SYS, text);
    if (!g) throw new Error(images.length ? 'Images need a Gemini key — add it in ⚙ Settings' : 'No API key — add one in ⚙ Settings');
    const parts = [{ text }];
    images.forEach((im, i) => { parts.push({ text: (im.label || 'Image ' + (i + 1)) + ':' }); parts.push({ inline_data: { mime_type: im.mediaType, data: im.data } }); });
    return this.call({ systemInstruction: { parts: [{ text: ASSIST_SYS }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 8192 } });
  }
};

// ───── automatic answer checks (coding) ─────
const Verify = {
  norm(s) { return String(s).replace(/\s+/g, '').toLowerCase(); },
  check(res, q) {
    const issues = [];
    if (q.type === 'multiple_choice') {
      if (/all that apply|select all|choose all|mark all|more than one|one or more/i.test(q.description) && q.options.length > 2 && res.selected.length < 2)
        issues.push('The question asks for ALL correct options, but you selected only ' + res.selected.length + '. Judge EVERY option separately (true/false) and select every correct one — re-check the options you rejected.');
      return issues;
    }
    if (!q.type.startsWith('coding')) return issues;
    const cur = (l) => { const e = q.editors.find(x => isWritable(x) && normLang(x.language) === l); return e ? e.code : ''; };
    const all = {};
    ['html', 'css', 'javascript'].forEach(l => { all[l] = cur(l); });
    Object.keys(res.code).forEach(l => { all[l] = res.code[l]; });
    const blob = this.norm(Object.values(all).join('\n'));
    (res.requirements || []).forEach(r => {
      const why = String(r.req || '').slice(0, 80);
      (Array.isArray(r.must_contain) ? r.must_contain : []).forEach(t => {
        if (typeof t === 'string' && t.trim() && !blob.includes(this.norm(t))) issues.push('Missing "' + t + '" (rule: ' + why + ')');
      });
      (Array.isArray(r.must_not_contain) ? r.must_not_contain : []).forEach(t => {
        if (typeof t === 'string' && t.trim() && blob.includes(this.norm(t))) issues.push('Forbidden "' + t + '" is present (rule: ' + why + ')');
      });
    });
    try { this.htmlCss(all, q, issues); } catch (e) {}
    return issues.slice(0, 12);
  },
  htmlCss(all, q, issues) {
    const html = all.html || '';
    if (!html.trim()) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styles = (all.css || '') + '\n' + Array.from(doc.querySelectorAll('style')).map(x => x.textContent).join('\n');
    if (styles.trim()) {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(styles);
      const bad = new Set();
      const walk = (rules) => Array.from(rules).forEach(r => {
        if (r.selectorText) r.selectorText.split(',').forEach(sel => {
          const k = sel.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
          if (!k || k === '*') return;
          try { if (!doc.querySelector(k)) bad.add(sel.trim()); } catch (e) {}
        });
        else if (r.cssRules) walk(r.cssRules);
      });
      walk(sheet.cssRules);
      bad.forEach(x => issues.push('CSS selector "' + x + '" matches no element in your HTML (ignore only if it targets something JavaScript adds later)'));
    }
    const allowed = new Set(q.images.map(i => i.url));
    doc.querySelectorAll('img[src]').forEach(im => {
      const src = im.getAttribute('src');
      if (/^https?:/i.test(src) && !allowed.has(src) && !q.description.includes(src)) issues.push('<img src="' + src + '"> is not a URL given in the question — use only the image URLs listed under IMAGES');
    });
  }
};

// ───── screen capture (for the ask box) ─────
const Screen = {
  stream: null, video: null,
  stop() { try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch (e) {} this.stream = null; this.video = null; },
  async grab() {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) throw new Error('Screen capture is not available here — attach a screenshot with 📎 (or Win+Shift+S, then paste into the box)');
    if (!this.stream || !this.stream.getVideoTracks().some(t => t.readyState === 'live')) {
      try { this.stream = await md.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true }); }
      catch (e) { throw new Error('Screen capture was cancelled or blocked — attach a screenshot with 📎 instead'); }
      const v = document.createElement('video'); v.muted = true; v.srcObject = this.stream; await v.play(); this.video = v;
      this.stream.getVideoTracks()[0].addEventListener('ended', () => { this.stream = null; this.video = null; });
      await sleep(300);
    }
    const hostEl = UI.host; if (hostEl) hostEl.style.visibility = 'hidden';   // keep the popup out of the screenshot
    await sleep(180);
    try {
      const v = this.video, w0 = v.videoWidth, h0 = v.videoHeight;
      if (!w0) throw new Error('screen capture gave an empty frame');
      const k = Math.min(1, 1800 / Math.max(w0, h0));
      const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return { name: 'screen', mediaType: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.9).split(',')[1] };
    } finally { if (hostEl) hostEl.style.visibility = ''; }
  }
};

// ───── screenshot: html2canvas on the question area only — never the whole app, never screen sharing ─────
const Shot = {
  MAX_NODES: 600,                 // html2canvas runs on the page's main thread; big areas froze the tab, so only small areas are captured
  areas() {                       // [wide area holding question + editors, then just the question pane]
    const root = Ccbp.root(), out = [];
    if (!root || root === document.body) return out;
    const ed = document.querySelector('.ace_editor');
    let n = root;
    if (ed) while (n.parentElement && n.parentElement !== document.body && !n.contains(ed)) n = n.parentElement;
    if (n !== root && (!ed || n.contains(ed))) out.push(n);
    out.push(root);
    return out;
  },
  async el(node) {                 // screenshot of ONE small element (an option drawn as a graphic, not an <img>)
    const H = typeof html2canvas === 'function' ? html2canvas : window.html2canvas;
    if (typeof H !== 'function') throw new Error('Screenshot library did not load');
    const c = await Promise.race([H(node, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', imageTimeout: 4000, ignoreElements: (e) => e.id === 'qs-host' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 8000))]);
    const k = Math.min(1, 1200 / Math.max(c.width, c.height));
    let out = c;
    if (k < 1) { out = document.createElement('canvas'); out.width = Math.round(c.width * k); out.height = Math.round(c.height * k); out.getContext('2d').drawImage(c, 0, 0, out.width, out.height); }
    return { mediaType: 'image/jpeg', data: out.toDataURL('image/jpeg', 0.92).split(',')[1] };
  },
  async take() {
    const H = typeof html2canvas === 'function' ? html2canvas : window.html2canvas;
    if (typeof H !== 'function') throw new Error('Screenshot library did not load');
    const area = this.areas().find(el => el.querySelectorAll('*').length <= this.MAX_NODES);
    if (!area) throw new Error('No question area small enough to capture safely');
    await sleep(60);                                   // let the status text paint before the heavy work
    const c = await Promise.race([
      H(area, { scale: 1, useCORS: true, logging: false, backgroundColor: '#ffffff', foreignObjectRendering: false, imageTimeout: 4000,
        ignoreElements: (el) => el.id === 'qs-host' || /^(IFRAME|VIDEO|OBJECT|EMBED|CANVAS|SVG|SCRIPT|STYLE)$/i.test(el.tagName) || (el.classList && el.classList.contains('ace_editor')) }),   // editor code is already sent as text
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 12000))
    ]);
    const k = Math.min(1, 1800 / Math.max(c.width, c.height));
    let out = c;
    if (k < 1) { out = document.createElement('canvas'); out.width = Math.round(c.width * k); out.height = Math.round(c.height * k); out.getContext('2d').drawImage(c, 0, 0, out.width, out.height); }
    return { name: 'screenshot', mediaType: 'image/jpeg', data: out.toDataURL('image/jpeg', 0.9).split(',')[1] };
  }
};

// ───── layout probe: renders the candidate HTML/CSS in a hidden sandboxed iframe and reads back real geometry ─────
const Probe = {
  async report(code) {
    const html = code.html || '', css = code.css || '';
    if (!html.trim()) return '';
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');                 // no scripts run inside
    f.style.cssText = 'position:fixed;left:-99999px;top:0;width:1100px;height:800px;border:0;visibility:hidden';
    let doc = html;
    if (css.trim()) doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, () => '<style>' + css + '</style></head>') : '<style>' + css + '</style>' + doc;
    f.srcdoc = doc; document.body.appendChild(f);
    try {
      await new Promise(r => { f.onload = r; setTimeout(r, 3000); });
      await sleep(400);
      const d = f.contentDocument, win = f.contentWindow;
      if (!d || !d.body) return '';
      const out = ['(real render of the HTML+CSS; JavaScript and blocked external stylesheets are NOT applied) format: tag#id.class WxH@left,top display color bg fontSize/weight "own text"'];
      for (const w of [1100, 400]) {
        f.style.width = w + 'px'; await sleep(150);
        const rows = [];
        d.body.querySelectorAll('*').forEach(el => {
          if (rows.length >= 45 || /^(SCRIPT|STYLE|LINK|META|BR|SVG|PATH)$/i.test(el.tagName)) return;
          const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
          const cs = win.getComputedStyle(el);
          const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).join(' ').slice(0, 24);
          rows.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + Array.from(el.classList).join('.') : '') + ' ' +
            Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + cs.display + (cs.display.indexOf('flex') >= 0 ? '/' + cs.flexDirection : '') +
            ' ' + cs.color + ' bg:' + cs.backgroundColor + ' ' + cs.fontSize + '/' + cs.fontWeight + (own ? ' "' + own + '"' : ''));
        });
        out.push('--- viewport width ' + w + 'px ---\n' + rows.join('\n'));
      }
      return out.join('\n');
    } finally { f.remove(); }
  }
};

// ───── feedback: posts straight to the Google Form in the background ─────
const Feedback = {
  BASE: 'https://docs.google.com/forms/d/e/1FAIpQLSeq39Q-qYWmkvou_QtoDL3DMCi2UkDFQvn-uQ_kq3VhCiwuIw/',
  cache: null, last: 0,
  _get(url) {
    return new Promise((res, rej) => GMX.http({ method: 'GET', url, anonymous: true, timeout: 15000,
      onload: (r) => r.status >= 200 && r.status < 300 ? res(r.responseText || '') : rej(new Error('Feedback form unavailable (' + r.status + ')')),
      onerror: () => rej(new Error('Network error — check your connection')), ontimeout: () => rej(new Error('Timed out')) }));
  },
  async schema() {                 // reads the form's field ids once, so editing the form later never breaks sending
    if (this.cache) return this.cache;
    const html = await this._get(this.BASE + 'viewform');
    const m = /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/.exec(html);
    if (!m) throw new Error('Could not read the feedback form');
    const items = (JSON.parse(m[1])[1] || [])[1] || [], f = {};
    items.forEach(it => {
      const q0 = it && it[4] && it[4][0]; if (!q0) return;
      const id = 'entry.' + q0[0];
      if (it[3] === 0 && !f.email) f.email = id;
      else if (it[3] === 1 && !f.desc) f.desc = id;
      else if (it[3] === 3 && !f.type) { f.type = id; f.opts = (q0[1] || []).map(o => o[0]); }
    });
    if (!f.email || !f.desc || !f.type) throw new Error('Feedback form fields not recognised');
    return (this.cache = f);
  },
  async send(email, type, text) {
    const f = await this.schema();
    const key = { Feedback: 'fee', Suggestion: 'sug', Issue: 'iss' }[type] || type.slice(0, 3).toLowerCase();
    const opt = (f.opts || []).find(o => String(o).toLowerCase().startsWith(key)) || type;
    const body = new URLSearchParams();
    body.set(f.email, email); body.set(f.type, opt); body.set(f.desc, text); body.set('fvv', '1'); body.set('pageHistory', '0');
    await new Promise((res, rej) => GMX.http({ method: 'POST', url: this.BASE + 'formResponse', anonymous: true, timeout: 20000,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: body.toString(),
      onload: (r) => (r.status >= 200 && r.status < 400 && !/required question|ItemErrorMessage|Something went wrong/i.test(r.responseText || '')) ? res() : rej(new Error('The form did not accept it (' + r.status + ')')),
      onerror: () => rej(new Error('Network error — check your connection')), ontimeout: () => rej(new Error('Timed out')) }));
  }
};

// ───── debug log (what was read, what was sent, what the AI answered) ─────
const Debug = {
  runs: [], sel: null, n: 0, _t: 0,
  begin(kind) {
    const r = { id: ++this.n, kind, t0: Date.now(), at: new Date().toLocaleTimeString(), ms: 0, done: false, steps: [], calls: [], imgs: [], q: null, result: null, apply: '', error: '' };
    this.runs.push(r); if (this.runs.length > 5) this.runs.shift();
    this.sel = null; this.ping(); return r;
  },
  step(r, msg) { if (!r) return; r.steps.push({ t: Date.now() - r.t0, msg: String(msg) }); this.ping(); },
  fail(r, msg) { if (!r) return; r.error = String(msg); this.step(r, '✗ ' + msg); },
  end(r) { if (!r || r.done) return; r.done = true; r.ms = Date.now() - r.t0; this.ping(); },
  pick() { return this.runs.find(x => x.id === this.sel) || this.runs[this.runs.length - 1] || null; },
  ping() { if (this._t) return; this._t = setTimeout(() => { this._t = 0; if (UI.debugOpen) UI.renderDebug(); }, 150); },

  snapQ(q) {
    return { type: q.type, why: (q.classification.reasons || []).join('; '), conf: q.classification.confidence, mode: q.mode, url: q.url, title: q.title, desc: q.description,
      options: q.options.map(o => ({ n: o.index + 1, label: o.label, checked: o.checked, type: o.type })),
      editors: q.editors.map(e => ({ lang: e.language, rw: isWritable(e), len: (e.code || '').length, err: e.error || '' })),
      tabs: q.languageTabs, fields: q.textFields.length, btns: q.buttons.map(b => b.label + (b.enabled ? '' : ' (off)')).join(', '), tests: q.testCases };
  },
  snapImgs(list) {
    return list.map(i => ({ label: i.label || 'Image ' + (i.index + 1), url: i.url || '', supplied: !!i.supplied, reason: i.reason || '', w: i.w, h: i.h, kb: i.data ? Math.round(i.data.length * 0.75 / 1024) : 0, palette: i.palette || '', mt: i.mediaType, data: i.data }));
  },
  snapRes(d, q) {
    return { provider: d.provider, reviewed: d.reviewed, conf: d.confidence, selected: d.selected.map(i => ({ n: i + 1, label: (q.options[i] || {}).label || '' })), text: d.text,
      code: Object.fromEntries(Object.entries(d.code).map(([k, v]) => [k, v.length])), reqs: d.requirements || [], expl: d.explanation, warnings: d.warnings || [] };
  },
  fmtQ(s) {
    const L = ['type: ' + s.type + ' (' + Math.round((s.conf || 0) * 100) + '%) · mode: ' + s.mode, 'why: ' + s.why, 'url: ' + s.url];
    if (s.title) L.push('title: ' + s.title);
    L.push('--- QUESTION TEXT ---', s.desc || '(EMPTY — question text was not found!)', '--- OPTIONS (' + s.options.length + ') ---');
    s.options.forEach(o => L.push(o.n + ' [' + (o.checked ? 'x' : ' ') + '] ' + o.type + ' · ' + o.label));
    L.push('--- EDITORS (' + s.editors.length + ') ---');
    s.editors.forEach(e => L.push(e.lang + ' · ' + (e.rw ? 'writable' : 'read-only') + ' · ' + e.len + ' chars' + (e.err ? ' · ' + e.err : '')));
    if (s.tabs.length) L.push('tabs: ' + s.tabs.join(', '));
    L.push('text fields: ' + s.fields, 'buttons: ' + (s.btns || '-'), '--- TEST CASES ---', s.tests || '(none found)');
    return L.join('\n');
  },
  fmtRes(x) {
    if (!x) return '(no parsed answer)';
    const L = ['provider: ' + x.provider + (x.reviewed ? ' + review by ' + x.reviewed : ''), 'confidence: ' + Math.round(x.conf * 100) + '%'];
    if (x.selected.length) L.push('chosen: ' + x.selected.map(s => s.n + '. ' + s.label).join('  |  '));
    if (x.text) L.push('text: ' + x.text);
    Object.keys(x.code).forEach(k => L.push('code ' + k + ': ' + x.code[k] + ' chars'));
    if (x.reqs.length) { L.push('requirements (' + x.reqs.length + '):'); x.reqs.slice(0, 25).forEach(q => L.push('- ' + String(q.req || '') + (Array.isArray(q.must_contain) && q.must_contain.length ? ' +[' + q.must_contain.join(', ') + ']' : '') + (Array.isArray(q.must_not_contain) && q.must_not_contain.length ? ' -[' + q.must_not_contain.join(', ') + ']' : ''))); }
    L.push('explanation: ' + (x.expl || '-'), 'warnings: ' + (x.warnings.length ? x.warnings.join(' | ') : 'none'));
    return L.join('\n');
  },
  text(r) {
    const L = ['QuickSolve debug #' + r.id + ' (' + r.kind + ') ' + r.at + ' · ' + (((r.done ? r.ms : Date.now() - r.t0)) / 1000).toFixed(1) + 's' + (r.error ? ' · ERROR: ' + r.error : '')];
    L.push('', '## STEPS'); r.steps.forEach(s => L.push('+' + (s.t / 1000).toFixed(1) + 's ' + s.msg));
    if (r.q) L.push('', '## QUESTION AS READ', this.fmtQ(r.q));
    if (r.imgs.length) { L.push('', '## IMAGES'); r.imgs.forEach(i => L.push(i.label + ': ' + (i.supplied ? 'sent ' + i.kb + 'KB' : 'NOT SENT (' + i.reason + ')') + (i.url ? ' ' + i.url : '') + (i.palette ? ' colours ' + i.palette : ''))); }
    r.calls.forEach((c, k) => {
      L.push('', '## AI CALL ' + (k + 1) + ' · ' + c.prov + ' · ' + c.kind + ' · ' + ((c.ms || 0) / 1000).toFixed(1) + 's' + (c.err ? ' · ERROR ' + c.err : ''));
      L.push('attachments: ' + ((c.att || []).map(a => a.label + ' ' + a.kb + 'KB').join(', ') || 'none'), '--- SYSTEM ---', c.sys, '--- SENT ---', c.user);
      if (c.desc) L.push('--- IMAGE DESCRIPTIONS (Gemini → Groq) ---', c.desc);
      L.push('--- REPLY ---', c.raw || '(none)'); if (c.parse) L.push('parse: ' + c.parse);
    });
    if (r.kind === 'solve') L.push('', '## PARSED ANSWER', this.fmtRes(r.result), 'apply: ' + (r.apply || '-'));
    return L.join('\n');
  }
};

// ───── floating panel ─────
const UI = {
  host: null, sr: null, toastT: 0, confirmResolve: null, result: null, hidden: false, attach: [], shotOn: false, pageOn: false, imgOn: false, debugOpen: false, settingsOpen: false, feedbackOpen: false, fbBusy: false, dbgOpen: new Map(),
  q(s) { return this.sr.querySelector(s); },

  init() {
    if (this.host || !document.body) return;
    const host = document.createElement('div');
    host.id = 'qs-host'; host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const sr = host.attachShadow({ mode: 'closed' });
    sr.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box}
*::-webkit-scrollbar{width:3px;height:3px}*::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}
.p{--bg:#fff;--bg2:#f6f7fa;--fg:#1c2230;--mut:#707a8f;--bd:#e4e7ee;--ac:#4f6df5;--ac2:#7a5af8;--ok:#16a34a;--er:#dc2626;--wa:#d97706;--code:#f1f3f8;--r:12px;
 --sh:0 8px 28px rgba(20,28,60,.18),0 1px 4px rgba(20,28,60,.08);
 font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);
 border:1px solid var(--bd);border-radius:var(--r);box-shadow:var(--sh);
 width:min(var(--w,260px),calc(100vw - 16px));
 display:flex;flex-direction:column;max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px);overflow:hidden}
.p.dark{--bg:#14171f;--bg2:#1c202b;--fg:#e8ebf4;--mut:#8f98ae;--bd:#2a3041;--code:#0d0f15;--sh:0 8px 28px rgba(0,0,0,.55)}
@media(prefers-color-scheme:dark){.p.auto{--bg:#14171f;--bg2:#1c202b;--fg:#e8ebf4;--mut:#8f98ae;--bd:#2a3041;--code:#0d0f15;--sh:0 8px 28px rgba(0,0,0,.55)}}

/* header */
.h{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 12px;cursor:move;user-select:none;touch-action:none;border-bottom:1px solid var(--bd);flex:none}
.t{font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--mut);flex:none}
.dot.ok{background:var(--ok)}.dot.err{background:var(--er)}
.dot.busy{background:var(--wa);animation:qs-pulse 1s ease-in-out infinite}
@keyframes qs-pulse{50%{transform:scale(1.4);opacity:.6}}
.st{color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
.h button{flex:none}

/* buttons */
button{font:inherit;font-weight:500;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:8px;padding:5px 10px;cursor:pointer;min-height:28px;transition:background .15s,border-color .15s}
button:hover{background:var(--bg2);border-color:color-mix(in srgb,var(--ac) 40%,var(--bd))}
button:active{transform:translateY(1px)}
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
button.pri{background:var(--ac);border-color:var(--ac);color:#00ff00;font-weight:600}
button.pri:hover{filter:brightness(1.08);background:var(--ac)}
.ic{padding:0;width:26px;height:26px;min-height:0;border-color:transparent;background:transparent;font-size:14px;line-height:1}
.ic:hover{background:color-mix(in srgb,var(--fg) 10%,transparent);border-color:transparent}
button.mode{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button.mode.on{border-color:var(--ok);color:var(--ok)}

/* body: ONE scroll area, nothing inside may shrink */
.b{padding:10px;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;display:flex;flex-direction:column;gap:10px}
.b>*{flex:none;min-width:0}
.row{display:flex;gap:6px;align-items:center;margin:0}
.k{color:var(--mut)}
.ty-row{justify-content:space-between;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut)}
.ty{text-transform:none;letter-spacing:0;font-size:12px;font-weight:600;color:var(--fg)}
.row.main{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.row.main button{padding:5px 4px;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.em{pointer-events:none}.p.sm .em{display:none}

/* confirm / result / messages */
.conf,.res,.msg{margin:0}
.conf{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.conf .row{justify-content:flex-end}
.res,.ans{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;position:relative;min-width:0;
 overflow:auto;max-height:min(42vh,320px);overflow-wrap:anywhere;word-break:break-word}
.res>*,.ans>*{flex:none;margin:0;min-width:0}
.ans{white-space:pre-wrap;max-height:min(38vh,260px)}
.big{font-size:18px;font-weight:800;line-height:1.2;color:var(--ac)}
.res .k{font-size:11px}
.warn-t{color:var(--wa);font-size:11px;background:color-mix(in srgb,var(--wa) 10%,transparent);border-radius:6px;padding:3px 6px}
.msg{font-size:12px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd);border-left:3px solid var(--mut);background:var(--bg2)}
.msg.ok{color:var(--ok);border-left-color:var(--ok)}
.msg.err{color:var(--er);border-left-color:var(--er)}
.msg.warn{color:var(--wa);border-left-color:var(--wa)}
pre{background:var(--code);border:1px solid var(--bd);padding:8px;border-radius:8px;max-height:240px;overflow:auto;margin:0;white-space:pre;font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cw{position:relative}.cw pre{padding:26px 6px 6px}
.cp{position:absolute;top:6px;right:6px;padding:0 8px;font-size:10px;height:22px;min-height:0}
.res .x,.ans .x{position:sticky;top:0;z-index:2;align-self:flex-end;padding:0;width:20px;height:20px;min-height:0;line-height:1;font-size:11px;border-radius:6px;margin-bottom:-26px}
.res>.x+*:not(.cw),.ans>.x+*:not(.cw){padding-right:22px}
.res>.x+.cw .cp,.ans>.x+.cw .cp{right:26px}

/* settings */
.set{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:0 10px 8px}
.sph{display:flex;align-items:center;gap:8px;margin:0 -10px 4px;padding:8px 10px;font-weight:700;position:sticky;top:-10px;background:var(--bg2);border-bottom:1px solid var(--bd);z-index:2;border-radius:10px 10px 0 0}
.set label{display:flex;justify-content:space-between;gap:10px;padding:7px 0;align-items:center;border-bottom:1px dashed var(--bd);font-size:12px}
.set input[type=text],.set input[type=password],.set input[type=number],.set select{width:140px;max-width:55%;font:inherit;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:4px 6px;min-height:26px}
.set input:focus,.set select:focus{border-color:var(--ac)}
.set input[type=range]{width:140px;max-width:55%;padding:0;accent-color:var(--ac)}
.set input[type=checkbox]{appearance:none;-webkit-appearance:none;width:32px;height:18px;border-radius:999px;background:var(--bd);position:relative;cursor:pointer;flex:none;margin:0;transition:background .15s}
.set input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
.set input[type=checkbox]:checked{background:var(--ac)}
.set input[type=checkbox]:checked::after{transform:translateX(14px)}
.p.sp .b>*:not(.set):not(.msg){display:none!important}

/* ask box */
.ask{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--bd);padding-top:8px}
.ask>*{flex:none;min-width:0}
.ask .row{gap:6px;align-items:stretch}
.ask input[type=text]{flex:1;min-width:0;height:26px;font:inherit;font-size:12px;background:var(--bg2);color:var(--fg);border:1px solid var(--bd);border-radius:8px;padding:2px 8px;outline:none}
.ask input[type=text]:focus{border-color:var(--ac);background:var(--bg)}
.ask button[data-a=send]{flex:none;width:30px;padding:0;min-height:0;font-size:12px}
.tools{display:grid!important;grid-template-columns:repeat(2,1fr);gap:6px}
.tools button{min-width:0;min-height:24px;padding:2px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tools button.on{background:color-mix(in srgb,var(--ac) 14%,var(--bg));border-color:var(--ac);color:var(--ac);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:4px}.chips:empty{display:none}
.chips button{font-size:10px;padding:1px 8px;min-height:22px;border-radius:999px}

/* shortcuts */
.hint{font-size:11px;color:var(--mut)}
.hint summary{cursor:pointer;user-select:none;list-style:none;padding:2px 0}
.hint summary::-webkit-details-marker{display:none}
.hint summary::before{content:"▸ ";display:inline-block;transition:transform .15s}
.hint[open] summary::before{transform:rotate(90deg)}
.hint .g{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center;margin-top:6px}
kbd{font:600 10px ui-monospace,Menlo,Consolas,monospace;background:var(--bg2);border:1px solid var(--bd);border-bottom-width:2px;border-radius:5px;padding:1px 5px;color:var(--fg);white-space:nowrap}

/* feedback page + footer + shortcuts */
.p.fp .b>*:not(.fb):not(.msg){display:none!important}
.fb{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:0 10px 10px;display:flex;flex-direction:column;gap:8px;font-size:12px}
.fb .sph{margin:0 -10px 0}
.fb label{display:flex;flex-direction:column;gap:3px;color:var(--mut);font-size:11px}
.fb input[type=text],.fb select,.fb textarea{font:inherit;font-size:12.5px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:5px 7px;width:100%;outline:none}
.fb input:focus,.fb select:focus,.fb textarea:focus{border-color:var(--ac)}
.fb textarea{resize:vertical;min-height:90px}
.fb label.chk{flex-direction:row;align-items:center;gap:6px}
.fb input[type=checkbox]{margin:0}
.fb-st{font-size:11px;min-height:14px}.fb-st.good{color:var(--ok)}.fb-st.bad{color:var(--er)}.fb-st.wait{color:var(--wa)}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--mut);border-top:1px solid var(--bd);padding-top:8px}
.foot b{color:var(--fg)}
.foot button{padding:2px 10px;min-height:24px;font-size:11px}
.hint .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:5px 6px;margin-top:6px}
.hint .sc{display:flex;flex-direction:column;gap:1px;min-width:0}
.hint .sc kbd{align-self:flex-start;font-size:9.5px}
.hint .sc i{font-style:normal;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* debug page */
.p.dp .b>*:not(.dbg):not(.msg){display:none!important}
.dbg{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:0 8px 8px;font-size:11px}
.dbg .sph{margin:0 -8px 6px;padding:6px 8px;gap:6px;font-size:12px}
.dbg .sph button{padding:2px 8px;min-height:24px;font-size:11px}
.sp1{flex:1}
.dbg .pad{padding:8px 0}
.dbg select{width:100%;font:inherit;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:3px;margin:0 0 6px}
.dbg .dl{margin:0 0 6px;overflow-wrap:anywhere}
.dbg details{border-top:1px dashed var(--bd);padding:3px 0}
.dbg details details{margin-left:8px}
.dbg summary{cursor:pointer;font-weight:600;list-style:none;padding:2px 0;overflow-wrap:anywhere}
.dbg summary::-webkit-details-marker{display:none}
.dbg summary::before{content:"▸ ";color:var(--mut)}
.dbg details[open]>summary::before{content:"▾ "}
.dbg pre{white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;font:10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:6px;margin:3px 0}
.dbg .good{color:var(--ok)}.dbg .bad{color:var(--er)}.dbg .wait{color:var(--wa)}
.dbg .im{display:flex;gap:6px;align-items:flex-start;margin:4px 0}
.dbg .im img{width:44px;height:44px;object-fit:contain;background:#fff;border:1px solid var(--bd);border-radius:4px;flex:none}
.dbg .im div{min-width:0;overflow-wrap:anywhere}
[hidden]{display:none!important}
.p.min .b{display:none}.p.min .h{border-bottom:0}

/* responsive */
.p.narrow .tools{grid-template-columns:1fr 1fr}
.p.narrow .set label{flex-direction:column;align-items:stretch;gap:3px}
.p.narrow .set input:not([type=checkbox]),.p.narrow .set select{width:100%;max-width:100%}
.p.narrow .set input[type=checkbox]{align-self:flex-start}
.p.narrow .hint .g{grid-template-columns:1fr}
.p.tiny .st,.p.tiny .hint{display:none}
@media(max-width:520px){.p{font-size:14px}.st{max-width:80px}}
@media(max-height:560px){.res,.ans{max-height:30vh}pre{max-height:160px}}
@media(pointer:coarse){button{min-height:36px}.ic{width:36px;height:36px}.ask input[type=text]{height:38px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
<div class="p auto">
 <div class="h"><span class="dot"></span><span class="t">QuickSolve</span><span class="st">ready</span><button class="ic" data-a="dbg" title="Debug log: what was read / sent / answered">🐞</button><button class="ic" data-a="set" title="Settings">⚙</button><button class="ic" data-a="min" title="Collapse">–</button></div>
 <div class="b">
  <div class="row ty-row"><span class="k">Question type</span><span class="ty">–</span></div>
  <div class="row main"><button class="pri" data-a="solve" title="Alt+A"><span class="em">⚡</span> Solve</button><button class="mode" data-a="mode" title="Alt+M: auto-fill the answer, or only show it">Mode</button><button class="mode" data-a="prov" title="Alt+P: which AI answers">AI</button></div>
  <div class="conf" hidden><div class="cq"></div><div class="row"><button data-a="no">Cancel</button><button class="pri" data-a="yes">Continue</button></div></div>
  <div class="res" hidden></div><div class="msg" hidden></div><div class="set" hidden></div><div class="dbg" hidden></div>
  <div class="fb" hidden>
   <div class="sph"><button data-a="fb">← Back</button><span>Feedback</span></div>
   <label>Email<input type="text" class="fb-email" placeholder="you@example.com"></label>
   <label>Type<select class="fb-type"><option>Feedback</option><option>Suggestion</option><option>Issue</option></select></label>
   <label>Description<textarea class="fb-desc" rows="5" placeholder="What happened, or what would you like?"></textarea></label>
   <label class="chk"><input type="checkbox" class="fb-dbg"> Attach last debug report (helps fix bugs)</label>
   <button class="pri" data-a="fbsend">Send</button>
   <div class="fb-st"></div>
   <div class="k">Sent straight to Aman — no sign-in needed.</div>
  </div>
  <div class="ask"><div class="row"><input type="text" class="ai-in" placeholder="Ask anything… (Alt+K)"><button class="pri" data-a="send" title="Send (Enter)">➤</button></div><div class="row tools"><button data-a="attach" title="Upload image(s) — or paste one into the box">📎 File</button><button class="tg" data-a="page" title="Read every field on the page as text, incl. test cases">📄 Page</button></div><div class="chips"></div><div class="ans" hidden></div><input type="file" class="file" accept="image/*" multiple hidden></div>
  <details class="hint"><summary>Keyboard shortcuts</summary><div class="g3">
   <span class="sc"><kbd>1–9</kbd><i>Option</i></span><span class="sc"><kbd>Enter</kbd><i>Submit</i></span><span class="sc"><kbd>Ctrl+↵</kbd><i>Submit (editor)</i></span>
   <span class="sc"><kbd>Alt+A</kbd><i>Solve</i></span><span class="sc"><kbd>Alt+M</kbd><i>Auto / Show</i></span><span class="sc"><kbd>Alt+P</kbd><i>Switch AI</i></span>
   <span class="sc"><kbd>Alt+N</kbd><i>Next</i></span><span class="sc"><kbd>Alt+K</kbd><i>Ask box</i></span><span class="sc"><kbd>Alt+H</kbd><i>Hide answer</i></span>
   <span class="sc"><kbd>Alt+S</kbd><i>On / Off</i></span><span class="sc"><kbd>Alt+Q</kbd><i>Hide panel</i></span>
  </div></details>
  <div class="foot"><span>Made by <b>Aman</b></span><button data-a="fb" title="Send feedback, a suggestion or a bug report">💬 Feedback</button></div>
 </div></div>`;
    this.host = host; this.sr = sr;
    sr.addEventListener('wheel', (e) => {            // two-finger / wheel scrolling that still works when the page swallows wheel events
      e.stopPropagation();
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      for (const n of e.composedPath()) {
        if (n === sr) break;
        if (n.nodeType !== 1 || n.scrollHeight <= n.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(n).overflowY)) continue;
        if ((n.scrollTop <= 0 && dy < 0) || (n.scrollTop + n.clientHeight >= n.scrollHeight - 1 && dy > 0)) continue;   // at the end → let the parent scroll
        n.scrollTop += dy; e.preventDefault(); return;
      }
    }, { passive: false });
    sr.addEventListener('click', (e) => this.onClick(e));
    sr.addEventListener('toggle', (e) => { const d = e.target; if (d && d.dataset && d.dataset.k) this.dbgOpen.set(d.dataset.k, d.open); }, true);
    sr.addEventListener('change', (e) => this.onChange(e));
    sr.addEventListener('input', (e) => { if (e.target.type === 'range') this.onChange(e); });   // resize live while dragging
    this.drag(this.q('.h'));
    const inp = this.q('.ai-in'), file = this.q('.file');
    ['keydown', 'keyup', 'keypress'].forEach(ev => inp.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev === 'keydown' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); Main.assist(); }
    }));
    inp.addEventListener('paste', (e) => {
      const fs = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.startsWith('image/'));
      if (fs.length) { e.preventDefault(); this.addFiles(fs); }
    });
    file.addEventListener('change', () => { this.addFiles(Array.from(file.files)); file.value = ''; });
    ['keydown', 'keyup', 'keypress'].forEach(ev => this.q('.fb').addEventListener(ev, (e) => e.stopPropagation()));   // typing in the feedback form must not trigger page shortcuts
    this.buildSettings();
    document.body.appendChild(host);
    const p = Settings.cur.pos; if (p) { host.style.left = p.x + 'px'; host.style.top = p.y + 'px'; host.style.right = host.style.bottom = 'auto'; }
    Settings.onChange(() => this.sync()); this.sync();
  },

  sync() {
    const s = Settings.cur, p = this.q('.p');
    const w = Math.max(200, Math.min(500, +s.width || 260));
    p.className = 'p ' + s.theme + (s.minimized ? ' min' : '') + (s.answerVisible ? '' : ' hid') + (w < 250 ? ' narrow' : '') + (w < 220 ? ' tiny' : '') + (w < 260 ? ' sm' : '') + (this.settingsOpen ? ' sp' : '') + (this.debugOpen ? ' dp' : '') + (this.feedbackOpen ? ' fp' : '');
    this.q('.set').hidden = !this.settingsOpen; this.q('.dbg').hidden = !this.debugOpen; this.q('.fb').hidden = !this.feedbackOpen;
    p.style.setProperty('--w', w + 'px');
    if (this.host.style.left) this.host.style.left = Math.max(0, Math.min(parseFloat(this.host.style.left) || 0, innerWidth - w - 8)) + 'px';   // keep it on screen when widened
    const m = this.q('[data-a="mode"]');
    m.textContent = s.autoApply ? '✓ Auto' : '○ Show';
    m.className = 'mode' + (s.autoApply ? ' on' : '');
    this.q('[data-a="prov"]').textContent = 'AI: ' + ({ auto: 'Both', gemini: 'Gemini', groq: 'Groq' }[s.provider] || s.provider);
    this.sr.querySelectorAll('[data-s]').forEach(i => {       // keep checkboxes / selects in step with the shortcuts
      const k = i.dataset.s, v = k.startsWith('keys.') ? s.keys[k.slice(5)] : s[k];
      if (i.type === 'checkbox') i.checked = !!v; else if (i.tagName === 'SELECT') i.value = v;
    });
    if (!s.enabled) this.setStatus('disabled', 'err');
    this.renderResult(); this.renderAns();
    if (this.debugOpen) this.renderDebug();
  },

  setStatus(text, kind) { this.q('.st').textContent = text; this.q('.dot').className = 'dot ' + (kind || ''); },
  setType(t) { this.q('.ty').textContent = t; },

  toast(msg, kind) {
    if (!this.host) return;
    const m = this.q('.msg'); m.textContent = msg; m.className = 'msg ' + (kind || ''); m.hidden = false;
    clearTimeout(this.toastT); this.toastT = setTimeout(() => { m.hidden = true; }, 4500);
  },

  confirm(text) {
    return new Promise(res => { this.q('.cq').textContent = text; this.q('.conf').hidden = false; this.confirmResolve = res; });
  },

  showResult(q, r) { this.result = { q, r }; this.renderResult(); setTimeout(() => { const e = this.q('.res'); if (!e.hidden) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); },
  renderResult() {
    const el = this.q('.res'); el.textContent = '';
    const d = this.result;
    if (!d) { el.hidden = true; return; }
    const xb = document.createElement('button'); xb.className = 'x'; xb.textContent = '✕'; xb.title = 'Close this answer'; xb.dataset.a = 'closeres'; el.appendChild(xb);
    if (!Settings.cur.answerVisible) {
      const n = document.createElement('div'); n.className = 'k'; n.textContent = 'Answer hidden'; el.appendChild(n);
      if (!Settings.cur.autoApply) { const b = document.createElement('button'); b.textContent = 'Fill answer'; b.dataset.a = 'apply'; el.appendChild(b); }
      el.hidden = false; return;
    }
    const add = (tag, txt, cls) => { const n = document.createElement(tag); n.textContent = txt; if (cls) n.className = cls; el.appendChild(n); return n; };
    const r = d.r;
    if (r.selected.length) {
      add('div', (r.selected.length > 1 ? 'Options ' : 'Option ') + r.selected.map(i => i + 1).join(', '), 'big');
      r.selected.forEach(i => add('div', (i + 1) + '. ' + d.q.options[i].label));
    }
    if (r.text) this.codeBox(el, r.text);
    Object.keys(r.code).forEach(l => { add('div', l.toUpperCase(), 'k'); this.codeBox(el, r.code[l]); });
    add('div', 'Confidence ' + Math.round(r.confidence * 100) + '%' + (r.provider ? ' · ' + (r.provider === 'groq' ? 'Groq' : 'Gemini') : ''), 'k');
    if (r.explanation) add('div', r.explanation, 'k');
    if (r.reqCount) add('div', '✓ ' + r.reqCount + ' requirement(s) checked automatically', 'k');
    (r.warnings || []).forEach(w => add('div', '⚠ ' + w, 'warn-t'));
    if (r.imgNote) add('div', r.imgNote, 'k');
    if (r.reviewed) add('div', '✓ second opinion by ' + (r.reviewed === 'groq' ? 'Groq' : 'Gemini'), 'k');
    if (!Settings.cur.autoApply) { const b = add('button', 'Fill answer'); b.dataset.a = 'apply'; }
    el.hidden = false;
  },
  clearResult() { this.result = null; this.renderResult(); },

  async sendFeedback() {
    if (this.fbBusy) return;
    const em = this.q('.fb-email').value.trim(), ty = this.q('.fb-type').value, ds = this.q('.fb-desc').value.trim(), st = this.q('.fb-st'), btn = this.q('[data-a="fbsend"]');
    const say = (t, k) => { st.textContent = t; st.className = 'fb-st ' + (k || ''); };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Enter a valid email address', 'bad');
    if (ds.length < 5) return say('Please write a few words in Description', 'bad');
    if (Date.now() - Feedback.last < 15000) return say('Please wait a few seconds before sending again', 'bad');
    let text = ds;
    if (this.q('.fb-dbg').checked) { const r = Debug.pick(); if (r) text += '\n\n--- DEBUG REPORT ---\n' + Debug.text(r); }
    text = text.slice(0, 12000);
    this.fbBusy = true; btn.disabled = true; say('Sending…', 'wait');
    try {
      await Feedback.send(em, ty, text);
      Feedback.last = Date.now(); this.q('.fb-desc').value = ''; Settings.set({ fbEmail: em });
      say('✓ Sent — thank you!', 'good');
    } catch (e) { say('✗ ' + (e.message || e), 'bad'); }
    finally { this.fbBusy = false; btn.disabled = false; }
  },

  renderDebug() {
    const el = this.q('.dbg'); if (!el) return;
    const b = this.q('.b'), st = b.scrollTop, r = Debug.pick();
    const E = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const D = (k, t, body, def) => '<details data-k="' + k + '"' + ((this.dbgOpen.has(k) ? this.dbgOpen.get(k) : def) ? ' open' : '') + '><summary>' + t + '</summary>' + body + '</details>';
    const P = (t) => '<pre>' + E(t) + '</pre>';
    const sec = (ms) => (ms / 1000).toFixed(1) + 's';
    let h = '<div class="sph"><button data-a="dbg">← Back</button><span>Debug</span><span class="sp1"></span><button data-a="dcopy">Copy</button><button data-a="dclear">Clear</button></div>';
    if (!r) h += '<div class="k pad">Nothing yet. Press ⚡ Solve or ➤, then open 🐞 again.</div>';
    else {
      h += '<select data-d="run">' + Debug.runs.slice().reverse().map(x => '<option value="' + x.id + '"' + (x.id === r.id ? ' selected' : '') + '>#' + x.id + ' ' + x.kind + ' · ' + x.at + (x.error ? ' ✗' : '') + '</option>').join('') + '</select>';
      h += '<div class="dl">' + (r.error ? '<span class="bad">✗ ' + E(r.error) + '</span>' : r.done ? '<span class="good">✓ finished</span>' : '<span class="wait">… running</span>') + ' · ' + sec(r.done ? r.ms : Date.now() - r.t0) + (r.q ? ' · ' + E(r.q.type) : '') + '</div>';
      h += D('steps', 'Steps (' + r.steps.length + ')', P(r.steps.map(x => '+' + sec(x.t) + ' ' + x.msg).join('\n')), !!r.error);
      if (r.q) h += D('q', 'Question as read · ' + E(r.q.type) + ' · ' + r.q.options.length + ' opt', P(Debug.fmtQ(r.q)), false);
      if (r.imgs.length) {
        const ok = r.imgs.filter(i => i.supplied).length;
        h += D('imgs', 'Images ' + ok + '/' + r.imgs.length + ' sent', r.imgs.map(i => '<div class="im">' + (i.data ? '<img src="data:' + E(i.mt || 'image/jpeg') + ';base64,' + i.data + '">' : '') + '<div><b>' + E(i.label) + '</b> ' + (i.supplied ? i.kb + 'KB' : '<span class="bad">NOT SENT: ' + E(i.reason) + '</span>') + (i.w ? ' · ' + i.w + '×' + i.h : '') + (i.palette ? '<br>' + E(i.palette) : '') + (i.url ? '<br>' + E(i.url.slice(0, 90)) : '') + '</div></div>').join(''), false);
      }
      r.calls.forEach((c, k) => {
        const key = 'c' + r.id + '_' + k, att = (c.att || []).map(a => a.label + ' ' + a.kb + 'KB').join(', ') || 'none';
        h += D(key, 'AI call ' + (k + 1) + ' · ' + E(c.prov || '?') + ' · ' + E(c.kind) + ' · ' + sec(c.ms || Date.now() - c.t0) + (c.err ? ' <span class="bad">✗</span>' : c.raw ? ' <span class="good">✓</span>' : ' …'),
          '<div class="dl">images attached: ' + E(att) + (c.parse ? '<br>' + E(c.parse) : '') + (c.err ? '<br><span class="bad">' + E(c.err) + '</span>' : '') + '</div>' +
          D(key + 'u', 'Sent to AI (' + (c.user || '').length + ' chars)', P(c.user), false) +
          (c.desc ? D(key + 'd', 'Image descriptions (Gemini → Groq)', P(c.desc), false) : '') +
          D(key + 'r', 'AI reply (' + (c.raw || '').length + ' chars)', P(c.raw || '(nothing yet)'), true) +
          D(key + 's', 'System prompt (' + (c.sys || '').length + ' chars)', P(c.sys), false), k === r.calls.length - 1);
      });
      if (r.kind === 'solve') h += D('res', 'Parsed answer' + (r.result && r.result.selected.length ? ' · opt ' + r.result.selected.map(x => x.n).join(',') : ''), P(Debug.fmtRes(r.result) + '\napply: ' + (r.apply || '-')), true);
    }
    el.innerHTML = h; b.scrollTop = st;
  },

  async addFiles(files) {
    for (const f of files.slice(0, 6)) {
      try { const r = await Images.normalize(new Uint8Array(await f.arrayBuffer()), f.type); this.attach.push({ name: f.name || 'pasted image', mediaType: r.mediaType, data: r.data }); }
      catch (e) { this.toast('Could not read ' + (f.name || 'image') + ': ' + e.message, 'err'); }
    }
    this.attach = this.attach.slice(0, 6); this.renderChips();
  },
  renderChips() {
    const c = this.q('.chips'); c.textContent = '';
    this.attach.forEach((a, i) => { const b = document.createElement('button'); b.textContent = (a.name.length > 14 ? a.name.slice(0, 12) + '…' : a.name) + ' ✕'; b.dataset.a = 'rm'; b.dataset.i = i; c.appendChild(b); });
  },
  showAnswer(text) { this.ansText = String(text || ''); this.renderAns(); setTimeout(() => { const e = this.q('.ans'); if (!e.hidden) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); },
  renderAns() {
    const el = this.q('.ans'); el.textContent = '';
    if (!this.ansText) { el.hidden = true; return; }
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Close this answer'; x.dataset.a = 'closeans'; el.appendChild(x);
    if (!Settings.cur.answerVisible) { const n = document.createElement('div'); n.className = 'k'; n.textContent = 'Answer hidden'; el.appendChild(n); el.hidden = false; return; }
    let any = false;
    this.ansText.split(/```[a-zA-Z0-9+#-]*\n?/).forEach((seg, i) => {
      if (!seg.trim()) return;
      if (i % 2) this.codeBox(el, seg.replace(/\n$/, ''));
      else { const n = document.createElement('div'); n.textContent = seg.trim(); el.appendChild(n); }
      any = true;
    });
    el.hidden = !any;
  },
  codeBox(parent, text) {          // code / pasteable text with a small Copy button
    const w = document.createElement('div'); w.className = 'cw';
    const pr = document.createElement('pre'); pr.textContent = text;
    const b = document.createElement('button'); b.className = 'cp'; b.dataset.a = 'copy'; b.textContent = 'Copy'; b.title = 'Copy to clipboard';
    w.appendChild(pr); w.appendChild(b); parent.appendChild(w);
  },
  copy(text, btn) {
    const done = () => { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); };
    const fb = () => {
      const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px;opacity:0';
      this.sr.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { this.toast('Copy failed — select the text and press Ctrl+C', 'err'); }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb); else fb();
  },
  focusAsk() { if (Settings.cur.minimized) Settings.set({ minimized: false }); if (this.hidden) Main.toggleHidden(); this.q('.ai-in').focus(); },

  onClick(e) {
    const a = e.target.dataset && e.target.dataset.a; if (!a) return;
    if (a === 'solve') Main.solve();
    else if (a === 'vis') Main.toggleVisible();
    else if (a === 'mode') Main.toggleAuto();
    else if (a === 'prov') Main.cycleProvider();
    else if (a === 'attach') this.q('.file').click();
    else if (a === 'send') Main.assist();
    else if (a === 'rm') { this.attach.splice(+e.target.dataset.i, 1); this.renderChips(); }
    else if (a === 'shot' || a === 'page') {
      const k = a === 'shot' ? 'shotOn' : 'pageOn'; this[k] = !this[k]; e.target.classList.toggle('on', this[k]);
      this.toast(a === 'shot' ? (this.shotOn ? 'A screenshot will be attached when you send' : 'Screenshot off') : (this.pageOn ? 'The whole page (all fields + test cases) will be read when you send' : 'Page reading off'), 'ok');
    }
    else if (a === 'img') { this.imgOn = !this.imgOn; e.target.classList.toggle('on', this.imgOn); this.toast(this.imgOn ? 'Page images will be sent with 📄 Page' : 'Page images off', 'ok'); }
    else if (a === 'closeans') { this.ansText = ''; this.renderAns(); }
    else if (a === 'copy') { const pre = e.target.parentElement && e.target.parentElement.querySelector('pre'); if (pre) this.copy(pre.textContent, e.target); }
    else if (a === 'apply') Main.apply();
    else if (a === 'closeres') this.clearResult();
    else if (a === 'set') { this.settingsOpen = !this.settingsOpen; if (this.settingsOpen) this.debugOpen = this.feedbackOpen = false; this.sync(); }
    else if (a === 'dbg') { this.debugOpen = !this.debugOpen; if (this.debugOpen) this.settingsOpen = this.feedbackOpen = false; this.sync(); }
    else if (a === 'fb') { this.feedbackOpen = !this.feedbackOpen; if (this.feedbackOpen) { this.settingsOpen = this.debugOpen = false; const i = this.q('.fb-email'); if (!i.value) i.value = Settings.cur.fbEmail || ''; } this.sync(); }
    else if (a === 'fbsend') this.sendFeedback();
    else if (a === 'dcopy') { const r = Debug.pick(); if (r) this.copy(Debug.text(r), e.target); else this.toast('Nothing to copy yet', 'warn'); }
    else if (a === 'dclear') { Debug.runs = []; Debug.sel = null; this.renderDebug(); }
    else if (a === 'min') Settings.set({ minimized: !Settings.cur.minimized });          // the "Fill answer" button had no handler
    else if (a === 'yes' || a === 'no') { this.q('.conf').hidden = true; if (this.confirmResolve) this.confirmResolve(a === 'yes'); this.confirmResolve = null; }
  },
  onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.d === 'run') { Debug.sel = +t.value; this.renderDebug(); return; }
    const k = t.dataset && t.dataset.s; if (!k) return;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Math.max(200, Math.min(500, +t.value || 260)) : t.type === 'number' ? Math.max(1, Math.min(9, +t.value || 9)) : t.value;
    if (k.startsWith('keys.')) Settings.set({ keys: { [k.slice(5)]: v } }); else Settings.set({ [k]: v });
    if (k === 'autoSubmit' && v) this.toast('Auto-submit is on: applied answers will be submitted', 'warn');
  },

  buildSettings() {
    const F = [['width', 'Popup width (200–500px)', 'range'], ['enabled', 'QuickSolve on', 'checkbox'], ['keyboard', 'Keyboard engine', 'checkbox'], ['numberKeys', 'Number keys (1–N)', 'number'],
      ['keys.submit', 'Submit key', 'text'], ['keys.ctrlSubmit', 'Submit in editors', 'text'], ['keys.next', 'Next key', 'text'], ['keys.ai', 'AI key', 'text'], ['keys.toggle', 'Visibility key', 'text'], ['keys.power', 'On/off key', 'text'],
      ['autoApply', 'Auto-fill answer', 'checkbox'], ['keys.mode', 'Auto-fill key', 'text'], ['autoSubmit', 'Auto-submit', 'checkbox'], ['submitUnanswered', 'Allow unanswered submit', 'checkbox'],
      ['detail', 'AI detail', 'select:short,detailed'], ['theme', 'Theme', 'select:auto,light,dark'],
      ['provider', 'AI provider (auto = both)', 'select:auto,gemini,groq'], ['apiKey', 'Gemini API key', 'password'], ['model', 'Gemini model', 'text'],
      ['groqKey', 'Groq API key', 'password'], ['groqModel', 'Groq model', 'text'],
      ['review', 'Second-opinion review (web-dev)', 'checkbox'], ['keys.hide', 'Hide panel key', 'text'], ['keys.ask', 'Ask box key', 'text'], ['keys.provider', 'AI provider key', 'text']];
    const box = this.q('.set');
    const hd = document.createElement('div'); hd.className = 'sph';
    const back = document.createElement('button'); back.textContent = '← Back'; back.dataset.a = 'set';
    hd.appendChild(back); hd.appendChild(document.createTextNode('Settings')); box.appendChild(hd);
    F.forEach(([k, label, type]) => {
      const l = document.createElement('label'); l.append(document.createTextNode(label));
      let i;
      if (type.startsWith('select:')) { i = document.createElement('select'); type.slice(7).split(',').forEach(o => { const op = document.createElement('option'); op.value = op.textContent = o; i.appendChild(op); }); }
      else { i = document.createElement('input'); i.type = type; if (type === 'range') { i.min = 200; i.max = 500; i.step = 10; } }
      i.dataset.s = k;
      const cur = k.startsWith('keys.') ? Settings.cur.keys[k.slice(5)] : Settings.cur[k];
      if (type === 'checkbox') i.checked = !!cur; else i.value = cur == null ? '' : cur;
      l.appendChild(i); box.appendChild(l);
    });
    const w = document.createElement('div'); w.className = 'warn-t';
    w.textContent = 'Your key is stored in the userscript. Do not share this script after adding it.';
    box.appendChild(w);
  },

  drag(handle) {
    let sx, sy, ox, oy, on = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = this.host.getBoundingClientRect(); on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!on) return;
      const x = Math.max(0, Math.min(innerWidth - 60, ox + e.clientX - sx)), y = Math.max(0, Math.min(innerHeight - 30, oy + e.clientY - sy));
      this.host.style.left = x + 'px'; this.host.style.top = y + 'px'; this.host.style.right = this.host.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', () => {
      if (!on) return; on = false;
      const r = this.host.getBoundingClientRect(); Settings.set({ pos: { x: Math.round(r.left), y: Math.round(r.top) } });
    });
  }
};

// ───── main ─────
const TYPE_LABEL = { single_choice: 'Single choice', multiple_choice: 'Multiple choice', text: 'Text answer', coding_single_language: 'Coding', coding_multi_language: 'Coding (multi-language)', unknown: 'Unknown' };

const Main = {
  busy: false, busyA: false, last: null, _desc: '', _descFor: '',

  togglePower() {
    Settings.set({ enabled: !Settings.cur.enabled });
    UI.setStatus(Settings.cur.enabled ? 'ready' : 'disabled', Settings.cur.enabled ? 'ok' : 'err');
  },
  toggleVisible() { Settings.set({ answerVisible: !Settings.cur.answerVisible }); },
  toggleHidden() { if (!UI.host) return; UI.hidden = !UI.hidden; UI.host.style.display = UI.hidden ? 'none' : ''; },
  cycleProvider() {
    const o = ['auto', 'gemini', 'groq'], n = o[(o.indexOf(Settings.cur.provider) + 1) % 3];
    Settings.set({ provider: n });
    UI.toast('AI: ' + { auto: 'Both — web-dev questions use Groq, the rest Gemini', gemini: 'Gemini only', groq: 'Groq only' }[n], 'ok');
  },

  isWebDev(q) {
    const langs = q.editors.filter(e => e.kind === 'ace').map(e => normLang(e.language)).concat(q.languageTabs);
    if (langs.some(l => l === 'html' || l === 'css')) return true;
    return /\b(html|css|bootstrap|flexbox|media quer\w*|responsive|navbar|viewport)\b|<\/?[a-z][a-z0-9]*[^>]*>/i.test((q.title || '') + ' ' + q.description);
  },

  async runGroq(q, extra, call) {
    const c = Prompt.content(q), allImgs = c.imgs.concat(c.oimgs);
    let text = c.text;
    if (allImgs.some(i => i.supplied)) {
      if (!(this._descFor === q.fingerprint && this._desc)) {
        UI.setStatus('reading images…', 'busy');
        try { this._desc = await AI.describeImages(allImgs); this._descFor = q.fingerprint; }
        catch (e) { throw new Error('Groq cannot see images and Gemini could not describe them (' + e.message + ')'); }
      }
      text = text.replace(/SUPPLIED below/g, 'described under IMAGE DESCRIPTIONS');
      text += '\n\nIMAGE DESCRIPTIONS (written by a vision model — you cannot see the images; treat these as the reference design and as part of the instructions):\n' + this._desc;
    }
    if (call) { call.sys = Prompt.system(q) + Prompt.slow; call.user = text + (extra || ''); call.desc = allImgs.some(i => i.supplied) ? this._desc : ''; call.att = allImgs.filter(i => i.supplied).map(i => ({ label: (i.label || 'Image ' + (i.index + 1)) + ' (as text)', kb: Math.round(i.data.length * 0.75 / 1024) })); }
    return AI.callGroq(Prompt.system(q) + Prompt.slow, text + (extra || ''), GROQ_MAX_OUT);
  },

  imgNote(q, prov) {
    const ir = (q.imageResults || []).concat(q.optionImageResults || []); if (!ir.length) return '';
    const ok = ir.filter(i => i.supplied).length;
    const bad = ir.filter(i => !i.supplied).map(i => (i.label || '#' + (i.index + 1)) + ' ' + i.reason);
    return '🖼 ' + ok + '/' + ir.length + ' image(s) ' + (prov === 'groq' ? 'read by Gemini, passed to Groq as text' : 'sent to Gemini') + (bad.length ? ' · FAILED: ' + bad.join('; ') : '');
  },

  async readPage() {                 // everything on the page as text (+ the question's images; + other page images when 🖼 Imgs is on)
    Observer.version++;
    const q = await Extractor.extract();
    const L = [], images = [], seen = new Set();
    if (q) {
      if (q.title) L.push('TITLE: ' + q.title);
      L.push('QUESTION TYPE: ' + q.type);
      L.push('QUESTION TEXT:\n' + q.description);
      q.editors.filter(e => e.kind === 'ace' && e.code && e.code.trim()).forEach(e => L.push('EDITOR (' + e.language + (e.readOnly ? ', read-only' : '') + '):\n' + e.code));
      if (q.options.length) L.push('OPTIONS:\n' + q.options.map(o => (o.index + 1) + '. ' + o.label + (o.checked ? '   [currently selected]' : '')).join('\n'));
      try { (await Images.fetchAll(q.images)).filter(i => i.supplied).forEach(i => { seen.add(i.url); images.push({ name: 'page image', label: 'Question image ' + (i.index + 1), mediaType: i.mediaType, data: i.data }); }); } catch (e) {}
      if (q.options.length) { try { (await Images.fetchAll(Images.collectOptions())).filter(i => i.supplied).forEach(i => { seen.add(i.url); images.push({ name: i.label, label: i.label, mediaType: i.mediaType, data: i.data }); }); } catch (e) {} }
    }
    if (UI.imgOn) {                  // images from the description or elsewhere on the page — never header / logo / icons
      try {
        const extra = Images.collectPage().filter(i => !seen.has(i.url)).slice(0, 6).map((im, k) => Object.assign(im, { index: k }));
        (await Images.fetchAll(extra)).filter(i => i.supplied).forEach(i => images.push({ name: 'page image', mediaType: i.mediaType, data: i.data }));
      } catch (e) {}
    }
    { const tc = Ccbp.testCasesText(); if (tc) L.push('TEST CASES (✓ PASSED / FAILED):\n' + tc); }
    const fv = [];
    document.querySelectorAll('textarea,input').forEach(el => {
      const ty = (el.type || '').toLowerCase();
      if (el.closest(EDITOR_SEL) || el.classList.contains('ace_text-input') || ['radio', 'checkbox', 'file', 'hidden', 'button', 'submit'].includes(ty) || !Dom.visible(el)) return;
      fv.push((el.getAttribute('placeholder') || el.id || el.name || el.tagName.toLowerCase()) + ': ' + ((el.value || '').trim() || '(empty)'));
    });
    if (fv.length) L.push('FIELD VALUES:\n' + fv.join('\n'));
    L.push('FULL PAGE TEXT (everything visible):\n' + (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 12000));
    return { text: L.join('\n\n'), images };
  },

  async assist() {
    if (this.busyA) return UI.toast('Already answering', 'warn');
    const inp = UI.q('.ai-in'); let text = inp.value.trim();
    const imgs = UI.attach.slice();
    if (!text && !imgs.length && !UI.shotOn && !UI.pageOn) return UI.toast('Type something, attach a file, or turn on 📷 / 📄', 'warn');
    this.busyA = true;
    const dr = Debug.begin('ask'), call = { prov: '', kind: 'ask', t0: Date.now(), sys: '', user: '', att: [], raw: '', err: '', ms: 0 };
    dr.calls.push(call);
    Debug.step(dr, 'typed: "' + text.slice(0, 80) + '" · files ' + imgs.length + ' · page ' + (UI.pageOn ? 'on' : 'off') + ' · imgs ' + (UI.imgOn ? 'on' : 'off') + ' · shot ' + (UI.shotOn ? 'on' : 'off'));
    try {
      let pageCtx = '';
      if (UI.pageOn) { UI.setStatus('reading page…', 'busy'); const pg = await this.readPage(); pageCtx = pg.text; pg.images.forEach(i => imgs.push(i)); }
      let shotOk = false;
      if (UI.shotOn) {
        UI.setStatus('taking screenshot…', 'busy');
        try { imgs.push(await Shot.take()); shotOk = true; }
        catch (e) {                              // no screen-share prompt: read the page as text instead
          UI.toast(e.message + ' — reading the page as text instead', 'warn');
          if (!pageCtx) { const pg = await this.readPage(); pageCtx = pg.text; pg.images.forEach(i => imgs.push(i)); }
        }
      }
      if (!text) text = pageCtx ? 'Answer the question described in the PAGE DATA.' : 'Answer the question shown in the image(s).';
      if (shotOk) text += '\n(The last image is a screenshot of my screen.)';
      if (pageCtx) text += '\n\nPAGE DATA:\n' + pageCtx;
      UI.setStatus('thinking…', 'busy');
      dr.imgs = imgs.map((im, i) => ({ label: im.label || im.name || 'Image ' + (i + 1), supplied: true, mt: im.mediaType, kb: Math.round(im.data.length * 0.75 / 1024), data: im.data, url: '', reason: '', w: 0, h: 0, palette: '' }));
      Debug.step(dr, 'sending ' + text.length + ' chars + ' + imgs.length + ' image(s)' + (pageCtx ? ' (page data included)' : ''));
      const ans = await AI.assist(text, imgs, call);
      call.raw = ans; Debug.step(dr, 'reply received (' + ans.length + ' chars)');
      UI.showAnswer(ans);
      UI.setStatus('answer ready', 'ok');
      inp.value = ''; UI.attach = []; UI.renderChips();
    } catch (e) { UI.setStatus('error', 'err'); UI.toast(e.message || String(e), 'err'); call.err = e.message || String(e); Debug.fail(dr, call.err); }
    finally { this.busyA = false; call.ms = Date.now() - call.t0; Debug.end(dr); }
  },

  async ask(q, dr) {                   // Gemini only / Groq only / auto (web-dev → Groq, else Gemini; falls back to the other on error)
    const mode = Settings.cur.provider;
    const first = mode === 'gemini' || mode === 'groq' ? mode : (this.isWebDev(q) ? 'groq' : 'gemini');
    const order = mode === 'auto' ? [first, first === 'groq' ? 'gemini' : 'groq'] : [first];
    let lastErr = null;
    for (const prov of order) {
      if (!AI.hasKey(prov)) { lastErr = lastErr || new Error('No ' + (prov === 'groq' ? 'Groq' : 'Gemini') + ' API key — add it in ⚙ Settings'); continue; }
      try {
        UI.setStatus('thinking (' + (prov === 'groq' ? 'Groq' : 'Gemini') + ')…', 'busy');
        Debug.step(dr, 'asking ' + (prov === 'groq' ? 'Groq' : 'Gemini'));
        const runOn = async (pv, extra, kind) => {
          const call = { prov: pv, kind: kind || 'first', t0: Date.now(), sys: '', user: '', att: [], raw: '', err: '', ms: 0 };
          if (dr) dr.calls.push(call); Debug.ping();
          try {
            if (pv === 'groq') call.raw = await this.runGroq(q, extra, call);
            else {
              const payload = Prompt.build(q, extra), ps = payload.contents[0].parts;
              call.sys = payload.systemInstruction.parts[0].text; call.user = ps[0].text;
              let lab = ''; ps.slice(1).forEach(x => { if (x.text) lab = x.text.replace(/:$/, ''); else if (x.inline_data) call.att.push({ label: lab, kb: Math.round(x.inline_data.data.length * 0.75 / 1024) }); });
              call.raw = await AI.call(payload);
            }
            return call.raw;
          } catch (err) { call.err = err.message || String(err); throw err; }
          finally { call.ms = Date.now() - call.t0; Debug.ping(); }
        };
        const run = (extra, kind) => runOn(prov, extra, kind);
        const note = (pp) => { const c = dr && dr.calls[dr.calls.length - 1]; if (c) c.parse = pp.ok ? 'parsed OK' : 'PARSE ERROR: ' + pp.error; };
        let raw = await run('');
        let p = Parser.parse(raw, q); note(p);
        if (!p.ok) throw new Error(p.error);
        let issues = Verify.check(p.data, q);
        Debug.step(dr, 'automatic checks: ' + (issues.length ? issues.length + ' problem(s) — ' + issues.join(' | ').slice(0, 300) : 'passed'));
        for (let n = 1; n <= 2 && issues.length; n++) {        // self-repair loop: send the machine-found problems back
          UI.setStatus('double-checking (' + n + ')…', 'busy'); Debug.step(dr, 'repair round ' + n);
          const extra = '\n\nYOUR PREVIOUS ANSWER (JSON):\n' + raw + '\n\nAUTOMATIC CHECKS FOUND THESE PROBLEMS:\n' + issues.map(i => '- ' + i).join('\n') +
            '\n\nFix every real problem and return the COMPLETE corrected JSON in the same shape (all fields, full code). If a flagged item is genuinely not required, you may keep it but say why in "explanation".';
          try {
            const raw2 = await run(extra, 'repair ' + n), p2 = Parser.parse(raw2, q); note(p2);
            if (!p2.ok) break;
            raw = raw2; p = p2; issues = Verify.check(p.data, q);
            Debug.step(dr, 'after repair ' + n + ': ' + (issues.length ? issues.length + ' problem(s) left' : 'all checks passed'));
          } catch (e) { break; }
        }
        let reviewed = '';
        if (Settings.cur.review && q.type.startsWith('coding') && this.isWebDev(q)) {       // second opinion: another AI grades the candidate against the question + images + a real render
          const other = prov === 'groq' ? 'gemini' : 'groq';
          const rv = Settings.cur.provider === 'auto' && AI.hasKey(other) ? other : prov;
          try {
            UI.setStatus('second opinion (' + (rv === 'groq' ? 'Groq' : 'Gemini') + ')…', 'busy');
            const allCode = {};
            q.editors.filter(isWritable).forEach(e => { allCode[normLang(e.language)] = e.code; });
            Object.assign(allCode, p.data.code);
            let probe = ''; try { probe = (await Probe.report(allCode)).slice(0, 6000); } catch (e) {}
            const cand = JSON.stringify({ requirements: p.data.requirements, languages: Object.fromEntries(Object.entries(p.data.code).map(([k, v]) => [k, { required: true, code: v }])) });
            const extra = '\n\nREVIEW MODE. Below is a CANDIDATE ANSWER (JSON) written by another AI. Act as a strict grader running hidden tests on the result: go through the question text, every image and every requirement one by one and compare the candidate code against each (tags, classes, ids, exact text, attribute values, image URLs, property names and values, colours, font sizes, spacing, alignment, element order, number of columns at each screen width, breakpoints). Treat the LAYOUT PROBE (a real render of the candidate) as ground truth for what the page actually does. Fix every mismatch, but change nothing that is already right and never add anything the instructions did not ask for. Return the COMPLETE final JSON in the same shape (all fields, full code), even if nothing needs to change.\n\nCANDIDATE ANSWER (JSON):\n' + cand + (probe ? '\n\nLAYOUT PROBE:\n' + probe : '');
            Debug.step(dr, 'second opinion by ' + rv);
            const raw3 = await runOn(rv, extra, 'review'), p3 = Parser.parse(raw3, q); note(p3);
            if (p3.ok) { const i3 = Verify.check(p3.data, q); if (i3.length <= issues.length) { p = p3; issues = i3; reviewed = rv; } }
          } catch (e) {}
        }
        p.data.reviewed = reviewed;
        p.data.provider = prov;
        p.data.warnings = issues;
        p.data.reqCount = (p.data.requirements || []).length;
        p.data.imgNote = this.imgNote(q, prov);
        return p.data;
      } catch (e) {
        lastErr = e; Debug.step(dr, (prov === 'groq' ? 'Groq' : 'Gemini') + ' failed: ' + e.message);
        if (order.length > 1 && prov === order[0]) UI.toast((prov === 'groq' ? 'Groq' : 'Gemini') + ' failed: ' + e.message + ' — trying ' + order[1], 'warn');
      }
    }
    throw lastErr || new Error('No AI provider available');
  },
  toggleAuto() {
    const v = !Settings.cur.autoApply; Settings.set({ autoApply: v });
    UI.toast(v ? 'Auto-fill ON — answers are filled in for you' : 'Show-only ON — answers are shown, not filled', 'ok');
  },

  async solve() {
    if (!Settings.cur.enabled) return;
    if (this.busy) return UI.toast('Already working on a question', 'warn');
    this.busy = true;
    const dr = Debug.begin('solve');
    try {
      UI.setStatus('reading…', 'busy'); Debug.step(dr, 'reading the page');
      Observer.version++;                                   // force fresh DOM scan
      const q = await Extractor.extract();
      if (!q) { UI.setStatus('ready', 'ok'); Debug.fail(dr, 'No question found on this page'); return UI.toast('No question found on this page', 'err'); }
      dr.q = Debug.snapQ(q); Debug.step(dr, 'read: ' + q.type + ', ' + q.options.length + ' options, ' + q.editors.length + ' editors, ' + q.images.length + ' question image(s)' + (q.testCases ? ', test cases found' : ''));
      if (!q.description.trim() && !q.images.length) { UI.setStatus('error', 'err'); Debug.fail(dr, 'Could not read the question text — nothing was sent to the AI'); return UI.toast('Could not read the question text — see 🐞 Debug', 'err'); }
      UI.setType(TYPE_LABEL[q.type] || q.type);
      if (q.type === 'unknown') {
        const err = q.editors.find(e => e.error);
        UI.setStatus('error', 'err');
        Debug.fail(dr, err ? err.error : 'Could not recognise the answer controls on this page');
        return UI.toast(err ? err.error : 'Could not recognise the answer controls on this page', 'err');
      }
      UI.setStatus('thinking…', 'busy'); UI.clearResult();
      q.imageResults = await Images.fetchAll(q.images);
      q.optionImageResults = q.options.length ? await Images.fetchAll(Images.collectOptions()) : [];
      dr.imgs = Debug.snapImgs(q.imageResults.concat(q.optionImageResults));
      Debug.step(dr, 'images: ' + dr.imgs.filter(i => i.supplied).length + '/' + dr.imgs.length + ' ready' + (q.optionImageResults.length ? ' (' + q.optionImageResults.length + ' from the options)' : ''));
      const data = await this.ask(q, dr);
      if (Observer.computeFp() !== q.fingerprint) { UI.setStatus('ready', 'ok'); Debug.fail(dr, 'Question changed while solving — answer discarded'); return UI.toast('Question changed while solving — answer discarded', 'warn'); }
      this.last = { q, res: data, dr };
      dr.result = Debug.snapRes(data, q); Debug.step(dr, 'answer ready (' + data.provider + ')');
      UI.showResult(q, data); UI.setStatus('answer ready', 'ok');
      const bad = q.imageResults.concat(q.optionImageResults).filter(i => !i.supplied).length;
      if (bad) UI.toast(bad + ' image(s) could not be sent to the AI', 'warn');
      if (Settings.cur.autoApply) await this.apply();
    } catch (e) { UI.setStatus('error', 'err'); UI.toast(e.message || String(e), 'err'); Debug.fail(dr, e.message || String(e)); }
    finally { this.busy = false; Debug.end(dr); }
  },

  async apply() {
    if (!this.last) return UI.toast('Nothing to fill — solve first (Alt+A)', 'warn');
    if (Observer.computeFp() !== this.last.q.fingerprint) return UI.toast('Question changed — solve again', 'warn');
    const r = await Actions.apply(this.last.res, this.last.q);
    if (this.last.dr) { this.last.dr.apply = (r.ok ? '✓ ' : '✗ ') + r.msg; Debug.ping(); }
    UI.toast(r.ok && !Settings.cur.answerVisible ? 'Answer filled' : r.msg, r.ok ? 'ok' : 'err');
    if (r.ok) UI.setStatus('filled', 'ok');
    if (r.ok && Settings.cur.autoSubmit) Submit.submit('auto');
  }
};

Observer.onQuestionChange(() => {
  Main.last = null;
  if (UI.host) { UI.clearResult(); UI.setType('–'); UI.setStatus(Settings.cur.enabled ? 'ready' : 'disabled', Settings.cur.enabled ? 'ok' : 'err'); }
});

function qsBoot() {
  if (window.__QS_LOADED__) return;
  window.__QS_LOADED__ = true;
  Settings.load();
  try { console.log('%cQuickSolve by Aman', 'font-weight:bold'); } catch (e) {}
  Keyboard.init();            // first: keyboard must work even if everything below fails
  window.__qsDebug = { Ccbp, Extractor, Prompt, Parser, Classifier, Editors };
  try { Observer.start(); UI.init(); UI.setStatus('ready', 'ok'); } catch (e) { console.warn('[QuickSolve] UI/observer failed; keyboard still active', e); }
}

qsBoot();
})();
