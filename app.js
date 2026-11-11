/* Mock Exam Center
   Static app: index.html + styles.css + app.js + config.js. People upload their own exam dump; an optional dump.txt preloads one for everyone.
   Accounts and cloud progress use Supabase when config.js has keys; otherwise everything is stored in the browser. */

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
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(4000, text.length * 60)); }

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
  const lines = text.replace(/\r/g, '').replace(/[   \t]/g, ' ').split('\n');
  const reTitle = /^\s*#*\s*(?:exam(?:\s+title)?|title)\s*[:\-–]\s*(.+)$/i;
  const reSec = /^\s*#*\s*(?:section|domain|module|skill area)\s*\d*\s*[:\-–]\s*(.+)$/i;
  const reTop = /^\s*#*\s*(?:topic|sub-?topic|objective)\s*[\d.]*\s*[:\-–,]\s*(\S.+)$/i;   // Topic: X · Topic 2 - X · Topic 3, Contoso case study
  const reBareTopic = /^\(?\s*(?:exam\s+)?topic\s*\d+\s*\)?$/i;                          // "Topic 1" on its own: a page heading with no name
  // QUESTION 1 · NEW QUESTION 1 · QUESTION NO: 1 · Question #1 Topic 1 · Question: 1 · Question 1 of 300 · Q1.
  const reQ = /^\s*[#*]*\s*(?:new\s+)?(?:question|q)\s*(?:no\.?|number|#)?\s*[:.#\-–]?\s*(\d{1,4})\b(?:\s*(?:of|\/)\s*\d+)?\s*\**\s*[:.)\-–]?\s*(.*)$/i;
  const reNum = /^\s*(\d{1,4})\s*[.)]\s*(.*)$/;                       // 12. Question text   (dumps with no "Question" label)
  const reOpt = /^\s*\(?([A-Ja-j])\s*[.):]\s*(\S.*)$/;                 // A. / A) / (A) / A:
  const reAns = /^\s*\**\s*(?:the\s+)?(?:correct|suggested|right|best|most\s+voted)?\s*(?:answers?|ans)\s*(?:\(s\))?\s*(?:is|are)?\s*\**\s*[:\-–.=]?\s*(.*)$/i;
  const reExp = /^\s*\**\s*(?:explanation|rationale|reasoning|references?)(?:\s*\/\s*references?)?\s*\**\s*(?:[:\-–]\s*(.*))?$/i;
  const reTopicTag = /^[-–:]?\s*\(?\s*(?:exam\s+)?topic\s*\d+\s*\)?\s*/i;
  const isNone = v => /^[\[(]?\s*none\s*[\])]?$/i.test(v);
  let title = '', section = 'General', topic = 'General';
  const list = [], stats = { skipped: 0 };
  let q = null, mode = 'stem', lastNum = 0, labelled = false;
  const newQ = (num, first) => {
    finishQuestion(q, list, stats);
    q = { label: num, stem: (first || '').replace(reTopicTag, ''), options: [], answer: [], explanation: '', section, topic };
    mode = 'stem'; lastNum = num;
  };
  const addExp = t => { q.explanation += (q.explanation ? '\n' : '') + t; };
  // "A. Yes B. No" on one line becomes two options.
  const addOptions = (key, text, lower) => {
    let i = LETTERS.indexOf(key);
    while (i < LETTERS.length - 1) {
      const next = lower ? LETTERS[i + 1].toLowerCase() : LETTERS[i + 1];
      const m = text.match(new RegExp(`\\s\\(?${next}[.)]\\s+`));
      if (!m) break;
      q.options.push({ key: LETTERS[i], text: text.slice(0, m.index).trim() });
      text = text.slice(m.index + m[0].length); i++;
    }
    q.options.push({ key: LETTERS[i], text: text.trim() });
  };

  // An answer key listed separately ("1. B", "2) A, C", ...) is matched to questions by number afterwards.
  const reKey = /^\s*(?:q(?:uestion)?\s*)?(\d{1,4})\s*[.):\-–]?\s*([A-J](?:\s*[,&\/]?\s*[A-J]){0,5})\s*$/i;
  const keyLines = new Map();
  lines.forEach((l, i) => { const m = l.match(reKey); if (m) keyLines.set(i, [+m[1], parseAnswerLetters(m[2])]); });
  const useKey = keyLines.size >= 5, keyed = {};

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    let m;
    if (useKey && keyLines.has(li)) { const [n, a] = keyLines.get(li); keyed[n] = a; continue; }
    if (!line || /^[-=_*]{3,}$/.test(line)) { if (q && mode === 'stem' && q.stem) q.stem += '\n'; continue; }
    if (!title && !q && (m = line.match(reTitle))) { title = m[1].trim(); continue; }
    if ((m = line.match(reSec))) {
      if (isNone(m[1].trim())) continue;
      section = m[1].trim(); topic = 'General';
      if (q && !q.options.length && !q.stem.trim()) { q.section = section; q.topic = topic; }
      continue;
    }
    if ((m = line.match(reTop))) { topic = m[1].trim(); if (q && !q.options.length && !q.stem.trim()) q.topic = topic; continue; }
    if ((m = line.match(reQ))) { labelled = true; newQ(+m[1], m[2]); continue; }
    // Bare "12." starts a question only in dumps without "Question" labels, and only as the next number in sequence.
    if (!labelled && (m = line.match(reNum)) && (!q || (+m[1] === lastNum + 1 && mode !== 'stem'))) { newQ(+m[1], m[2]); continue; }
    if (!q) continue;
    if (reBareTopic.test(line) || (mode === 'stem' && !q.stem.trim() && reTopicTag.test(line) && !line.replace(reTopicTag, ''))) continue;
    if (mode === 'ans') {
      const letters = parseAnswerLetters(line);
      if (letters.length && line.length <= 24) { q.answer = letters; q.answerText = line; mode = 'after'; continue; }
      mode = 'exp';
    }
    if (q.options.length && !q.answer.length && mode !== 'exp' && (m = line.match(reAns))) {
      q.answer = parseAnswerLetters(m[1]); q.answerText = m[1];
      mode = q.answer.length || q.answerText.trim() ? 'after' : 'ans';
      continue;
    }
    if (q.options.length && (m = line.match(reExp))) { if (m[1]) addExp(m[1]); mode = 'exp'; continue; }
    if (mode === 'exp' || mode === 'after' || mode === 'ans') { addExp(line); mode = 'exp'; continue; }
    if ((m = line.match(reOpt)) && (mode === 'opts' || q.stem.trim())) {
      const key = m[1].toUpperCase();
      if (key === LETTERS[q.options.length]) { addOptions(key, m[2], m[1] !== key); mode = 'opts'; continue; }
    }
    if (mode === 'opts') { const o = q.options[q.options.length - 1]; o.text += ' ' + line; continue; }
    q.stem += (q.stem && !q.stem.endsWith('\n') ? '\n' : '') + line;
  }
  finishQuestion(q, list, stats);
  list.forEach(x => { if (!x.answer.length && keyed[x.label]) x.answer = keyed[x.label].filter(k => x.options.some(o => o.key === k)); });
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

