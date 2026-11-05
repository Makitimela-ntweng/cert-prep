/* Mock Exam Center
   Static app: index.html + styles.css + app.js + config.js + dump.txt.
   Accounts and cloud progress use Supabase when config.js has keys; otherwise everything is stored in the browser. */

const TEMPLATE = `Exam: AZ-104 Microsoft Azure Administrator

Section: Manage Azure identities and governance (20–25%)
Topic: Manage Microsoft Entra users and groups

QUESTION 1
Question text goes here. It can run over
several lines.
A. First option
B. Second option
C. Third option
D. Fourth option
Answer: B
Explanation: Why B is right. Optional, can be several lines.

QUESTION 2
A multiple-answer question. (Choose two.)
A. Option
B. Option
C. Option
D. Option
Answer: A, D

Topic: Manage access to Azure resources

QUESTION 3
...`;

/* ---------- Helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const slug = s => String(s || '').toLowerCase().replace(/\(sample\)/, 'sample').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const pad = n => String(n).padStart(2, '0');
const clock = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`; };
const pct = x => Math.round(x * 100) + '%';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const LETTERS = 'ABCDEFGHIJ';
let toastTimer;
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }

/* ---------- Parsing ---------- */
function parseAnswerLetters(s) {
  s = String(s || '').toUpperCase().replace(/^\s*(OPTIONS?|CHOICES?)\s*/, '');
  const out = []; let m;
  const re = /^\s*([A-J]{1,10})\b\s*(?:[,;&\/+]|AND\b)?/;
  while ((m = s.match(re))) { out.push(...m[1].split('')); s = s.slice(m[0].length); }
  return [...new Set(out)];
}

function finishQuestion(q, list, stats) {
  if (!q) return;
  q.stem = q.stem.trim(); q.explanation = (q.explanation || '').trim();
  if (!q.options.length) { stats.skipped++; return; }
  if (!q.answer.length && q.answerText) {
    const hit = q.options.find(o => o.text.trim().toLowerCase() === q.answerText.trim().toLowerCase());
    if (hit) q.answer = [hit.key];
  }
  q.answer = q.answer.filter(k => q.options.some(o => o.key === k));
  delete q.answerText;
  list.push(q);
}

function parseText(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const reTitle = /^\s*#*\s*(?:exam(?:\s+title)?|title)\s*[:\-–]\s*(.+)$/i;
  const reSec = /^\s*#*\s*(?:section|domain|module|skill area)\s*\d*\s*[:\-–]\s*(.+)$/i;
  const reTop = /^\s*#*\s*(?:topic|sub-?topic|objective)\s*[\d.]*\s*[:\-–]\s*(.+)$/i;
  const reQ = /^\s*#*\s*\**\s*(?:question|q)\s*#?\s*(\d+)\s*\**\s*[:.)\-–]?\s*(.*)$/i;
  const reNum = /^\s*(\d{1,4})[.)]\s+(.+)$/;
  const reOpt = /^\s*\(?([A-Ja-j])[.)]\s+(.*)$/;
  const reAns = /^\s*\**\s*(?:correct\s+)?answers?\s*\**\s*[:\-–]\s*(.*)$/i;
  const reExp = /^\s*\**\s*(?:explanation|rationale|references?)\s*\**\s*[:\-–]\s*(.*)$/i;
  let title = '', section = 'General', topic = 'General';
  const list = [], stats = { skipped: 0 };
  let q = null, mode = 'stem';
  const newQ = first => { finishQuestion(q, list, stats); q = { stem: first || '', options: [], answer: [], explanation: '', section, topic }; mode = 'stem'; };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim() || /^\s*[-=_*]{3,}\s*$/.test(line)) { if (q && mode === 'stem' && q.stem) q.stem += '\n'; continue; }
    if (!title && !q && (m = line.match(reTitle))) { title = m[1].trim(); continue; }
    if ((m = line.match(reSec))) { section = m[1].trim(); topic = 'General'; if (q && !q.options.length && !q.stem.trim()) { q.section = section; q.topic = topic; } continue; }
    if ((m = line.match(reTop))) { topic = m[1].trim(); if (q && !q.options.length && !q.stem.trim()) q.topic = topic; continue; }
    if ((m = line.match(reQ))) { newQ(m[2]); continue; }
    if ((!q || mode === 'exp' || mode === 'after') && (m = line.match(reNum))) { newQ(m[2]); continue; }
    if (!q) continue;
    if ((m = line.match(reAns))) { q.answer = parseAnswerLetters(m[1]); q.answerText = m[1]; mode = 'after'; continue; }
    if ((m = line.match(reExp))) { q.explanation += (q.explanation ? '\n' : '') + m[1]; mode = 'exp'; continue; }
    if (mode === 'exp' || mode === 'after') { q.explanation += (q.explanation ? '\n' : '') + line.trim(); mode = 'exp'; continue; }
    if ((m = line.match(reOpt)) && (mode === 'opts' || q.stem.trim())) {
      const key = m[1].toUpperCase();
      if (!q.options.some(o => o.key === key)) { q.options.push({ key, text: m[2].trim() }); mode = 'opts'; continue; }
    }
    if (mode === 'opts') { const o = q.options[q.options.length - 1]; o.text += ' ' + line.trim(); continue; }
    q.stem += (q.stem && !q.stem.endsWith('\n') ? '\n' : '') + line.trim();
  }
  finishQuestion(q, list, stats);
  return { title, questions: list, skipped: stats.skipped };
}

function normOptions(o) {
  if (Array.isArray(o)) return o.map((x, i) => typeof x === 'string'
    ? { key: LETTERS[i], text: x.replace(/^\s*\(?[A-J][.)]\s+/, '') }
    : { key: String(x.key || x.id || LETTERS[i]).toUpperCase(), text: String(x.text ?? x.label ?? '') });
  if (o && typeof o === 'object') return Object.entries(o).map(([k, v]) => ({ key: k.toUpperCase(), text: String(v) }));
  return [];
}
function parseJSON(text) {
  const data = JSON.parse(text);
  const list = [], stats = { skipped: 0 };
  const add = (x, section, topic) => {
    const q = {
      stem: String(x.question ?? x.stem ?? x.text ?? ''),
      options: normOptions(x.options ?? x.choices),
      answer: Array.isArray(x.answer ?? x.answers) ? (x.answer ?? x.answers).map(a => String(a).toUpperCase()) : parseAnswerLetters(x.answer ?? x.answers ?? x.correct),
      explanation: String(x.explanation ?? x.reference ?? ''),
      section: String(x.section ?? x.domain ?? section ?? 'General'),
      topic: String(x.topic ?? topic ?? 'General'),
      answerText: typeof x.answer === 'string' ? x.answer : ''
    };
    finishQuestion(q, list, stats);
  };
  const arr = Array.isArray(data) ? data : (data.questions || []);
  arr.forEach(x => add(x));
  (data.sections || []).forEach(s => {
    (s.questions || []).forEach(x => add(x, s.name));
    (s.topics || []).forEach(t => (t.questions || []).forEach(x => add(x, s.name, t.name)));
  });
  return { title: Array.isArray(data) ? '' : (data.title || data.exam || ''), questions: list, skipped: stats.skipped };
}

