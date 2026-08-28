const fs = require('fs');
const path = require('path');

const DIR = '/home/claude/pelection/data/events';
const FILES = ['economy', 'energy', 'crossStrait', 'disaster', 'society', 'scandal', 'party', 'personal'];

const STRATA = ['farmer','service','bluecollar','whitecollar','techpro','smallbiz','capitalist','publicsvc','student','retiree','_all'];
const INDUSTRIES = ['semiconductor','electronics','petrochemical','steel','machinery','food','finance','retail','tourism','logistics','_all'];
const AXES = ['centralization','unification','marketFreedom','progressivism','immigration','environment','militaryAutonomy','directDemocracy'];
const PLAYER = ['fame','favorNational','integrity','partyPrestige','politicalCapital','funds','personalAssets','stigma','fatigue'];
const ISSUES = ['economy','prices','housing','employment','security','energy','environment','crossStrait','defense','corruption','healthcare','education'];
const TAGS = ['TAG_GREEDY','TAG_PROUS','TAG_PROCN','TAG_NATIVIST','TAG_CLEAN','TAG_DOER','TAG_EMPTY','TAG_SCHOLAR','TAG_MUCKRAKER','TAG_LABOR_FRIEND','TAG_BIZ_DARLING','TAG_FIREBRAND'];
const EFFECT_KEYS = ['central','region','popSoL','popMood','corpMood','valuePressure','player','issueHeat','grassroots','tagGain','world'];
const ROLES = ['legislator','mayor','councilor','citizen'];

const errors = [];
const shortSentences = [];
const lengthWarnings = [];
const ids = new Set();
let total = 0;
const perFile = {};