function parseDump(text, fileName) {
  const t = text.trim();
  const r = /^[\[{]/.test(t) ? parseJSON(t) : parseText(t);
  // No "Exam:" line? Name it after the file, e.g. "AZ-104 dump v3.pdf" → "AZ-104 dump v3".
  if (!r.title && fileName && fileName !== 'pasted text') r.title = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  r.questions.forEach((q, i) => { q.num = i + 1; q.multi = q.answer.length > 1 || (!q.answer.length && /choose\s+(two|three|four|2|3|4)|select\s+(two|three|2|3)/i.test(q.stem)); });
  autoGroup(r);
  r.rev = hash(t);
  // Progress is keyed by exam title, so fixing a typo in the dump keeps everyone's progress.
  r.id = slug(r.title) || r.rev;
  return r;
}

/* ---------- Automatic topics ---------- */
// When a dump doesn't name its sections or topics, questions are sorted into Microsoft exam subject areas by keywords in the question and options.
const TAXONOMY = [
  ['Identity and access', [
    ['Users, groups and Entra ID', ['entra', 'entra id', 'azure ad', 'azure active directory', 'tenant', 'guest user', 'external user', 'b2b', 'b2c', 'security group', 'microsoft 365 group', 'dynamic group', 'group membership', 'directory', 'entra connect', 'ad connect', 'custom domain', 'administrative unit']],
    ['Sign-in and MFA', ['mfa', 'multi-factor', 'multifactor', 'conditional access', 'sign-in', 'single sign-on', 'sso', 'passwordless', 'password', 'sspr', 'self-service password reset', 'identity protection', 'authentication']],
    ['Roles and permissions', ['rbac', 'role-based access', 'role assignment', 'owner role', 'contributor', 'reader role', 'custom role', 'privileged identity management', 'pim', 'least privilege', 'permission', 'managed identity', 'service principal', 'app registration']]]],
  ['Governance and cost', [
    ['Policy, locks and tags', ['azure policy', 'policy definition', 'initiative', 'resource lock', 'lock', 'tag', 'blueprint', 'management group', 'compliance', 'governance']],
    ['Subscriptions and cost', ['subscription', 'cost', 'budget', 'pricing', 'billing', 'reservation', 'reserved instance', 'tco', 'azure advisor', 'sla', 'service level agreement', 'quota']]]],
  ['Storage', [
    ['Storage accounts and redundancy', ['storage account', 'lrs', 'zrs', 'grs', 'ra-grs', 'gzrs', 'redundancy', 'replication', 'access tier', 'hot tier', 'cool tier', 'cold tier', 'archive tier', 'lifecycle management', 'immutable']],
    ['Blobs, files and data transfer', ['blob', 'blob container', 'azure files', 'file share', 'smb', 'azcopy', 'storage explorer', 'data box', 'file sync', 'shared access signature', 'sas', 'access key', 'import/export']]]],
  ['Compute', [
    ['Virtual machines', ['virtual machine', 'vm', 'scale set', 'vmss', 'availability set', 'availability zone', 'managed disk', 'disk', 'vm size', 'resize', 'bastion', 'rdp', 'ssh', 'dedicated host', 'spot']],
    ['App Service and serverless', ['app service', 'web app', 'app service plan', 'deployment slot', 'azure functions', 'function app', 'logic app', 'serverless', 'autoscale', 'scale out', 'static web app']],
    ['Containers', ['container instance', 'aci', 'kubernetes', 'aks', 'docker', 'container registry', 'acr', 'container apps', 'pod', 'node pool']],
    ['Templates and automation', ['arm template', 'resource manager template', 'bicep', 'template', 'powershell', 'azure cli', 'cloud shell', 'azure automation', 'runbook', 'terraform', 'desired state']]]],
  ['Networking', [
    ['Virtual networks and security', ['virtual network', 'vnet', 'subnet', 'network security group', 'nsg', 'application security group', 'peering', 'route table', 'user-defined route', 'udr', 'service endpoint', 'private endpoint', 'private link', 'azure firewall', 'firewall', 'ip address', 'public ip', 'nat gateway']],
    ['Hybrid connectivity', ['vpn', 'vpn gateway', 'expressroute', 'site-to-site', 'point-to-site', 'virtual wan', 'on-premises network', 'local network gateway', 'virtual network gateway']],
    ['Load balancing and DNS', ['load balancer', 'application gateway', 'front door', 'traffic manager', 'dns', 'cdn', 'waf', 'web application firewall', 'private dns zone']]]],
  ['Monitoring and recovery', [
    ['Monitoring and alerts', ['azure monitor', 'log analytics', 'kql', 'kusto', 'alert', 'action group', 'metric', 'diagnostic setting', 'application insights', 'workbook', 'network watcher', 'service health', 'activity log', 'connection monitor']],
    ['Backup and disaster recovery', ['backup', 'recovery services vault', 'site recovery', 'restore', 'disaster recovery', 'snapshot', 'backup policy', 'failover', 'rpo', 'rto']]]],
  ['Security', [
    ['Threat protection', ['defender', 'microsoft defender', 'sentinel', 'siem', 'soar', 'security center', 'secure score', 'threat', 'vulnerability', 'ddos', 'incident', 'just-in-time']],
    ['Keys, secrets and data protection', ['key vault', 'secret', 'certificate', 'encryption', 'encrypt', 'purview', 'information protection', 'sensitivity label', 'dlp', 'data loss prevention', 'retention label', 'ediscovery']]]],
  ['Data and AI', [
    ['Databases', ['sql', 'sql database', 'database', 'cosmos db', 'mysql', 'postgresql', 'table storage', 'managed instance', 'elastic pool', 'dtu', 'vcore']],
    ['Analytics', ['synapse', 'data factory', 'databricks', 'data lake', 'stream analytics', 'event hubs', 'power bi', 'fabric', 'lakehouse', 'warehouse', 'dax', 'semantic model', 'report', 'dashboard']],
    ['AI services', ['openai', 'azure openai', 'cognitive services', 'ai services', 'machine learning', 'language service', 'computer vision', 'vision', 'speech', 'bot', 'copilot', 'responsible ai', 'document intelligence', 'ai search']]]],
  ['Microsoft 365 and Power Platform', [
    ['Microsoft 365 apps and devices', ['microsoft 365', 'office 365', 'exchange', 'exchange online', 'sharepoint', 'onedrive', 'teams', 'mailbox', 'intune', 'endpoint manager', 'device', 'autopilot', 'windows 365']],
    ['Power Platform and Dynamics', ['power apps', 'power automate', 'power pages', 'dataverse', 'canvas app', 'model-driven', 'cloud flow', 'connector', 'dynamics 365', 'power virtual agents', 'copilot studio']]]],
  ['Development and integration', [
    ['DevOps and source control', ['azure devops', 'devops', 'github', 'repository', 'repo', 'pipeline', 'ci/cd', 'git', 'pull request', 'artifact', 'yaml']],
    ['APIs and messaging', ['api management', 'api', 'service bus', 'event grid', 'queue', 'webhook', 'topic subscription', 'event-driven']]]]
];
const OTHER = ['Other', 'Other questions'];
const kwCache = {};
const kwRe = k => kwCache[k] ||= new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}(s|es)?(?![a-z0-9])`);
function classify(q) {
  const stem = q.stem.toLowerCase(), opts = q.options.map(o => o.text).join(' \n ').toLowerCase();
  let best = OTHER, bestScore = 0;
  for (const [sec, topics] of TAXONOMY) for (const [top, kws] of topics) {
    let s = 0;
    for (const k of kws) { const re = kwRe(k); if (re.test(stem)) s += 2; else if (re.test(opts)) s += 1; }
    if (s > bestScore) { bestScore = s; best = [sec, top]; }
  }
  return best;
}
// Questions the dump puts under a named section or topic keep it; the rest are grouped by subject.
function autoGroup(r) {
  const loose = r.questions.filter(q => q.section === 'General' && q.topic === 'General');
  if (!loose.length) return;
  loose.forEach(q => { [q.section, q.topic] = classify(q); });
  // Named topics with no section (such as case studies) get a heading of their own beside the subject sections.
  r.questions.forEach(q => { if (q.section === 'General') q.section = /case stud/i.test(q.topic) ? 'Case studies' : 'More topics'; });
  r.autoTopics = true;
}
const RANK = new Map();
TAXONOMY.forEach(([sec, topics], i) => { RANK.set(sec, i); topics.forEach(([t], j) => RANK.set(sec + '\u0000' + t, j)); });
RANK.set(OTHER[0], 999);

/* ---------- Reading PDF and Word files ---------- */
// The readers are downloaded only when someone picks a PDF or .docx file.
const LIBS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
};
const scriptLoads = {};
function loadScript(src) {
  return scriptLoads[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => { delete scriptLoads[src]; s.remove(); reject(new Error('Could not download the file reader. Check your internet connection and try again.')); };
    document.head.appendChild(s);
  });
}

const looksLikeContent = l => /^\s*(\(?[A-J][.)]\s|(question|q)\s*#?\d|(correct\s+)?answer|explanation|section|topic)/i.test(l);

async function pdfToText(buf) {
  await loadScript(LIBS.pdf);
  pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const lines = []; let cur = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(cur); cur = ''; }
      if (cur && it.str && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += ' ';
      cur += it.str; lastY = y;
      if (it.hasEOL) { lines.push(cur); cur = ''; lastY = null; }
    }
    if (cur) lines.push(cur);
    pages.push(lines.map(l => l.replace(/\s+/g, ' ').trim()));
  }
  // Drop running headers and footers: lines at the top or bottom of most pages, and bare page numbers.
  const edge = ls => { const f = ls.filter(Boolean); return new Set([...f.slice(0, 2), ...f.slice(-2)]); };
  const seen = new Map();
  pages.forEach(ls => edge(ls).forEach(l => seen.set(l, (seen.get(l) || 0) + 1)));
  const limit = Math.max(3, Math.ceil(pages.length * 0.5));
  const junk = l => !looksLikeContent(l) && ((pages.length >= 4 && seen.get(l) >= limit) || /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l));
  return { text: pages.map(ls => ls.filter(l => !junk(l)).join('\n')).join('\n'), pages: pages.length };
}

// Reads the .docx XML directly so Word's automatic numbering ("1.", "A.", "a)") comes through exactly as it shows in Word.
async function docxToText(buf) {
  await loadScript(LIBS.jszip);
  const zip = await JSZip.loadAsync(buf);
  const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
  const docXml = await read('word/document.xml');
  if (!docXml) throw new Error('This Word file could not be opened. Save it again as .docx and retry.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, name) => el ? [...el.getElementsByTagNameNS(W, name)] : [];
  const kid = (el, name) => kids(el, name)[0];
  const val = (el, name = 'val') => el ? el.getAttributeNS(W, name) || el.getAttribute('w:' + name) : null;

  // Numbering definitions: numId → abstract list → per-level format, label pattern and start value.
  const abstracts = {}, nums = {}, styleNum = {};
  const numXml = await read('word/numbering.xml');
  if (numXml) {
    const nd = xml(numXml);
    kids(nd, 'abstractNum').forEach(a => {
      const lv = {};
      kids(a, 'lvl').forEach(l => { lv[val(l, 'ilvl')] = { fmt: val(kid(l, 'numFmt')) || 'decimal', text: val(kid(l, 'lvlText')) ?? '%1.', start: +(val(kid(l, 'start')) || 1) }; });
      abstracts[val(a, 'abstractNumId')] = lv;
    });
    kids(nd, 'num').forEach(n => { nums[val(n, 'numId')] = val(kid(n, 'abstractNumId')); });
  }
  // List styles such as "List Number" carry their numbering in styles.xml.
  const stylesXml = await read('word/styles.xml');
  if (stylesXml) kids(xml(stylesXml), 'style').forEach(s => { const np = kid(s, 'numPr'); if (np) styleNum[val(s, 'styleId')] = { numId: val(kid(np, 'numId')), ilvl: val(kid(np, 'ilvl')) || '0' }; });

  const roman = n => { let r = ''; [[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']].forEach(([v, s]) => { while (n >= v) { r += s; n -= v; } }); return r; };
  const fmtNum = (n, fmt) => fmt === 'upperLetter' ? LETTERS[(n - 1) % 26] || String.fromCharCode(64 + ((n - 1) % 26) + 1)
    : fmt === 'lowerLetter' ? String.fromCharCode(96 + ((n - 1) % 26) + 1)
    : fmt === 'upperRoman' ? roman(n).toUpperCase() : fmt === 'lowerRoman' ? roman(n) : fmt === 'bullet' || fmt === 'none' ? '' : String(n);
  const counters = {};
  const label = (numId, ilvl) => {
    const lv = abstracts[nums[numId]]; if (!lv || !lv[ilvl]) return '';
    const c = counters[numId] ||= {};
    const lvl = +ilvl;
    c[lvl] = c[lvl] == null ? lv[ilvl].start : c[lvl] + 1;
    Object.keys(c).forEach(k => { if (+k > lvl) delete c[k]; });
    if (lv[ilvl].fmt === 'bullet' || lv[ilvl].fmt === 'none') return '';
    return lv[ilvl].text.replace(/%(\d)/g, (_, d) => { const L = d - 1, def = lv[L] || lv[ilvl]; return fmtNum(c[L] ?? def.start, def.fmt); });
  };

  const out = [];
  kids(xml(docXml), 'p').forEach(p => {
    let t = '';
    p.querySelectorAll('*').forEach(n => {
      if (n.namespaceURI !== W) return;
      if (n.localName === 't') t += n.textContent;
      else if (n.localName === 'tab') t += ' ';
      else if (n.localName === 'br' || n.localName === 'cr') t += '\n';
    });
    const ppr = kid(p, 'pPr');
    const np = ppr && [...ppr.children].find(c => c.localName === 'numPr');
    const st = styleNum[val(ppr && [...ppr.children].find(c => c.localName === 'pStyle'))];
    const numId = np ? val(kid(np, 'numId')) : st && st.numId;
    const ilvl = np ? (val(kid(np, 'ilvl')) || '0') : st && st.ilvl;
    const prefix = numId && numId !== '0' ? label(numId, ilvl) : '';
    out.push(prefix && t.trim() ? prefix + ' ' + t : t);
  });
  return out.join('\n');
}

async function readDumpFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  uploadBusy(`Reading ${f.name}…`);
  try {
    let text;
    if (ext === 'pdf') {
      text = (await pdfToText(await f.arrayBuffer())).text;
      if (!text.trim()) throw new Error('This PDF has no selectable text, so it is probably scanned pages. Run it through OCR first, or paste the text instead.');
    } else if (ext === 'docx') text = await docxToText(await f.arrayBuffer());
    else if (ext === 'doc') throw new Error('Older .doc files can\'t be read. Open the file in Word, save it as .docx, and upload that.');
    else text = await f.text();
    await loadText(text, f.name);
  } catch (err) { uploadFailed(err.message || String(err)); }
}

const DROP_TEXT = 'Drop your exam dump here, or click to choose a file';
function uploadBusy(text) {
  const z = $('#dropzone');
  if (!z) { toast(text); return; }
  z.classList.add('busy'); $('#dropText').textContent = text; $('#dropErr').hidden = true;
}
function uploadFailed(text) {
  const err = $('#dropErr');
  if (!err) { toast(text); return; }   // a replacement upload failed: keep the current exam
  $('#dropzone').classList.remove('busy'); $('#dropText').textContent = DROP_TEXT;
  err.textContent = text; err.hidden = false;
}
async function loadText(text, name) {
  let r;
  try { r = parseDump(text, name); } catch (e) { return uploadFailed('This file looks like JSON but could not be read: ' + e.message); }
  if (!r.questions.length) return uploadFailed('No questions were found in this file. Questions need to be numbered (for example "QUESTION 1"), with lettered options (A. B. C.) and an "Answer:" line.');
  source = { text, name: name || '' };
  const saved = store.set('mec.source', source);
  loadBank(); await switchBank();
  renderHome(); window.scrollTo(0, 0);
  const noKey = bank.questions.filter(q => !q.answer.length).length;
  toast(`Ready: ${bank.questions.length} questions in ${plural(tree(bank.questions).size, 'section')}.` +
    (noKey ? ` ${noKey} ha${noKey === 1 ? 's' : 've'} no answer and won't be scored.` : '') +
    (r.skipped ? ` ${plural(r.skipped, 'question')} without A/B/C options (such as drag-and-drop or hotspot) ${r.skipped === 1 ? 'was' : 'were'} skipped.` : '') +
    (saved ? '' : ' This browser could not save the file, so upload it again after a reload.'));
}