function parseDump(text) {
  const t = text.trim();
  const r = /^[\[{]/.test(t) ? parseJSON(t) : parseText(t);
  r.questions.forEach((q, i) => { q.num = i + 1; q.multi = q.answer.length > 1 || (!q.answer.length && /choose\s+(two|three|four|2|3|4)|select\s+(two|three|2|3)/i.test(q.stem)); });
  r.rev = hash(t);
  // Progress is keyed by exam title, so fixing a typo in the dump keeps everyone's progress.
  r.id = slug(r.title) || r.rev;
  return r;
}

/* ---------- State ---------- */
const DEFAULTS = { examSize: 50, minutesPerQ: 2, passing: 700 };
const CFG = window.MEC_CONFIG || {};
const sb = CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
let settings = Object.assign({}, DEFAULTS, store.get('mec.settings', {}));
let source = store.get('mec.source', null);   // a dump this browser loaded itself
let siteText = null;                           // dump.txt / dump.json deployed with the site
let bank, bankFrom = 'none';
let session = store.get('mec.session', null), view = 'home', reviewFilter = 'all', resFilter = 'all';
let user = null, history = [], progress = {}, loaderMsg = null;

function loadBank() {
  bank = null;
  for (const [text, from] of [[source && source.text, 'local'], [siteText, 'site']]) {
    if (!text) continue;
    try { const r = parseDump(text); if (r.questions.length) { bank = r; bankFrom = from; return; } } catch (e) {}
  }
  bank = { title: '', questions: [], id: 'none', rev: 'none', skipped: 0 }; bankFrom = 'none';
}
const isSample = () => /\(sample\)/i.test(bank.title);
const Q = num => bank.questions[num - 1];
const saveSession = () => store.set('mec.session', session);
const progressKey = () => 'mec.progress.' + bank.id;

/* ---------- Data: Supabase when signed in, browser otherwise ---------- */
const Data = {
  async load() {
    if (user) {
      const [p, a] = await Promise.all([
        sb.from('progress').select('qnum,score,updated_at').eq('bank_id', bank.id),
        sb.from('attempts').select('*').eq('bank_id', bank.id).order('created_at', { ascending: false }).limit(100)
      ]);
      if (p.error || a.error) { toast('Could not load your saved progress: ' + (p.error || a.error).message); }
      progress = Object.fromEntries((p.data || []).map(r => [r.qnum, { g: r.score, t: Date.parse(r.updated_at) }]));
      history = (a.data || []).map(r => ({ date: Date.parse(r.created_at), key: r.set_key, label: r.label, mode: r.mode, score: r.score, pass: r.pass, correct: r.correct, total: r.total, bankId: r.bank_id }));
    } else {
      progress = store.get(progressKey(), {});
      history = store.get('mec.history', []).filter(h => (h.bankId || bank.id) === bank.id);
    }
  },
  record(entries) {
    if (!entries.length) return;
    const now = Date.now();
    entries.forEach(e => { progress[e.num] = { g: e.g, t: now }; });
    if (user) {
      sb.from('progress').upsert(entries.map(e => ({ user_id: user.id, bank_id: bank.id, qnum: e.num, score: e.g, updated_at: new Date(now).toISOString() })))
        .then(({ error }) => error && toast('Progress not saved: ' + error.message));
    } else store.set(progressKey(), progress);
  },
  addAttempt(h) {
    history.unshift(h);
    if (user) {
      sb.from('attempts').insert({ user_id: user.id, bank_id: bank.id, set_key: h.key, label: h.label, mode: h.mode, score: h.score, pass: h.pass, correct: h.correct, total: h.total })
        .then(({ error }) => error && toast('Attempt not saved: ' + error.message));
    } else {
      const all = store.get('mec.history', []); all.unshift(h); store.set('mec.history', all.slice(0, 300));
    }
  },
  async reset() {
    if (user) {
      const [a, b] = await Promise.all([sb.from('progress').delete().eq('bank_id', bank.id), sb.from('attempts').delete().eq('bank_id', bank.id)]);
      if (a.error || b.error) { toast('Reset failed: ' + (a.error || b.error).message); return; }
    } else {
      store.del(progressKey());
      store.set('mec.history', store.get('mec.history', []).filter(h => (h.bankId || bank.id) !== bank.id));
    }
    progress = {}; history = [];
  },
  // After sign-in, move anything practised as a guest into the account, then clear the browser copy.
  async migrateGuest() {
    const local = store.get(progressKey(), {});
    const localHist = store.get('mec.history', []).filter(h => (h.bankId || bank.id) === bank.id);
    const rows = Object.entries(local).map(([n, p]) => ({ user_id: user.id, bank_id: bank.id, qnum: +n, score: p.g, updated_at: new Date(p.t).toISOString() }));
    if (!rows.length && !localHist.length) return;
    const r1 = rows.length ? await sb.from('progress').upsert(rows, { ignoreDuplicates: true }) : {};
    const r2 = localHist.length ? await sb.from('attempts').insert(localHist.map(h => ({ user_id: user.id, bank_id: bank.id, set_key: h.key, label: h.label, mode: h.mode,
      score: h.score, pass: h.pass, correct: h.correct, total: h.total, created_at: new Date(h.date).toISOString() }))) : {};
    if (r1.error || r2.error) { toast('Could not copy guest progress: ' + (r1.error || r2.error).message); return; }
    store.del(progressKey());
    store.set('mec.history', store.get('mec.history', []).filter(h => (h.bankId || bank.id) !== bank.id));
    toast(`Added your guest progress (${plural(rows.length, 'question')}, ${plural(localHist.length, 'attempt')}) to your account.`);
  }
};

/* ---------- Progress maths ---------- */
function progStats(qs) {
  let att = 0, pts = 0, n = 0;
  qs.forEach(q => { if (!q.answer.length) return; n++; const p = progress[q.num]; if (p) { att++; pts += p.g; } });
  return { n, att, pts, acc: att ? pts / att : null };
}
function stack(s, cls = '') {
  const c = s.n ? s.pts / s.n * 100 : 0, w = s.n ? (s.att - s.pts) / s.n * 100 : 0;
  return `<div class="stack ${cls}" role="img" aria-label="${Math.round(s.pts * 10) / 10} correct, ${Math.round((s.att - s.pts) * 10) / 10} incorrect, ${s.n - s.att} not attempted"><i class="c" style="width:${c.toFixed(1)}%"></i><i class="w" style="width:${w.toFixed(1)}%"></i></div>`;
}
const accText = s => s.acc == null ? 'not started' : `<b>${pct(s.acc)}</b> correct`;

function examSets() {
  const n = bank.questions.length, size = settings.examSize;
  const count = Math.max(3, Math.ceil(n / size));
  return Array.from({ length: count }, (_, i) => {
    const from = i * size;
    return { key: 'exam-' + (i + 1), label: 'Exam ' + (i + 1), from: from + 1, to: from + size, qs: bank.questions.slice(from, from + size) };
  });
}
function tree(qs) {
  const m = new Map();
  qs.forEach(q => {
    if (!m.has(q.section)) m.set(q.section, new Map());
    const t = m.get(q.section);
    if (!t.has(q.topic)) t.set(q.topic, []);
    t.get(q.topic).push(q);
  });
  return m;
}

/* ---------- Band ---------- */
function accountHtml() {
  if (!sb) return '';
  if (!user) return `<button class="btn onband" data-act="auth" data-tab="signin">Sign in</button><button class="btn onband" data-act="auth" data-tab="signup">Create account</button>`;
  const name = user.user_metadata?.name || user.email;
  return `<span class="who" title="${esc(user.email)}">${esc(name)}</span><button class="btn onband" data-act="signout">Sign out</button>`;
}
function setBand(title, metaHtml, progressFrac, stripHtml) {
  $('#bandTitle').textContent = title;
  $('#bandMeta').innerHTML = metaHtml || '';
  const p = $('#progress');
  p.hidden = progressFrac == null;
  if (progressFrac != null) p.firstElementChild.style.width = (progressFrac * 100).toFixed(1) + '%';
  const s = $('#strip');
  s.hidden = !stripHtml;
  s.innerHTML = stripHtml ? `<div class="wrap">${stripHtml}</div>` : '';
}

/* ---------- Home ---------- */
function renderHome() {
  view = 'home';
  setBand('Mock Exam Center', `<span>${esc(bank.title || 'No exam loaded')}</span>${accountHtml()}`);
  const sets = examSets();
  const tr = tree(bank.questions);
  const secs = [...tr.keys()];
  const nTopics = [...tr.values()].reduce((a, t) => a + t.size, 0);
  const unscored = bank.questions.filter(q => !q.answer.length).length;
  const has = bank.questions.length > 0;

  const examHist = key => history.filter(h => h.key === key && h.mode === 'exam');
  const examCards = sets.map((s, i) => {
    const n = s.qs.length;
    if (!n) return `<div class="exam-card empty"><div class="range">Q${s.from}–${s.to}</div><div class="big">${s.label}</div><p class="muted small">No questions in this range yet. The dump needs at least ${s.from} questions.</p></div>`;
    const h = examHist(s.key);
    const last = h[0], top = h.reduce((a, x) => Math.max(a, x.score), 0);
    const ps = progStats(s.qs);
    return `<div class="exam-card">
      <div class="row" style="justify-content:space-between"><span class="range">Q${s.from}–${s.from + n - 1}</span>${last ? `<span class="pill ${last.pass ? 'pass' : 'fail'}">${last.pass ? 'Passed' : 'Failed'}</span>` : ''}</div>
      <div class="big">${s.label}</div>
      <div class="stats"><span><b>${n}</b> questions</span><span><b>${Math.round(n * settings.minutesPerQ)}</b> min</span><span><b>${tree(s.qs).size}</b> sections</span></div>
      ${stack(ps, 'thin')}
      <div class="stats">${h.length ? `<span>Best <b class="num">${top}</b></span><span>Last <b class="num">${last.score}</b></span><span>${plural(h.length, 'attempt')}</span>` : `<span>${ps.att}/${ps.n} practised · ${accText(ps)}</span>`}</div>
      <div><button class="btn primary" data-act="start-exam" data-i="${i}">Start ${s.label}</button></div>
    </div>`;
  }).join('');

  const all = progStats(bank.questions);
  const examsWithQs = sets.filter(s => s.qs.length);
  const passed = examsWithQs.filter(s => examHist(s.key).some(h => h.pass)).length;
  const bestExam = history.filter(h => h.mode === 'exam').reduce((a, h) => Math.max(a, h.score), 0);
  const weakest = secs.map(s => ({ s, st: progStats([...tr.get(s).values()].flat()) })).filter(x => x.st.att >= 3).sort((a, b) => a.st.acc - b.st.acc)[0];
  const saveNote = user ? 'Saved to your account' : sb ? 'Saved in this browser only. Sign in to keep it across devices.' : 'Saved in this browser';
  const progressPanel = has ? `<section class="panel" aria-labelledby="progH">
      <div class="sec-head" style="margin:0"><h2 id="progH">Your progress</h2><span class="muted small">${saveNote}</span></div>
      <div class="stats4">
        <div class="stat"><span class="eyebrow">Attempted</span><b>${all.att}<span class="muted" style="font-size:1rem"> / ${all.n}</span></b><span class="sub">${all.n ? pct(all.att / all.n) : '0%'} of the question bank</span></div>
        <div class="stat"><span class="eyebrow">Accuracy</span><b>${all.acc == null ? '–' : pct(all.acc)}</b><span class="sub">${all.att ? `${Math.round(all.pts * 10) / 10} points from ${all.att} answered` : 'Answer a question to start'}</span></div>
        <div class="stat"><span class="eyebrow">Exams passed</span><b>${passed}<span class="muted" style="font-size:1rem"> / ${examsWithQs.length}</span></b><span class="sub">${bestExam ? `Best score ${bestExam}` : 'No exam taken yet'}</span></div>
        <div class="stat"><span class="eyebrow">Focus next</span><b style="font-size:1.05rem;line-height:1.3">${weakest ? esc(weakest.s) : '–'}</b><span class="sub">${weakest ? `${pct(weakest.st.acc)} correct so far` : 'Shown after 3 answers in a section'}</span></div>
      </div>
      <div class="secprog">
        ${secs.map((s, si) => { const st = progStats([...tr.get(s).values()].flat());
          return `<div class="r"><span>${esc(s)}</span>${stack(st)}<span class="v">${st.att}/${st.n} · ${accText(st)}</span></div>`; }).join('')}
      </div>
      <div class="row" style="justify-content:space-between"><div class="keyline"><span class="c">Correct</span><span class="w">Incorrect</span><span>Not attempted</span></div>
        ${all.att || history.length ? '<button class="btn ghost small" data-act="reset">Reset progress</button>' : ''}</div>
    </section>` : '';

  const skills = secs.map((sec, si) => {
    const topics = [...tr.get(sec).entries()];
    const total = topics.reduce((a, [, qs]) => a + qs.length, 0);
    return `<details class="skill"${si === 0 ? ' open' : ''}>
      <summary><span class="name">${esc(sec)}</span><span class="count">${total} q · ${plural(topics.length, 'topic')}</span>
        <button class="btn" data-act="start-sec" data-s="${si}">Practice section</button></summary>
      ${topics.map(([tn, qs], ti) => { const st = progStats(qs);
        return `<div class="topic"><span class="tn">${esc(tn)}</span><span class="tstat">${stack(st, 'thin')}${st.att}/${st.n}${st.acc == null ? '' : ' · ' + pct(st.acc)}</span>
        <button class="btn ghost" data-act="start-topic" data-s="${si}" data-t="${ti}">Practice</button></div>`; }).join('')}
    </details>`;
  }).join('');

  const hist = history.slice(0, 10).map(h => `<tr><td class="num">${new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
    <td>${esc(h.label)}</td><td>${h.mode === 'exam' ? 'Exam' : 'Practice'}</td><td class="num">${h.correct}/${h.total}</td>
    <td class="num"><b>${h.score}</b></td><td><span class="pill ${h.pass ? 'pass' : 'fail'}">${h.pass ? 'Pass' : 'Fail'}</span></td></tr>`).join('');

  const resume = session && !session.done ? `<div class="notice resume"><div><b>${esc(session.label)}</b> is in progress
      <span class="muted">· question ${session.idx + 1} of ${session.order.length}${session.endsAt ? ' · ' + clock(session.endsAt - Date.now()) + ' left' : ''}</span></div>
      <div class="row"><button class="btn ghost danger" data-act="discard">Discard</button><button class="btn primary" data-act="resume">Resume</button></div></div>` : '';

  const guestNote = sb && !user && has ? `<div class="notice"><div><b>Practising as a guest.</b> <span class="muted">Create a free account to save your progress and scores across devices.</span></div>
      <div class="row"><button class="btn" data-act="auth" data-tab="signin">Sign in</button><button class="btn primary" data-act="auth" data-tab="signup">Create account</button></div></div>` : '';

  const loaderBody = `<div class="loader">
        <div class="row"><label class="btn" for="file">Choose file…</label><input id="file" type="file" accept=".txt,.md,.json,text/plain,application/json" hidden>
          <span class="muted small">.txt, .md or .json. For a PDF or Word dump, copy its text and paste it below.</span></div>
        <textarea id="dumpText" spellcheck="false" placeholder="Paste your exam dump here">${esc(bankFrom === 'local' ? source.text : '')}</textarea>
        <div class="fields">
          <label class="field">Questions per exam<input id="setSize" type="number" min="5" max="500" value="${settings.examSize}"></label>
          <label class="field">Minutes per question<input id="setMin" type="number" min="0.5" max="10" step="0.5" value="${settings.minutesPerQ}"></label>
          <label class="field">Passing score (of 1000)<input id="setPass" type="number" min="100" max="1000" step="10" value="${settings.passing}"></label>
        </div>
        ${loaderMsg ? `<div class="msg ${loaderMsg.ok ? 'ok' : 'err'}">${esc(loaderMsg.text)}</div>` : ''}
        <div class="row"><button class="btn primary" data-act="load">Load dump and save settings</button>${bankFrom === 'local' && siteText ? '<button class="btn ghost" data-act="site-dump">Go back to the site\'s exam</button>' : ''}</div>
        <details class="guide">
          <summary>Dump format</summary>
          <ul>
            <li><code>Exam:</code> on the first line sets the title. Progress is saved per exam title.</li>
            <li><code>Section:</code> and <code>Topic:</code> lines apply to every question that follows until the next one. Section weights like <code>(20–25%)</code> can stay in the name.</li>
            <li>Each question starts with <code>QUESTION 12</code>, <code>Question 12:</code> or <code>Q12.</code></li>
            <li>Options are <code>A.</code> or <code>A)</code> lines. Long options can wrap onto the next line.</li>
            <li><code>Answer: B</code>, or <code>Answer: A, C</code> / <code>Answer: AC</code> for multiple answers.</li>
            <li><code>Explanation:</code> is optional and can span several lines.</li>
            <li>JSON also works: an array of <code>{question, options, answer, explanation, section, topic}</code>.</li>
          </ul>
          <pre id="tpl">${esc(TEMPLATE)}</pre>
          <div class="row" style="margin-top:8px"><button class="btn" data-act="copy-tpl">Copy template</button></div>
        </details>
      </div>`;

  $('#view').innerHTML = `<main class="home wrap">
    <div class="hero">
      <span class="eyebrow">Practice test${user ? ' · ' + esc(user.user_metadata?.name || user.email) : ''}</span>
      <h1>${esc(bank.title || 'Load an exam dump to begin')}</h1>
      ${has ? `<p class="muted">${bank.questions.length} questions · ${plural(secs.length, 'section')} · ${plural(nTopics, 'topic')} · passing score ${settings.passing} of 1000${unscored ? ` · ${unscored} without an answer key` : ''}</p>`
            : `<p class="muted">Paste or choose your exam dump below. Questions are split into exams of ${settings.examSize} and grouped by the sections and topics in the dump.</p>`}
    </div>
    ${resume}
    ${isSample() ? `<div class="notice"><div><b>These are sample questions.</b> <span class="muted">Replace dump.txt in the site, or load a dump below, to use your own.</span></div><button class="btn primary" data-act="goto-loader">Load exam dump</button></div>` : ''}
    ${guestNote}
    ${progressPanel}
    ${has ? `<section>
      <div class="sec-head"><h2>Practice exams</h2><span class="muted small">${settings.examSize} questions per exam, in dump order</span></div>
      <div class="exam-grid">${examCards}</div>
    </section>
    <section>
      <div class="sec-head"><h2>Skills measured</h2><button class="btn" data-act="start-all">Practice all ${bank.questions.length} questions</button></div>
      <div class="skills">${skills}</div>
    </section>` : ''}
    ${history.length ? `<section><div class="sec-head"><h2>Recent attempts</h2></div>
      <div class="scroll-x"><table><thead><tr><th>Date</th><th>Set</th><th>Mode</th><th>Correct</th><th>Score</th><th>Result</th></tr></thead><tbody>${hist}</tbody></table></div></section>` : ''}
    <section id="loader">
      <div class="sec-head"><h2>Exam dump</h2><span class="muted small">${bankFrom === 'site' ? 'Using the exam published with this site' : bankFrom === 'local' ? `Using a dump loaded in this browser${source.name ? ' (' + esc(source.name) + ')' : ''}` : 'Nothing loaded yet'}</span></div>
      ${bankFrom === 'site' && !loaderMsg ? `<details class="guide"><summary>Use a different dump in this browser</summary><div style="margin-top:12px">${loaderBody}</div></details>` : loaderBody}
    </section>
  </main>`;
  $('#file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $('#dumpText').value = r.result; doLoad(f.name); };
    r.readAsText(f);
  });
}

async function switchBank() {
  if (session && session.bankRev !== bank.rev) { session = null; store.del('mec.session'); }
  await Data.load();
}

async function doLoad(name) {
  const text = $('#dumpText').value;
  settings.examSize = Math.max(5, Math.round(+$('#setSize').value || DEFAULTS.examSize));
  settings.minutesPerQ = Math.max(0.5, +$('#setMin').value || DEFAULTS.minutesPerQ);
  settings.passing = Math.min(1000, Math.max(100, Math.round(+$('#setPass').value || DEFAULTS.passing)));
  store.set('mec.settings', settings);
  if (!text.trim()) { loaderMsg = { ok: true, text: 'Settings saved.' }; renderHome(); return; }
  let r;
  try { r = parseDump(text); } catch (e) { loaderMsg = { ok: false, text: 'This looks like JSON but could not be read: ' + e.message }; renderHome(); return; }
  if (!r.questions.length) { loaderMsg = { ok: false, text: 'No questions found. Each question needs a "QUESTION 1" style header and lettered options (A. B. C.). See the dump format below.' }; renderHome(); return; }
  source = { text, name: name || (source && source.name) || '' };
  const saved = store.set('mec.source', source);
  loadBank(); await switchBank();
  const t = tree(bank.questions); const nt = [...t.values()].reduce((a, x) => a + x.size, 0);
  const noKey = bank.questions.filter(q => !q.answer.length).length;
  loaderMsg = { ok: true, text: `Loaded ${bank.questions.length} questions in ${plural(t.size, 'section')} and ${plural(nt, 'topic')}.` +
    (r.skipped ? ` Skipped ${plural(r.skipped, 'block')} with no answer options.` : '') +
    (noKey ? ` ${noKey} question${noKey === 1 ? ' has' : 's have'} no answer key and won't be scored.` : '') +
    (saved ? '' : ' Your browser blocked saving, so the dump will be gone if you reload.') };
  renderHome();
  $('#loader').scrollIntoView({ block: 'start' });
}

/* ---------- Modal ---------- */
function modal(html) { $('#modalRoot').innerHTML = `<div class="scrim" data-act="scrim"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('#modalRoot [autofocus]') || $('#modalRoot .btn.primary'); f && f.focus(); }
function closeModal() { $('#modalRoot').innerHTML = ''; }

/* ---------- Accounts ---------- */
function authModal(tab, msg) {
  const forms = {
    signin: { h: 'Sign in', btn: 'Sign in', fields: ['email', 'password'] },
    signup: { h: 'Create account', btn: 'Create account', fields: ['name', 'email', 'newpassword'] },
    forgot: { h: 'Reset password', btn: 'Send reset link', fields: ['email'] },
    recover: { h: 'Choose a new password', btn: 'Save password', fields: ['newpassword'] }
  }[tab];
  const F = {
    name: '<label class="field">Display name<input id="authName" autocomplete="name" required maxlength="60" autofocus></label>',
    email: `<label class="field">Email<input id="authEmail" type="email" autocomplete="email" required ${tab !== 'signup' ? 'autofocus' : ''}></label>`,
    password: '<label class="field">Password<input id="authPass" type="password" autocomplete="current-password" required></label>',
    newpassword: `<label class="field">Password<input id="authPass" type="password" autocomplete="new-password" minlength="8" required ${tab === 'recover' ? 'autofocus' : ''}><span class="small">At least 8 characters</span></label>`
  };
  modal(`<h2>${forms.h}</h2>
    ${tab === 'signin' || tab === 'signup' ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${tab === 'signin'}" data-act="auth" data-tab="signin">Sign in</button>
      <button type="button" role="tab" aria-selected="${tab === 'signup'}" data-act="auth" data-tab="signup">Create account</button></div>` : ''}
    ${tab === 'forgot' ? '<p class="muted small">We\'ll email you a link to choose a new password.</p>' : ''}
    <form class="form" id="authForm" data-tab="${tab}" novalidate>
      ${forms.fields.map(f => F[f]).join('')}
      ${tab === 'signin' ? '<button type="button" class="linkbtn" data-act="auth" data-tab="forgot">Forgot password?</button>' : ''}
      ${msg ? `<div class="msg ${msg.ok ? 'ok' : 'err'}" role="alert">${esc(msg.text)}</div>` : ''}
      <div class="row"><button type="button" class="btn ghost" data-act="close">Cancel</button><button type="submit" class="btn primary">${forms.btn}</button></div>
    </form>`);
}

async function submitAuth(form) {
  const tab = form.dataset.tab;
  const email = $('#authEmail')?.value.trim(), pass = $('#authPass')?.value, name = $('#authName')?.value.trim();
  const keep = () => { if ($('#authEmail')) $('#authEmail').value = email || ''; if ($('#authName')) $('#authName').value = name || ''; };
  const fail = text => { authModal(tab, { ok: false, text }); keep(); };
  if (tab === 'signup' && !name) return fail('Enter a display name.');
  if (tab !== 'recover' && !/^\S+@\S+\.\S+$/.test(email || '')) return fail('Enter a valid email address.');
  if ((tab === 'signup' || tab === 'recover') && (pass || '').length < 8) return fail('Use a password of at least 8 characters.');
  if (tab === 'signin' && !pass) return fail('Enter your password.');
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Please wait…';
  let res;
  if (tab === 'signin') res = await sb.auth.signInWithPassword({ email, password: pass });
  else if (tab === 'signup') res = await sb.auth.signUp({ email, password: pass, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } });
  else if (tab === 'forgot') res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  else res = await sb.auth.updateUser({ password: pass });
  if (res.error) return fail(res.error.message);
  if (tab === 'signup' && !res.data.session) { authModal('signin', { ok: true, text: `Account created. Check ${email} for a confirmation link, then sign in.` }); $('#authEmail').value = email; return; }
  if (tab === 'forgot') { authModal('forgot', { ok: true, text: `If ${email} has an account, a reset link is on its way.` }); return; }
  closeModal();
  toast(tab === 'recover' ? 'Password updated.' : tab === 'signup' ? 'Account created. Your progress now saves to your account.' : 'Signed in.');
}

