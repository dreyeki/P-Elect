// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, tile, row, wordTile } from '../components.js';
import { taiwanMap, barRows } from '../charts.js';
import * as F from '../../util/format.js';
import { word, biWord, toneOf } from '../../util/scale.js';
import { partyColor } from '../app.js';

export function mapPage(s, data, arg) {
  if (arg?.region) return regionDetail(s, data, arg.region);
  if (arg?.district) return districtDetail(s, data, arg.district);
  const mode = arg?.mode ?? 'favor';
  const modes = [['favor', '好感'], ['grass', '基層組織'], ['party', '執政黨'], ['sol', '生活水準']];
  const nav = `<div class="tabrow">${modes.map(([id, n]) =>
    `<button class="btn ${mode === id ? 'primary' : 'ghost'}" data-act="map-mode" data-id="${id}">${n}</button>`).join('')}</div>`;

  const solByRegion = regionSol(s, data);
  const grassByRegion = regionGrass(s, data);

  const map = taiwanMap((id) => {
    const r = s.regions[id];
    let color = 'var(--bg-3)', label = '', v = 0;
    if (mode === 'favor') { v = r.playerFavor; color = tone(v, -5, 5); label = biWord('favor', v); }
    else if (mode === 'grass') { v = grassByRegion[id]; color = tone(v, 0, 5); label = word('grassroots', v); }
    else if (mode === 'party') { color = partyColor(r.politics.mayorParty); label = s.parties[r.politics.mayorParty]?.shortName ?? '無黨籍'; }
    else { v = solByRegion[id]; color = tone(v, 0, 5); label = word('sol', v); }
    return `<button class="mapcell" data-act="open-region" data-id="${id}"
      style="border-color:${color};background:linear-gradient(180deg,var(--bg-3),${color}22)">
      <b>${esc(SHORT[id] ?? r.name)}</b><span class="cw">${esc(label)}</span></button>`;
  });

  const home = data.byId.district[s.player.homeDistrict];
  return nav + card('全臺', map) + card('你的選區', `
    <div class="row"><span class="row-k">家鄉</span><span class="row-v">${esc(home?.name ?? '未設定')}</span></div>
    <div class="row"><span class="row-k">基層組織</span><span class="row-v word">${esc(word('grassroots', s.districts[s.player.homeDistrict]?.playerGrassroots ?? 0))}</span></div>
    <button class="btn full" data-act="open-district" data-id="${esc(s.player.homeDistrict)}" style="margin-top:10px">看選區細節</button>
  `) + card('經營中的選區', topDistricts(s, data));
}

function voterStructureBlock(r) {
  const v = r.voterStructure;
  if (!v) return '<div class="xs muted">沒有這個縣市的選民結構資料。</div>';
  const bar = (label, val, color) => `
    <div class="votebar"><span class="vn">${esc(label)}</span>
      <span class="vb"><i style="width:${(val * 1.4).toFixed(1)}%;background:${color}"></i></span>
      <span class="vp">${val.toFixed(2)}%</span></div>`;
  return bar('泛綠', v.green, 'var(--pda)') + bar('泛藍', v.blue, 'var(--crp)') + bar('民眾黨', v.white, 'var(--tpl)')
    + `<div class="xs muted" style="margin-top:8px;line-height:1.7">${esc(v._source ?? '')}。
      這是這個縣市長期的基本盤結構，選戰打得再好也不容易撼動它的骨架。</div>`;
}

/** 選區的政治光譜：直接看這裡的人現在支持誰，而不是看模型參數 */
function districtColorBlock(s, data, did) {
  const P = s.pops;
  const di = data.districts.districts.findIndex((x) => x.id === did);
  const nP = data.partyIds.length;
  const GREEN = ['PDA', 'NGF', 'TWR', 'GSP'], BLUE = ['CRP', 'CUA'];
  let g = 0, b = 0, w = 0, tot = 0;
  for (let i = 0; i < P.n; i++) {
    if (P.district[i] !== di) continue;
    const sz = P.size[i];
    for (let p = 0; p < nP; p++) {
      const id = data.partyIds[p], v = P.support[i * nP + p] * sz;
      if (GREEN.includes(id)) g += v; else if (BLUE.includes(id)) b += v; else if (id === 'TPL') w += v;
    }
    tot += sz;
  }
  if (!tot) return '<span class="xs muted">還沒有資料</span>';
  const gp = g / tot * 100, bp = b / tot * 100, wp = w / tot * 100;
  const diff = bp - gp;
  const wordOf = Math.abs(diff) < 3 ? '勢均力敵' : diff > 12 ? '藍營優勢' : diff > 3 ? '偏向藍營'
    : diff < -12 ? '綠營優勢' : '偏向綠營';
  return `<span class="word">${esc(wordOf)}</span>
    <div class="xs muted" style="margin-top:3px">綠 ${gp.toFixed(0)}%・藍 ${bp.toFixed(0)}%・白 ${wp.toFixed(0)}%</div>`;
}