/* ---------- State ---------- */
const DEFAULTS = { examSize: 50, minutesPerQ: 2, passing: 700 };
const CFG = window.MEC_CONFIG || {};
const sb = CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
const settings = { ...DEFAULTS };
let source = store.get('mec.source', null);   // a dump this browser loaded itself
let siteText = null;                           // dump.txt / dump.json deployed with the site
let bank, bankFrom = 'none';
let session = store.get('mec.session', null), view = 'home', reviewFilter = 'all', resFilter = 'all';
let user = null, history = [], progress = {};
let homeTab = store.get('mec.tab', 'exams') === 'topics' ? 'topics' : 'exams';

function loadBank() {
  bank = null;
  for (const [text, from, name] of [[source && source.text, 'local', source && source.name], [siteText, 'site', '']]) {
    if (!text) continue;
    try { const r = parseDump(text, name); if (r.questions.length) { bank = r; bankFrom = from; return; } } catch (e) {}
  }
  bank = { title: '', questions: [], id: 'none', rev: 'none', skipped: 0 }; bankFrom = 'none';
}
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
  if (!bank || !bank.autoTopics) return m;
  // Automatic topics are listed in a fixed subject order rather than the order questions happen to appear.
  const rank = k => RANK.get(k) ?? 500;
  return new Map([...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([s, t]) => [s, new Map([...t.entries()].sort((a, b) => rank(s + '\u0000' + a[0]) - rank(s + '\u0000' + b[0])))]));
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