async function onUserChange() {
  if (user) await Data.migrateGuest();
  await Data.load();
  if (view === 'home') renderHome(); else if (view === 'results') renderResults(); else if (view === 'review') renderReview(); else if (view === 'exam') renderExam();
}

async function initAuth() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') { setTimeout(() => authModal('recover'), 0); }
    const nu = s?.user || null;
    if ((nu && nu.id) === (user && user.id)) { user = nu; return; }
    user = nu;
    setTimeout(onUserChange, 0);   // Supabase advises not awaiting its own calls inside this callback
  });
}

/* ---------- Session setup ---------- */
let pending = null;
function setup(label, key, qs, mode) {
  if (!qs.length) return;
  pending = { label, key, nums: qs.map(q => q.num) };
  const mins = Math.round(qs.length * settings.minutesPerQ);
  const busy = session && !session.done;
  const st = progStats(qs);
  modal(`<div><span class="eyebrow">${esc(bank.title || 'Exam')}</span><h2>${esc(label)}</h2></div>
    <p class="muted">${qs.length} questions · ${plural(tree(qs).size, 'section')}${st.att ? ` · you've practised ${st.att} of them (${pct(st.acc)} correct)` : ''}</p>
    <div class="choices">
      <label class="choice"><input type="radio" name="mode" id="modeExam" value="exam" ${mode === 'exam' ? 'checked' : ''}><span><b>Exam mode</b><br><span class="muted small">${mins} minute timer. Mark questions for review. Score report at the end.</span></span></label>
      <label class="choice"><input type="radio" name="mode" id="modePractice" value="practice" ${mode === 'practice' ? 'checked' : ''}><span><b>Practice mode</b><br><span class="muted small">No timer. Check each answer, read the explanation and watch your score build up at the top.</span></span></label>
    </div>
    <label class="row small"><input type="checkbox" id="shuf"> Shuffle question order</label>
    ${st.att && st.att < st.n ? `<label class="row small"><input type="checkbox" id="onlyNew"> Only questions I haven't tried yet (${st.n - st.att})</label>` : ''}
    ${busy ? `<p class="small" style="color:var(--flag)">Starting replaces your unfinished attempt at ${esc(session.label)}.</p>` : ''}
    <div class="row"><button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="begin">Start</button></div>`);
}

function begin() {
  const mode = $('#modePractice').checked ? 'practice' : 'exam';
  let nums = pending.nums.slice();
  if ($('#onlyNew')?.checked) nums = nums.filter(n => !progress[n] && Q(n).answer.length);
  if (!nums.length) { closeModal(); toast('You have already tried every question in this set.'); return; }
  const order = $('#shuf').checked ? shuffle(nums) : nums;
  session = { bankRev: bank.rev, key: pending.key, label: pending.label, mode, order, idx: 0, answers: {}, flags: {}, checked: {},
    startedAt: Date.now(), endsAt: mode === 'exam' ? Date.now() + order.length * settings.minutesPerQ * 60000 : null, done: false };
  saveSession(); closeModal(); renderExam();
}

/* ---------- Exam ---------- */
function practiceStrip() {
  const s = session, qs = s.order.map(Q);
  let done = 0, pts = 0;
  s.order.forEach(n => { if (s.checked[n]) { const g = grade(Q(n), s.answers[n]); if (g != null) { done++; pts += g; } } });
  const scorable = qs.filter(q => q.answer.length).length;
  const overall = progStats(qs);
  const cur = Q(s.order[s.idx]);
  const sec = progStats(bank.questions.filter(q => q.section === cur.section));
  return `<span class="lbl">This session</span>
    <span class="it">Checked <b>${done}</b> of ${scorable}</span>
    <span class="it">Correct <b>${Math.round(pts * 10) / 10}</b></span>
    <span class="it">Score <b>${done ? pct(pts / done) : '–'}</b></span>
    ${stack({ n: scorable, att: done, pts })}
    <span class="it" title="${esc(cur.section)}">Section overall <b>${sec.att}/${sec.n}</b> · ${sec.acc == null ? '–' : pct(sec.acc)}</span>
    <span class="it">This set overall <b>${overall.att}/${overall.n}</b></span>`;
}

function examBand() {
  const s = session, n = s.order.length;
  const answered = s.order.filter(k => (s.answers[k] || []).length).length;
  const time = s.endsAt ? `<span>Time remaining <b class="timer${s.endsAt - Date.now() < 300000 ? ' low' : ''}" id="timer">${clock(s.endsAt - Date.now())}</b></span>`
                        : `<span>Elapsed <b class="timer" id="timer">${clock(Date.now() - s.startedAt)}</b></span>`;
  setBand(`${bank.title ? bank.title + ' · ' : ''}${s.label}`,
    `${time}<span>${view === 'review' ? 'Review' : `Question <b class="num">${s.idx + 1}</b> of <b class="num">${n}</b>`}</span><span class="num">${answered} answered</span>`,
    answered / n, s.mode === 'practice' ? practiceStrip() : '');
}

function renderExam() {
  view = 'exam';
  const s = session, q = Q(s.order[s.idx]), n = s.order.length;
  const sel = s.answers[q.num] || [], checked = !!s.checked[q.num], practice = s.mode === 'practice';
  const type = q.multi ? 'checkbox' : 'radio';
  const need = q.answer.length || '';
  const instr = q.multi ? `Select ${need ? ['', 'one', 'two', 'three', 'four', 'five'][need] || need : 'all'} answers. Each correct selection is worth one point.` : 'Select the correct answer.';
  const opts = q.options.map(o => {
    let cls = sel.includes(o.key) ? 'sel' : '';
    if (checked) {
      const isAns = q.answer.includes(o.key), picked = sel.includes(o.key);
      cls = isAns && picked ? 'right' : picked ? 'wrong' : isAns ? 'missed' : '';
      cls += ' locked';
    }
    return `<label class="opt ${cls}"><input type="${type}" name="opt" value="${o.key}" ${sel.includes(o.key) ? 'checked' : ''} ${checked ? 'disabled' : ''}>
      <span class="key">${o.key}.</span><span class="otext">${fmt(o.text)}</span></label>`;
  }).join('');
  let fb = '';
  if (checked) {
    const g = grade(q, sel);
    fb = `<div class="feedback ${g === 1 ? 'good' : 'bad'}"><div class="verdict">${g == null ? 'No answer key for this question' : g === 1 ? 'Correct' : g > 0 ? 'Partly correct' : 'Incorrect'}</div>
      ${q.answer.length ? `<div>Correct answer: <b>${q.answer.join(', ')}</b></div>` : ''}
      ${q.explanation ? `<div class="exp">${fmt(q.explanation)}</div>` : ''}</div>`;
  }
  const last = s.idx === n - 1;
  const canCheck = practice && !checked && q.answer.length;
  examBand();
  $('#view').innerHTML = `<main class="exam-body wrap"><div class="qcard">
      <div class="qhead"><span class="qn">Question ${s.idx + 1}</span><span class="muted small num">Dump #${q.num}</span>
        ${practice || checked ? `<div class="tags"><span class="tag" title="${esc(q.section)}">${esc(q.section)}</span><span class="tag" title="${esc(q.topic)}">${esc(q.topic)}</span></div>` : ''}</div>
      <div class="stem">${fmt(q.stem)}</div>
      <p class="instr">${instr}</p>
      <fieldset class="opts" id="opts"><legend hidden>Answer options</legend>${opts}</fieldset>
      ${fb}
    </div></main>
    <div class="actionbar"><div class="wrap">
      <div class="grp"><button class="btn ${s.flags[q.num] ? 'flagged' : ''}" data-act="flag" aria-pressed="${!!s.flags[q.num]}">${s.flags[q.num] ? 'Marked for review' : 'Mark for review'}</button></div>
      <div class="grp">
        <button class="btn" data-act="prev" ${s.idx === 0 ? 'disabled' : ''}>Previous</button>
        ${canCheck ? `<button class="btn primary" data-act="check" ${sel.length ? '' : 'disabled'}>Check answer</button>` : ''}
        ${last ? `<button class="btn ${canCheck ? '' : 'primary'}" data-act="review">Review</button>`
               : `<button class="btn ${canCheck ? '' : 'primary'}" data-act="next">Next</button>`}
        ${last ? '' : '<button class="btn" data-act="review">Review</button>'}
        <button class="btn danger" data-act="end">End ${practice ? 'practice' : 'exam'}</button>
      </div>
    </div></div>`;
  window.scrollTo(0, 0);
}

function onOptChange() {
  const s = session, q = Q(s.order[s.idx]);
  const sel = [...document.querySelectorAll('#opts input:checked')].map(i => i.value);
  s.answers[q.num] = sel; saveSession();
  document.querySelectorAll('#opts .opt').forEach(l => l.classList.toggle('sel', l.querySelector('input').checked));
  const c = $('[data-act="check"]'); if (c) c.disabled = !sel.length;
  examBand();
}

function renderReview() {
  view = 'review';
  const s = session;
  const items = s.order.map((num, i) => ({ i, num, answered: (s.answers[num] || []).length > 0, flagged: !!s.flags[num] }));
  const filt = { all: () => true, incomplete: x => !x.answered, marked: x => x.flagged }[reviewFilter];
  const shown = items.filter(filt);
  const nInc = items.filter(x => !x.answered).length, nMark = items.filter(x => x.flagged).length;
  examBand();
  $('#view').innerHTML = `<main class="exam-body wrap">
    <div class="review-head"><h1>Review</h1>
      <p class="muted">Select a question to go back to it. Unanswered questions are scored as incorrect.</p>
      <div class="legend"><span>Unanswered</span><span class="a">Answered</span><span class="f">Marked for review</span></div>
      <div class="tabs" role="tablist">
        ${[['all', `All (${items.length})`], ['incomplete', `Incomplete (${nInc})`], ['marked', `Marked (${nMark})`]].map(([k, l]) =>
          `<button role="tab" aria-selected="${reviewFilter === k}" data-act="rfilter" data-f="${k}">${l}</button>`).join('')}
      </div>
    </div>
    ${shown.length ? `<div class="tiles">${shown.map(x => `<button class="tile ${x.answered ? 'answered' : ''} ${x.flagged ? 'flagged' : ''} ${x.i === s.idx ? 'cur' : ''}" data-act="goto" data-i="${x.i}">${x.i + 1}<small>${x.answered ? 'Answered' : 'Open'}</small></button>`).join('')}</div>`
      : `<p class="muted">No questions in this view.</p>`}
  </main>
  <div class="actionbar"><div class="wrap">
    <div class="grp"><button class="btn" data-act="back-q">Return to question ${s.idx + 1}</button></div>
    <div class="grp">${nInc ? `<button class="btn" data-act="first-open">First unanswered</button>` : ''}${nMark ? `<button class="btn" data-act="first-marked">First marked</button>` : ''}
      <button class="btn primary" data-act="end">End ${s.mode === 'practice' ? 'practice' : 'exam'}</button></div>
  </div></div>`;
  window.scrollTo(0, 0);
}

function confirmEnd() {
  const s = session;
  const nInc = s.order.filter(k => !(s.answers[k] || []).length).length, nMark = s.order.filter(k => s.flags[k]).length;
  modal(`<h2>End the ${s.mode === 'practice' ? 'practice session' : 'exam'}?</h2>
    <p>${nInc || nMark ? `You have <b>${nInc}</b> unanswered and <b>${nMark}</b> marked question${nMark === 1 ? '' : 's'}.` : 'You have answered every question.'}
    You can't change answers after you end.</p>
    <div class="row"><button class="btn" data-act="close" autofocus>Keep going</button><button class="btn primary" data-act="finish">End and see results</button></div>`);
}

/* ---------- Scoring ---------- */
function grade(q, sel) {
  if (!q.answer.length) return null;
  const s = new Set(sel || []);
  if (!q.multi) return s.size === 1 && q.answer.includes([...s][0]) ? 1 : 0;
  let hit = 0, miss = 0;
  s.forEach(k => q.answer.includes(k) ? hit++ : miss++);
  return Math.max(0, hit - miss) / q.answer.length;
}

function computeResult(s) {
  const rows = s.order.map(num => { const q = Q(num); return { q, sel: s.answers[num] || [], g: grade(q, s.answers[num]), flagged: !!s.flags[num] }; });
  const scored = rows.filter(r => r.g != null);
  const pts = scored.reduce((a, r) => a + r.g, 0);
  const score = scored.length ? Math.round(pts / scored.length * 1000) : 0;
  const secs = new Map();
  rows.forEach(r => {
    if (r.g == null) return;
    if (!secs.has(r.q.section)) secs.set(r.q.section, { pts: 0, n: 0, topics: new Map() });
    const S = secs.get(r.q.section); S.pts += r.g; S.n++;
    if (!S.topics.has(r.q.topic)) S.topics.set(r.q.topic, { pts: 0, n: 0 });
    const T = S.topics.get(r.q.topic); T.pts += r.g; T.n++;
  });
  return { rows, score, pass: score >= settings.passing, correct: scored.filter(r => r.g === 1).length, total: scored.length,
    unanswered: rows.filter(r => !r.sel.length).length, secs };
}

function finish() {
  const s = session; if (!s || s.done) return;
  s.done = true; s.endedAt = Math.min(Date.now(), s.endsAt || Infinity);
  const r = computeResult(s);
  // Practice answers are recorded when checked; the rest are recorded now. Unanswered questions don't count as attempted.
  Data.record(r.rows.filter(x => x.g != null && x.sel.length && !s.checked[x.q.num]).map(x => ({ num: x.q.num, g: x.g })));
  Data.addAttempt({ date: Date.now(), bankId: bank.id, key: s.key, label: s.label, mode: s.mode, score: r.score, pass: r.pass, correct: r.correct, total: r.total });
  saveSession(); closeModal();
  resFilter = 'all'; renderResults();
}

const tone = p => p >= .8 ? 'var(--good)' : p >= .6 ? 'var(--flag)' : 'var(--bad)';

function renderResults() {
  view = 'results';
  const s = session, r = computeResult(s);
  setBand(`${bank.title ? bank.title + ' · ' : ''}${s.label}`, `<span>Score report</span>${accountHtml()}`);
  const passPct = settings.passing / 10;
  const perf = [...r.secs.entries()].map(([name, S]) => {
    const p = S.pts / S.n;
    return `<div class="perf-row"><span>${esc(name)}</span><div class="bar"><i style="width:${(p * 100).toFixed(0)}%;background:${tone(p)}"></i></div><span class="pct">${Math.round(p * 100)}%</span></div>` +
      [...S.topics.entries()].map(([tn, T]) => { const tp = T.pts / T.n;
        return `<div class="perf-row sub"><span>${esc(tn)} <span class="num">(${Math.round(T.pts * 10) / 10}/${T.n})</span></span><div class="bar"><i style="width:${(tp * 100).toFixed(0)}%;background:${tone(tp)}"></i></div><span class="pct">${Math.round(tp * 100)}%</span></div>`; }).join('');
  }).join('');
  const filt = { all: () => true, wrong: x => x.g != null && x.g < 1, marked: x => x.flagged }[resFilter];
  const nWrong = r.rows.filter(x => x.g != null && x.g < 1).length, nMark = r.rows.filter(x => x.flagged).length;
  const list = r.rows.map((x, i) => ({ ...x, i })).filter(filt).map(x => {
    const cls = x.g == null ? 'none' : x.g === 1 ? 'good' : x.g > 0 ? 'part' : 'bad';
    const verdict = x.g == null ? 'Not scored' : x.g === 1 ? 'Correct' : x.g > 0 ? 'Partly correct' : x.sel.length ? 'Incorrect' : 'Not answered';
    return `<article class="aitem ${cls}">
      <div class="row" style="justify-content:space-between"><b>Question ${x.i + 1} <span class="muted small num">· Dump #${x.q.num}</span></b>
        <span class="row small">${x.flagged ? '<span class="pill flag">Marked</span>' : ''}<span class="pill ${x.g === 1 ? 'pass' : x.g == null ? '' : 'fail'}">${verdict}</span></span></div>
      <div class="tags"><span class="tag">${esc(x.q.section)}</span><span class="tag">${esc(x.q.topic)}</span></div>
      <div class="stem">${fmt(x.q.stem)}</div>
      <div class="ol">${x.q.options.map(o => { const a = x.q.answer.includes(o.key), p = x.sel.includes(o.key);
        return `<div><span class="${a ? 'c' : p ? 'w' : 'muted'}">${o.key}.</span><span class="${a ? 'c' : p ? 'w' : ''}">${fmt(o.text)}${p ? ' <span class="muted small">(your answer)</span>' : ''}</span></div>`; }).join('')}</div>
      ${x.q.explanation ? `<div class="exp">${fmt(x.q.explanation)}</div>` : ''}
    </article>`;
  }).join('');
  const used = (s.endedAt || Date.now()) - s.startedAt;

  $('#view').innerHTML = `<main class="results wrap">
    <section class="scorecard">
      <div><span class="eyebrow">${s.mode === 'exam' ? 'Exam mode' : 'Practice mode'} · ${new Date(s.endedAt || Date.now()).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span><h1>${esc(s.label)}</h1></div>
      <div class="score-row">
        <div><div class="muted small">Your score</div><div class="score">${r.score}<small> / 1000</small></div></div>
        <div><span class="pill ${r.pass ? 'pass' : 'fail'}" style="font-size:.9rem;padding:4px 12px">${r.pass ? 'Pass' : 'Fail'}</span></div>
      </div>
      <div>
        <div class="scale"><div class="fill" style="width:${r.score / 10}%;background:${r.pass ? 'var(--good)' : 'var(--bad)'}"></div>
          <div class="mark" style="left:${passPct}%"><span>Passing ${settings.passing}</span></div></div>
        <div class="scale-ticks"><span>0</span><span>1000</span></div>
      </div>
      <div class="kv">
        <div><span class="muted small">Correct</span><b>${r.correct} of ${r.total}</b></div>
        <div><span class="muted small">Unanswered</span><b>${r.unanswered}</b></div>
        <div><span class="muted small">Marked</span><b>${nMark}</b></div>
        <div><span class="muted small">Time used</span><b>${clock(used)}</b></div>
      </div>
      <p class="muted small">Score is the share of points earned, scaled to 1000. Multiple-answer questions give partial credit: one point per correct selection, minus wrong ones.${sb && !user ? ' Sign in to save this result to your account.' : ''}</p>
    </section>
    <section><div class="sec-head"><h2>Performance by section</h2><span class="muted small">Green 80%+, amber 60–79%, red under 60%</span></div><div class="perf">${perf || '<p class="muted" style="padding:10px 16px">No scored questions.</p>'}</div></section>
    <section>
      <div class="sec-head"><h2>Answer review</h2></div>
      <div class="tabs" role="tablist" style="margin-bottom:14px">${[['all', `All (${r.rows.length})`], ['wrong', `Incorrect (${nWrong})`], ['marked', `Marked (${nMark})`]].map(([k, l]) =>
        `<button role="tab" aria-selected="${resFilter === k}" data-act="resfilter" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="alist">${list || '<p class="muted">Nothing here.</p>'}</div>
    </section>
    <div class="row"><button class="btn primary" data-act="home">Back to exams</button>
      <button class="btn" data-act="retake">Retake ${esc(s.label)}</button>
      ${nWrong ? `<button class="btn" data-act="retake-wrong">Practice the ${nWrong} I got wrong</button>` : ''}</div>
  </main>`;
  window.scrollTo(0, 0);
}

/* ---------- Events ---------- */
const go = i => { session.idx = Math.max(0, Math.min(session.order.length - 1, i)); saveSession(); renderExam(); };
const ACT = {
  'start-exam': b => { const s = examSets()[+b.dataset.i]; setup(s.label, s.key, s.qs, 'exam'); },
  'start-sec': (b, e) => { e.preventDefault(); const tr = tree(bank.questions), sec = [...tr.keys()][+b.dataset.s]; setup(sec, 'sec:' + sec, [...tr.get(sec).values()].flat(), 'practice'); },
  'start-topic': b => { const tr = tree(bank.questions), sec = [...tr.keys()][+b.dataset.s], [tn, qs] = [...tr.get(sec).entries()][+b.dataset.t]; setup(tn, 'topic:' + sec + '/' + tn, qs, 'practice'); },
  'start-all': () => setup('All questions', 'all', bank.questions, 'practice'),
  'goto-loader': () => { const d = $('#loader details.guide'); if (d && !$('#dumpText')?.offsetParent) d.open = true; $('#loader').scrollIntoView({ block: 'start' }); $('#dumpText')?.focus({ preventScroll: true }); },
  'load': () => doLoad(),
  'site-dump': async () => { source = null; store.del('mec.source'); loadBank(); await switchBank(); loaderMsg = null; renderHome(); toast('Switched back to the site\'s exam.'); },
  'copy-tpl': b => { const done = () => { b.textContent = 'Copied'; }; try { navigator.clipboard.writeText(TEMPLATE).then(done, selectTpl); } catch (e) { selectTpl(); } },
  'reset': () => modal(`<h2>Reset your progress?</h2><p>This clears every practised answer and all ${plural(history.length, 'attempt')} for ${esc(bank.title || 'this exam')}${user ? ' from your account' : ' in this browser'}. It can't be undone.</p><div class="row"><button class="btn" data-act="close" autofocus>Cancel</button><button class="btn primary" data-act="reset-yes">Reset progress</button></div>`),
  'reset-yes': async () => { closeModal(); await Data.reset(); renderHome(); toast('Progress reset.'); },
  'resume': () => session.done ? renderResults() : renderExam(),
  'discard': () => { session = null; store.del('mec.session'); renderHome(); },
  'close': closeModal,
  'scrim': (b, e) => { if (e.target === b) closeModal(); },
  'begin': begin,
  'auth': b => authModal(b.dataset.tab),
  'signout': async () => { await sb.auth.signOut(); toast('Signed out.'); },
  'prev': () => go(session.idx - 1),
  'next': () => go(session.idx + 1),
  'flag': () => { const n = session.order[session.idx]; session.flags[n] = !session.flags[n]; saveSession(); renderExam(); },
  'check': () => {
    const n = session.order[session.idx]; session.checked[n] = true; saveSession();
    const g = grade(Q(n), session.answers[n]); if (g != null) Data.record([{ num: n, g }]);
    renderExam();
  },
  'review': () => { reviewFilter = 'all'; renderReview(); },
  'rfilter': b => { reviewFilter = b.dataset.f; renderReview(); },
  'goto': b => go(+b.dataset.i),
  'back-q': () => renderExam(),
  'first-open': () => go(session.order.findIndex(k => !(session.answers[k] || []).length)),
  'first-marked': () => go(session.order.findIndex(k => session.flags[k])),
  'end': confirmEnd,
  'finish': finish,
  'resfilter': b => { resFilter = b.dataset.f; renderResults(); },
  'home': () => renderHome(),
  'retake': () => setup(session.label, session.key, session.order.slice().sort((a, b) => a - b).map(Q), session.mode),
  'retake-wrong': () => { const r = computeResult(session); setup(session.label + ' · incorrect', session.key + ':wrong', r.rows.filter(x => x.g != null && x.g < 1).map(x => x.q), 'practice'); }
};
function selectTpl() { const r = document.createRange(); r.selectNodeContents($('#tpl')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const f = ACT[b.dataset.act]; if (f) f(b, e); });
document.addEventListener('change', e => { if (e.target.name === 'opt' && view === 'exam') onOptChange(); });
document.addEventListener('submit', e => { if (e.target.id === 'authForm') { e.preventDefault(); submitAuth(e.target); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modalRoot').innerHTML) { closeModal(); return; }
  if (view !== 'exam' || $('#modalRoot').innerHTML || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.tagName === 'INPUT' && e.target.type !== 'radio' && e.target.type !== 'checkbox')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (e.target.name === 'opt') e.preventDefault();
    if (e.key === 'ArrowRight' && session.idx < session.order.length - 1) go(session.idx + 1);
    else if (e.key === 'ArrowLeft' && session.idx > 0) go(session.idx - 1);
    return;
  }
  const k = e.key.toUpperCase();
  if (k.length === 1 && LETTERS.includes(k)) {
    const inp = document.querySelector(`#opts input[value="${k}"]`);
    if (inp && !inp.disabled) { inp.checked = inp.type === 'radio' ? true : !inp.checked; onOptChange(); }
  }
});

setInterval(() => {
  if (!session || session.done || (view !== 'exam' && view !== 'review')) return;
  const t = $('#timer'); if (!t) return;
  if (session.endsAt) {
    const left = session.endsAt - Date.now();
    t.textContent = clock(left); t.classList.toggle('low', left < 300000);
    if (left <= 0) finish();
  } else t.textContent = clock(Date.now() - session.startedAt);
}, 1000);

/* ---------- Boot ---------- */
async function fetchSiteDump() {
  for (const f of ['dump.txt', 'dump.json']) {
    try { const r = await fetch(f, { cache: 'no-cache' }); if (r.ok) { const t = await r.text(); if (t.trim() && !/^\s*</.test(t)) return t; } } catch (e) {}
  }
  return null;
}
(async function boot() {
  siteText = await fetchSiteDump();
  loadBank();
  if (session && session.bankRev !== bank.rev) { session = null; store.del('mec.session'); }
  try { await initAuth(); } catch (e) { toast('Accounts are unavailable right now. Progress will save in this browser.'); }
  await Data.load();
  if (session && !session.done && session.endsAt && session.endsAt <= Date.now()) finish();
  else renderHome();
})();