const SHORT = {
  TPE: '臺北', NTP: '新北', TYC: '桃園', TCH: '臺中', TNN: '臺南', KHH: '高雄',
  KEE: '基隆', HSC: '竹市', CYI: '嘉市', HSQ: '竹縣', MIA: '苗栗', CHA: '彰化',
  NAN: '南投', YUN: '雲林', CYQ: '嘉縣', PIF: '屏東', ILA: '宜蘭', HUA: '花蓮',
  TTT: '臺東', PEN: '澎湖', KIN: '金門', LIE: '連江',
};

const tone = (v, lo, hi) => {
  const t = (v - lo) / (hi - lo);
  return t >= 0.75 ? 'var(--good)' : t >= 0.55 ? 'var(--ok)' : t >= 0.4 ? 'var(--mid)' : t >= 0.22 ? 'var(--warn)' : 'var(--bad)';
};

function topDistricts(s, data) {
  const list = Object.values(s.districts)
    .filter((d) => d.playerGrassroots > 0.3 || d.serviceOffice)
    .sort((a, b) => b.playerGrassroots - a.playerGrassroots).slice(0, 12);
  if (!list.length) return '<div class="xs muted">你還沒有真正經營過任何一個選區。跑攤是唯一的辦法，沒有捷徑。</div>';
  return list.map((d) => {
    const dd = data.byId.district[d.id];
    return `<button class="lawrow" data-act="open-district" data-id="${esc(d.id)}" style="width:100%;text-align:left">
      <span class="ln"><span class="lt">${esc(dd.name)}</span>
      <span class="lc">${esc(word('grassroots', d.playerGrassroots))}・好感 ${esc(biWord('favor', d.playerFavor))}</span></span>
      ${d.serviceOffice ? '<span class="chip">服務處</span>' : ''}
    </button>`;
  }).join('');
}

function regionSol(s, data) {
  const P = s.pops, out = {}, w = {};
  for (let i = 0; i < P.n; i++) {
    const rid = data.districts.districts[P.district[i]].regionId;
    out[rid] = (out[rid] ?? 0) + P.sol[i] * P.size[i];
    w[rid] = (w[rid] ?? 0) + P.size[i];
  }
  for (const k in out) out[k] /= w[k];
  return out;
}
function regionGrass(s, data) {
  const out = {}, n = {};
  for (const d of Object.values(s.districts)) {
    out[d.regionId] = (out[d.regionId] ?? 0) + d.playerGrassroots;
    n[d.regionId] = (n[d.regionId] ?? 0) + 1;
  }
  for (const k in out) out[k] /= n[k];
  return out;
}

function regionDetail(s, data, rid) {
  const r = s.regions[rid];
  const ds = Object.values(s.districts).filter((d) => d.regionId === rid);
  const corps = Object.values(s.corporations).filter((c) => (c.employees[rid] ?? 0) > 0)
    .sort((a, b) => b.employees[rid] - a.employees[rid]).slice(0, 5);
  const sectors = Object.entries(r.economy.sectors).filter(([k]) => !['publicSector', 'other'].includes(k))
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  const SEC = { semiconductor: '半導體', electronics: '電子', petrochemical: '石化', steel: '鋼鐵', machinery: '機械', food: '食品', textile: '紡織', finance: '金融', retail: '零售', tourism: '觀光', logistics: '物流', agriculture: '農業', fishery: '漁業' };
  return html`
    <button class="btn ghost" data-act="map-back" style="margin-bottom:10px">← 回到地圖</button>
    ${card(r.name, `<div class="grid2">
      ${tile('人口', `<span class="num">${F.int(r.population.total)}</span>`)}
      ${tile('生產毛額', `<span class="num">${F.bil(r.economy.gdp)}</span>`)}
      ${tile('失業率', `<span class="num">${(r.economy.unemployment * 100).toFixed(2)}%</span>`)}
      ${tile('房價指數', `<span class="num">${r.economy.housingPriceIndex.toFixed(0)}</span>`, '全國均值 100')}
      ${tile('平均所得', `<span class="num">${F.int(r.economy.perCapitaIncome)}</span>`, '元／年')}
      ${tile('首長政黨', `<span style="color:${partyColor(r.politics.mayorParty)}">${esc(s.parties[r.politics.mayorParty]?.shortName ?? '無黨籍')}</span>`, `施政滿意 ${r.mayorApproval.toFixed(0)}%`)}
    </div>`)}
    ${card('選民結構', voterStructureBlock(r))}
    ${card('建設', `<div class="grid2">
      ${wordTile('交通', 'infrastructure', r.infrastructure.transport)}
      ${wordTile('能源', 'infrastructure', r.infrastructure.energy)}
      ${wordTile('水利', 'infrastructure', r.infrastructure.water)}
      ${wordTile('數位', 'infrastructure', r.infrastructure.digital)}
      ${wordTile('住宅', 'infrastructure', r.infrastructure.housing)}
      ${wordTile('醫療', 'infrastructure', r.infrastructure.medical)}
      ${wordTile('教育', 'infrastructure', r.infrastructure.education)}
      ${wordTile('防災', 'infrastructure', r.infrastructure.disasterResilience)}
    </div>`)}
    ${card('產業結構', barRows(sectors.map(([k, v]) => ({ label: SEC[k] ?? k, value: v * 100, text: (v * 100).toFixed(1) + '%' })), { min: 30 }))}
    ${card('主要企業', corps.map((c) => `
      <div class="row"><span class="row-k">${esc(c.name)}</span>
      <span class="row-v"><span class="xs muted">${F.int(c.employees[rid])} 人</span>　
      <span class="word">${esc(biWord('corpMood', c.mood))}</span></span></div>`).join(''))}
    ${card('財政', `
      ${row('自有財源', `<span class="num">${F.yi(r.finance.ownRevenue)}</span>`)}
      ${row('統籌分配款', `<span class="num">${F.yi(r.finance.allocationFund)}</span>`)}
      ${row('人事費', `<span class="num">${F.yi(r.finance.personnelCost)}</span>`)}
      ${row('累積負債', `<span class="num ${r.finance.debt > r.finance.debtCeiling ? 'tone-bad' : ''}">${F.yi(r.finance.debt)}</span>`, '')}
      ${row('剛性支出比', `<span class="num ${(r.fiscalStress ?? 0) > 0.85 ? 'tone-bad' : ''}">${((r.fiscalStress ?? 0) * 100).toFixed(0)}%</span>`)}`)}
    ${card('地方議案', data.localBills.bills.map((b) => {
      const t = s.localBills[rid][b.id];
      return `<button class="lawrow" data-act="open-bill" data-region="${esc(rid)}" data-id="${esc(b.id)}" style="width:100%;text-align:left">
        <span class="ln"><span class="lt">${esc(b.name)}</span><span class="lc">${esc(b.tiers[t].name)}</span></span></button>`;
    }).join(''))}
    ${card('選區', ds.map((d) => {
      const dd = data.byId.district[d.id];
      return `<button class="lawrow" data-act="open-district" data-id="${esc(d.id)}" style="width:100%;text-align:left">
        <span class="ln"><span class="lt">${esc(dd.name)}</span>
        <span class="lc">${esc(dd.areas.join('、'))}｜應選 ${dd.seats} 席</span></span>
        <span class="chip">${esc(word('grassroots', d.playerGrassroots))}</span></button>`;
    }).join(''))}`;
}