/* ---------- Upload ---------- */
function renderUpload() {
  view = 'home';
  setBand('Mock Exam Center', accountHtml());
  $('#view').innerHTML = `<main class="upload wrap">
    <div class="hero">
      <h1>Upload your exam dump</h1>
      <p class="muted">The site reads the questions and builds your practice exams: 50 questions each, grouped by the sections and topics in the dump.</p>
    </div>
    <label class="dropzone" id="dropzone" for="file" tabindex="0">
      <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
      <b id="dropText">${DROP_TEXT}</b>
      <span class="muted small">PDF, Word (.docx), .txt or .json</span>
    </label>
    <div class="msg err" id="dropErr" role="alert" hidden></div>
    <details class="guide"><summary>Paste the text instead</summary>
      <div class="form" style="margin-top:12px">
        <textarea id="dumpText" spellcheck="false" placeholder="Paste your exam dump here"></textarea>
        <div class="row"><button class="btn primary" data-act="load-paste">Load questions</button></div>
      </div>
    </details>
  </main>`;
}

/* ---------- Home ---------- */
function renderHome() {
  if (!bank.questions.length) return renderUpload();
  view = 'home';
  setBand('Mock Exam Center', `<span>${esc(bank.title || 'Exam dump')}</span>${accountHtml()}`);
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

  // Practice by topic: one block per section, a card per topic.
  const single = secs.length === 1 && secs[0] === 'General';
  const topicBlocks = secs.map((sec, si) => {
    const topics = [...tr.get(sec).entries()];
    const st = progStats([...tr.get(sec).values()].flat());
    const cards = topics.map(([tn, qs], ti) => { const ts = progStats(qs);
      return `<div class="tcard">
        <div class="tname">${esc(tn)}</div>
        <span class="muted small">${plural(qs.length, 'question')}</span>
        ${stack(ts, 'thin')}
        <span class="small muted num">${ts.att}/${ts.n} done${ts.acc == null ? '' : ` · <b class="tacc">${pct(ts.acc)}</b> correct`}</span>
        <div><button class="btn${ts.att ? '' : ' primary'}" data-act="start-topic" data-s="${si}" data-t="${ti}">${ts.att && ts.att < ts.n ? 'Continue' : ts.att ? 'Practise again' : 'Practise'}</button></div>
      </div>`; }).join('');
    return `<section class="tsec">
      ${single ? '' : `<div class="tsec-head">
        <div class="tsec-title"><h3>${esc(sec)}</h3><span class="muted small">${plural(st.n, 'question')} · ${plural(topics.length, 'topic')} · ${st.att}/${st.n} done${st.acc == null ? '' : ' · ' + pct(st.acc) + ' correct'}</span></div>
        ${stack(st)}
        <button class="btn" data-act="start-sec" data-s="${si}">Practise whole section</button>
      </div>`}
      <div class="topic-grid">${cards}</div>
    </section>`;
  }).join('');
  const mistakes = bank.questions.filter(q => progress[q.num] && progress[q.num].g < 1).length;
  const untried = bank.questions.filter(q => !progress[q.num] && q.answer.length).length;

  const hist = history.slice(0, 10).map(h => `<tr><td class="num">${new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
    <td>${esc(h.label)}</td><td>${h.mode === 'exam' ? 'Exam' : 'Practice'}</td><td class="num">${h.correct}/${h.total}</td>
    <td class="num"><b>${h.score}</b></td><td><span class="pill ${h.pass ? 'pass' : 'fail'}">${h.pass ? 'Pass' : 'Fail'}</span></td></tr>`).join('');

  const resume = session && !session.done ? `<div class="notice resume"><div><b>${esc(session.label)}</b> is in progress
      <span class="muted">· question ${session.idx + 1} of ${session.order.length}${session.endsAt ? ' · ' + clock(session.endsAt - Date.now()) + ' left' : ''}</span></div>
      <div class="row"><button class="btn ghost danger" data-act="discard">Discard</button><button class="btn primary" data-act="resume">Resume</button></div></div>` : '';

  const guestNote = sb && !user && has ? `<div class="notice"><div><b>Practising as a guest.</b> <span class="muted">Create a free account to save your progress and scores across devices.</span></div>
      <div class="row"><button class="btn" data-act="auth" data-tab="signin">Sign in</button><button class="btn primary" data-act="auth" data-tab="signup">Create account</button></div></div>` : '';

  $('#view').innerHTML = `<main class="home wrap">
    <div class="hero">
      <span class="eyebrow">Practice test${user ? ' · ' + esc(user.user_metadata?.name || user.email) : ''}</span>
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <h1>${esc(bank.title || 'Exam dump')}</h1>
        <button class="btn" data-act="upload">Upload a different dump</button>
      </div>
      <p class="muted">${bank.questions.length} questions · ${plural(secs.length, 'section')} · ${plural(nTopics, 'topic')} · passing score ${settings.passing} of 1000${unscored ? ` · ${unscored} without an answer key` : ''}</p>
    </div>
    ${resume}
    ${guestNote}
    ${progressPanel}
    <div class="hometabs tabs" role="tablist">
      <button role="tab" aria-selected="${homeTab === 'exams'}" data-act="home-tab" data-tab="exams">Practice exams <span class="tabcount">${examsWithQs.length}</span></button>
      <button role="tab" aria-selected="${homeTab === 'topics'}" data-act="home-tab" data-tab="topics">Practice by topic <span class="tabcount">${nTopics}</span></button>
    </div>
    ${homeTab === 'exams' ? `<section>
      <div class="sec-head"><p class="muted">Timed, Microsoft-style exams of ${settings.examSize} questions each, in the order of your dump.</p></div>
      <div class="exam-grid">${examCards}</div>
    </section>
    ${history.length ? `<section><div class="sec-head"><h2>Recent attempts</h2></div>
      <div class="scroll-x"><table><thead><tr><th>Date</th><th>Set</th><th>Mode</th><th>Correct</th><th>Score</th><th>Result</th></tr></thead><tbody>${hist}</tbody></table></div></section>` : ''}`
    : `<section class="topics">
      <div class="row" style="justify-content:space-between">
        <p class="muted" style="max-width:60ch">Practise one topic at a time. Each answer is checked straight away with the explanation, and your score per topic is kept.${bank.autoTopics ? ' Your dump doesn\'t name its topics, so questions were grouped by subject automatically.' : ''}</p>
        <div class="row">
          ${mistakes ? `<button class="btn" data-act="start-mistakes">Retry my mistakes (${mistakes})</button>` : ''}
          ${untried && untried < bank.questions.length ? `<button class="btn" data-act="start-untried">Unanswered only (${untried})</button>` : ''}
          <button class="btn" data-act="start-all">Practise all ${bank.questions.length}</button>
        </div>
      </div>
      ${topicBlocks}
    </section>`}
  </main>`;
}