// count "characters" ignoring punctuation and whitespace
const PUNCT = /[，、。！？；：「」『』（）()《》〈〉…—－\-·,.!?;:"'\s]/g;
function charLen(s) { return s.replace(PUNCT, '').length; }

function splitSentences(s) {
  // split on 。！？；  keeping non-empty trimmed parts
  return s.split(/[。！？；]/).map(x => x.trim()).filter(x => charLen(x) > 0);
}

function checkText(where, s, kind) {
  const parts = splitSentences(s);
  for (const p of parts) {
    const n = charLen(p);
    if (n < 7) shortSentences.push(`${where} [${kind}] (${n}字) → 「${p}」`);
  }
  if (kind === 'headline') {
    const n = charLen(s);
    if (n < 14 || n > 26) lengthWarnings.push(`${where} headline 長度 ${n} 字（需 14-26）: ${s}`);
    if (parts.length !== 1) lengthWarnings.push(`${where} headline 不該分成多句`);
  }
  if (kind === 'body') {
    if (parts.length < 2 || parts.length > 3) lengthWarnings.push(`${where} body 句數 ${parts.length}（需 2-3 句）`);
    for (const p of parts) {
      const n = charLen(p);
      if (n < 20) lengthWarnings.push(`${where} body 句長 ${n} 字 < 20: 「${p}」`);
    }
  }
  if (kind === 'hint') {
    const n = charLen(s);
    if (n < 12) lengthWarnings.push(`${where} hint 長度 ${n} 字 < 12: ${s}`);
  }
  if (kind === 'text') {
    const n = charLen(s);
    if (n < 8 || n > 20) lengthWarnings.push(`${where} option text 長度 ${n} 字（需 8-20）: ${s}`);
  }
}

function checkEffects(where, eff) {
  if (!eff || typeof eff !== 'object' || Array.isArray(eff)) { errors.push(`${where} effects 不是物件`); return; }
  const keys = Object.keys(eff);
  if (keys.length === 0) { errors.push(`${where} effects 為空`); return; }
  for (const k of keys) {
    if (!EFFECT_KEYS.includes(k)) { errors.push(`${where} 不允許的 effects 鍵: ${k}`); continue; }
    const v = eff[k];
    if (k === 'tagGain') {
      if (!Array.isArray(v) || v.length === 0) { errors.push(`${where} tagGain 需為非空陣列`); continue; }
      for (const t of v) if (!TAGS.includes(t)) errors.push(`${where} 未知標籤: ${t}`);
      continue;
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { errors.push(`${where} ${k} 需為物件`); continue; }
    if (Object.keys(v).length === 0) errors.push(`${where} ${k} 為空物件`);
    for (const sub of Object.keys(v)) {
      const val = v[sub];
      if (k === 'popSoL' || k === 'popMood') {
        if (!STRATA.includes(sub)) errors.push(`${where} ${k} 未知階層: ${sub}`);
        if (typeof val !== 'number') errors.push(`${where} ${k}.${sub} 需為數字`);
      } else if (k === 'corpMood') {
        if (!INDUSTRIES.includes(sub)) errors.push(`${where} corpMood 未知產業: ${sub}`);
        if (typeof val !== 'number') errors.push(`${where} corpMood.${sub} 需為數字`);
      } else if (k === 'valuePressure') {
        if (!AXES.includes(sub)) errors.push(`${where} valuePressure 未知軸: ${sub}`);
        if (typeof val !== 'number' || val < -2 || val > 2) errors.push(`${where} valuePressure.${sub} 超出 -2~2`);
      } else if (k === 'player') {
        if (!PLAYER.includes(sub)) errors.push(`${where} player 未知欄位: ${sub}`);
        if (typeof val !== 'number') errors.push(`${where} player.${sub} 需為數字`);
        if (sub === 'stigma' && val < 0) errors.push(`${where} player.stigma 只能為正`);
      } else if (k === 'issueHeat') {
        if (!ISSUES.includes(sub)) errors.push(`${where} issueHeat 未知議題: ${sub}`);
        if (typeof val !== 'number') errors.push(`${where} issueHeat.${sub} 需為數字`);
      } else if (k === 'grassroots') {
        if (typeof val !== 'number' || val < -5 || val > 5) errors.push(`${where} grassroots.${sub} 超出 -5~5`);
      } else if (k === 'central') {
        if (typeof val !== 'number') errors.push(`${where} central.${sub} 需為數字`);
        if (!/^[a-zA-Z]+\.[a-zA-Z]+$/.test(sub)) errors.push(`${where} central 路徑格式怪異: ${sub}`);
      } else if (k === 'region') {
        if (typeof val !== 'object' || val === null) errors.push(`${where} region.${sub} 需為物件`);
        else for (const rk of Object.keys(val)) if (typeof val[rk] !== 'number') errors.push(`${where} region.${sub}.${rk} 需為數字`);
      } else if (k === 'world') {
        if (typeof val !== 'object' || val === null) errors.push(`${where} world.${sub} 需為物件`);
      }
    }
  }
}

const TRIGGER_ROOTS = ['central','world','region','player','party','turn','year','month','values','issueHeat'];
function checkTrigger(where, t) {
  if (typeof t !== 'string' || t.trim() === '') { errors.push(`${where} trigger 需為非空字串`); return; }
  // strip allowed constructs, then look for anything illegal left over
  let rest = t
    .replace(/&&|\|\|/g, ' ')
    .replace(/[<>]=?|==|!=/g, ' ')
    .replace(/\bin\b/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/-?\d+(\.\d+)?/g, ' ')
    .replace(/'[^']*'|"[^"]*"/g, ' ')
    .replace(/[A-Za-z_][A-Za-z0-9_.]*/g, ' ');
  if (rest.trim() !== '') errors.push(`${where} trigger 含不允許的字元 「${rest.trim()}」: ${t}`);
  // token roots
  const idents = t.replace(/'[^']*'|"[^"]*"/g, ' ').match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [];
  for (const id of idents) {
    if (id === 'in') continue;
    const root = id.split('.')[0];
    if (!TRIGGER_ROOTS.includes(root)) errors.push(`${where} trigger 未知根物件: ${root} (${t})`);
  }
}

for (const f of FILES) {
  const p = path.join(DIR, f + '.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { errors.push(`${f}.json 無法解析: ${e.message}`); continue; }
  if (!data.events || !Array.isArray(data.events)) { errors.push(`${f}.json 缺少 events 陣列`); continue; }
  perFile[f] = data.events.length;
  total += data.events.length;
  if (data.events.length !== 12) errors.push(`${f}.json 事件數 ${data.events.length}，應為 12`);
  data.events.forEach((ev, i) => {
    const where = `${f}#${i}:${ev.id || '(無id)'}`;
    if (!ev.id || !ev.id.startsWith('EVT_')) errors.push(`${where} id 需以 EVT_ 開頭`);
    if (ids.has(ev.id)) errors.push(`${where} id 重複`);
    ids.add(ev.id);
    if (ev.category !== f) errors.push(`${where} category 應為 ${f}，實為 ${ev.category}`);
    if (typeof ev.weight !== 'number') errors.push(`${where} weight 需為數字`);
    if (typeof ev.cooldown !== 'number') errors.push(`${where} cooldown 需為數字`);
    checkTrigger(where, ev.trigger);
    if (!ev.requires || typeof ev.requires.minTurn !== 'number' || !Array.isArray(ev.requires.roles) || ev.requires.roles.length === 0) {
      errors.push(`${where} requires 格式錯誤`);
    } else {
      for (const r of ev.requires.roles) if (!ROLES.includes(r)) errors.push(`${where} 未知角色: ${r}`);
    }
    checkText(where, ev.headline || '', 'headline');
    checkText(where, ev.body || '', 'body');
    if (!Array.isArray(ev.options) || ev.options.length < 3) errors.push(`${where} 選項少於 3 個`);
    (ev.options || []).forEach((o, j) => {
      const ow = `${where}/opt${j}`;
      checkText(ow, o.text || '', 'text');
      checkText(ow, o.hint || '', 'hint');
      checkEffects(ow, o.effects);
    });
    if (!ev._designNote || charLen(ev._designNote) < 8) errors.push(`${where} 缺少 _designNote`);
  });
}

console.log('=== 檔案數量 ===');
for (const f of FILES) console.log(`  ${f}.json: ${perFile[f] === undefined ? '缺檔' : perFile[f] + ' 則'}`);
console.log(`  總計: ${total} 則\n`);
console.log(`=== 句長 < 7 字違規: ${shortSentences.length} 個 ===`);
shortSentences.forEach(s => console.log('  ' + s));
console.log(`\n=== 長度規範警告: ${lengthWarnings.length} 個 ===`);
lengthWarnings.forEach(s => console.log('  ' + s));
console.log(`\n=== 結構/鍵值錯誤: ${errors.length} 個 ===`);
errors.forEach(s => console.log('  ' + s));