function districtDetail(s, data, did) {
  const d = s.districts[did];
  const dd = data.byId.district[did];
  const P = s.pops;
  const di = data.districts.districts.findIndex((x) => x.id === did);
  const groups = [];
  for (let i = 0; i < P.n; i++) {
    if (P.district[i] !== di) continue;
    groups.push({
      i, size: P.size[i], sol: P.sol[i], enth: P.enthusiasm[i], mil: P.militancy[i],
      stratum: data.strataIds[P.stratum[i]], gen: data.genIds[P.gen[i]],
    });
  }
  groups.sort((a, b) => b.size - a.size);
  const GEN = { youth: '青年', middle: '中壯', senior: '樂齡' };
  const top = groups.slice(0, 6);
  return html`
    <button class="btn ghost" data-act="map-back" style="margin-bottom:10px">← 回到地圖</button>
    ${card(dd.name, `
      ${row('涵蓋', esc(dd.areas.join('、')))}
      ${row('人口', `<span class="num">${F.int(dd.population)}</span>`)}
      ${row('應選席次', `<span class="num">${dd.seats}</span>`)}
      ${row('政治光譜', districtColorBlock(s, data, did))}
      ${row('你的基層組織', `<span class="word">${esc(word('grassroots', d.playerGrassroots))}</span>`)}
      ${row('你的好感度', `<span class="word">${esc(biWord('favor', d.playerFavor))}</span>`)}
      <div class="btn-row">
        <button class="btn ${d.serviceOffice ? 'danger' : 'primary'}" data-act="toggle-office" data-id="${esc(did)}">
          ${d.serviceOffice ? '撤掉服務處' : '在這裡設服務處'}</button>
        <button class="btn" data-act="canvass-here" data-id="${esc(did)}">來這裡跑攤（1 AP）</button>
      </div>`)}
    ${card('各黨基層組織', Object.entries(d.grassroots).filter(([, v]) => v > 0.2)
      .sort((a, b) => b[1] - a[1]).map(([pid, v]) => `
      <div class="row"><span class="row-k" style="color:${partyColor(pid)}">${esc(s.parties[pid]?.shortName ?? pid)}</span>
      <span class="row-v word">${esc(word('grassroots', v))}</span></div>`).join(''))}
    ${card('這裡的人', top.map((g) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k"><b>${esc(data.byId.stratum[g.stratum].name)}・${esc(GEN[g.gen])}</b>
            <span class="xs muted">${F.int(g.size)} 人</span></span>
          <span class="row-v word ${raw(toneOf(g.sol))}">${esc(word('sol', g.sol))}</span>
        </div>
        <div class="xs muted" style="margin-top:3px">
          投票意願 ${esc(word('enthusiasm', g.enth))}${g.mil >= 2.5 ? `・情緒 ${esc(word('militancy', g.mil))}` : ''}
        </div>
      </div>`).join(''))}`;
}