async function switchBank() {
  if (session && session.bankRev !== bank.rev) { session = null; store.del('mec.session'); }
  await Data.load();
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
  'start-mistakes': () => setup('My mistakes', 'mistakes', bank.questions.filter(q => progress[q.num] && progress[q.num].g < 1), 'practice'),
  'start-untried': () => setup('Unanswered questions', 'untried', bank.questions.filter(q => !progress[q.num] && q.answer.length), 'practice'),
  'home-tab': b => { homeTab = b.dataset.tab; store.set('mec.tab', homeTab); renderHome(); },
  'upload': () => $('#file').click(),
  'load-paste': () => { const t = $('#dumpText').value; if (!t.trim()) return uploadFailed('Paste the text of your exam dump first.'); uploadBusy('Reading the pasted text…'); loadText(t, 'pasted text'); },
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
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const f = ACT[b.dataset.act]; if (f) f(b, e); });
$('#file').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';   // lets the same file be picked again
  if (f) readDumpFile(f);
});
// Drag a file anywhere onto the home page to load it.
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', e => { if (view !== 'home' || !hasFiles(e)) return; e.preventDefault(); $('#dropzone')?.classList.add('over'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) $('#dropzone')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  if (view !== 'home' || !hasFiles(e)) return;
  e.preventDefault(); $('#dropzone')?.classList.remove('over');
  const f = e.dataTransfer.files[0]; if (f) readDumpFile(f);
});
document.addEventListener('change', e => { if (e.target.name === 'opt' && view === 'exam') onOptChange(); });
document.addEventListener('submit', e => { if (e.target.id === 'authForm') { e.preventDefault(); submitAuth(e.target); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modalRoot').innerHTML) { closeModal(); return; }
  if (e.target.id === 'dropzone' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('#file').click(); return; }
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
