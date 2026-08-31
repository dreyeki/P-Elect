// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, tile, wordTile, axisBar, row } from '../components.js';
import { lineChart, radar, barRows } from '../charts.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { bracketOf, isConsensus } from '../../systems/ValueSystem.js';
import * as Semi from '../../systems/SemiconductorSystem.js';
import { chinaMood } from '../../systems/PopSystem.js';
import * as Lab from '../../systems/PopLabSystem.js';
import { app } from '../app.js';

export function dataPage(s, data, tab = 'macro') {
  const t = tab ?? 'macro';
  const tabs = [['macro', '總體'], ['semi', '半導體'], ['pops', '民生'],
    ['values', '價值觀'], ['world', '世界'], ['history', '走勢'], ['lab', '人群試作']];
  const nav = `<div class="tabrow">${tabs.map(([id, n]) =>
    `<button class="btn ${t === id ? 'primary' : 'ghost'}" data-act="data-tab" data-id="${id}">${n}</button>`).join('')}</div>`;
  return nav + ({ macro, semi, pops, values, world, history, lab }[t] ?? macro)(s, data, t);
}

/**
 * 半導體。
 *
 * 這個產業佔出口超過四成、佔加權指數超過四成，把它壓成一個小數是嚴重的失真。
 * 所以它有自己的一頁：五個版圖各自的技術、市佔、獲利率、研發強度與兩邊的曝險。
 * 技術與市佔的移動速度以年為單位，不會因為誰喊了一句口號就改變。
 */
function semi(s, data) {
  if (!s.semi) return card('半導體', '<div class="xs muted">產業資料還沒建立。</div>');
  const segs = Semi.snapshot(s, data);
  const T = s.flags.semiTotals ?? {};
  const risks = Semi.activeRisks(s, data);

  const rows = segs.map((g) => `
    <div class="semirow">
      <span class="sm-n">${esc(g.name)}</span>
      <span class="sm-v">全球市佔 ${(g.globalShare * 100).toFixed(1)}%</span>
      <span class="sm-v">${esc(word('semiTech', g.techLevel))}</span>
      <span class="sm-v ${g.cycle > 0.05 ? 'tone-good' : g.cycle < -0.05 ? 'tone-bad' : ''}">${g.cycle >= 0 ? '+' : ''}${(g.cycle * 100).toFixed(0)}%</span>
      <span class="sm-d">${esc(g.corps.join('、'))}｜毛利 ${(g.margin * 100).toFixed(0)}%
        ・研發強度 ${(g.rndIntensity * 100).toFixed(1)}%
        ・雇用 ${F.int(g.employment)} 人
        ・對中曝險 ${(g.chinaExposure * 100).toFixed(0)}%
        ・對美曝險 ${(g.usExposure * 100).toFixed(0)}%</span>
      <span class="sm-d">${esc(g.desc)}</span>
    </div>`).join('');

  const riskBlock = risks.length
    ? risks.map((r) => `<div class="row" style="display:block">
        <span class="row-k tone-warn">${esc(r.name)}</span>
        <div class="xs muted" style="line-height:1.7;margin-top:3px">${esc(r.desc)}</div>
      </div>`).join('')
    : '<div class="xs muted" style="line-height:1.7">目前沒有任何一項風險指標亮起來。這種狀態在這個產業裡不會維持太久。</div>';

  return html`
    ${card('產業總覽', `<div class="grid3">
      ${tile('佔國內生產毛額', `<span class="num">${(T.gdpShare * 100).toFixed(1)}%</span>`, '', 'sm')}
      ${tile('整體技術水準', `<span class="word">${esc(word('semiTech', T.avgTech ?? 0))}</span>`, '', 'sm')}
      ${tile('景氣循環', `<span class="num ${T.cycle > 0.05 ? 'tone-good' : T.cycle < -0.05 ? 'tone-bad' : ''}">${(T.cycle ?? 0) >= 0 ? '+' : ''}${((T.cycle ?? 0) * 100).toFixed(0)}%</span>`, '', 'sm')}
      ${tile('全產業產值', `<span class="num">${F.bil(T.revenue ?? 0)}</span>`, '', 'sm')}
      ${tile('稅前獲利', `<span class="num">${F.bil(T.profit ?? 0)}</span>`, '', 'sm')}
      ${tile('研發投入', `<span class="num">${F.bil(T.rnd ?? 0)}</span>`, '', 'sm')}
    </div>
    <div class="xs muted" style="margin-top:8px;line-height:1.7">
      全產業雇用 ${F.int(T.employment ?? 0)} 人。這個數字看起來不算大，
      但它撐起來的稅收、上下游與周邊房價，遠遠不只這些人的份。
    </div>`)}

    ${card('五大版圖', rows)}

    ${card('結構性風險', riskBlock)}

    ${card('這一頁在講什麼', `<div class="small muted" style="line-height:1.9">
      技術水準決定你在別人的供應鏈裡有沒有辦法被替換掉，市佔只是那件事的結果。
      對中曝險高的版圖在兩岸緊張時最先受傷，對美曝險高的版圖則會被出口管制直接改寫。
      研發強度是唯一一個你今天投下去、五年後才看得到的數字，
      而政治人物的任期通常比五年短。
    </div>`)}`;
}

/**
 * 人群試作（POP Lab）。
 *
 * 這一頁是一個**獨立的沙盒**，跟遊戲裡真正在跑的 5,850 個 POP 沒有連結。
 * 它要回答的問題只有一個：一個人為什麼支持你？
 *
 * 遊戲裡的支持度是一條公式算出來的浮點數，你只看得到結果。
 * 這一頁把每一項都攤開來——基礎不情願 −20、政黨認同 +42、媒體宣傳 +30……
 * 確認這套拆解合理之後，再考慮要不要接回主系統。
 */
function lab(s, data) {
  const ui = app.labState ??= { seed: 'LAB', open: null };
  const me = Lab.playerProfileFrom(s, data);
  const res = Lab.sample(s, data, ui.seed, me);
  const sum = Lab.summarize(res, data);
  const q = sum.quad;

  const bandRow = (bands, total) => bands.map((b) => `
    <div class="row"><span class="row-k ${b.tone === 'bad' ? 'tone-bad' : b.tone === 'warn' ? 'tone-warn' : b.tone === 'ok' ? 'tone-ok' : 'muted'}">${esc(b.name)}</span>
      <span class="row-v"><span class="num">${b.n}</span>
      <span class="xs muted">　${((b.n / total) * 100).toFixed(0)}%</span></span></div>`).join('');

  const personRows = res.people.map((p, i) => {
    const open = ui.open === i;
    const sTone = p.support >= 20 ? 'tone-ok' : p.support <= -20 ? 'tone-bad' : 'muted';
    const terms = (rows) => rows.map((t) => `
      <div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0">
        <span class="xs">${esc(t.name)}${t.detail ? `<span class="muted">　${esc(t.detail)}</span>` : ''}</span>
        <span class="xs num ${t.value > 0 ? 'tone-ok' : t.value < 0 ? 'tone-bad' : 'muted'}">${t.value > 0 ? '+' : ''}${t.value}</span>
      </div>`).join('');
    return `<button class="lawrow" data-act="lab-open" data-id="${i}" style="width:100%;text-align:left;display:block">
      <span class="ln" style="display:flex;justify-content:space-between;gap:8px">
        <span class="lt">${esc(p.stratumName)}・${esc(p.genName)}・${p.female ? '女' : '男'}
          ${p.party ? `<span class="xs" style="color:${partyColorOf(data, p.party)}">${esc(data.byId.party[p.party]?.shortName ?? '')}</span>` : '<span class="xs muted">無黨派</span>'}</span>
        <span class="lc"><span class="num ${sTone}">${p.support > 0 ? '+' : ''}${p.support}</span>
          <span class="xs muted">　激進 ${p.militancy}</span></span>
      </span>
      ${open ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <div class="xs muted" style="margin-bottom:4px">支持度 ${p.support > 0 ? '+' : ''}${p.support}（${esc(p.supportBand.name)}）</div>
        ${terms(p.supportTerms)}
        <div class="xs muted" style="margin:8px 0 4px">激進度 ${p.militancy}（${esc(p.militancyBand.name)}）</div>
        ${terms(p.militancyTerms)}
      </div>` : ''}
    </button>`;
  }).join('');

  return html`
    ${card('這一頁在做什麼', `<div class="small muted" style="line-height:1.9">
      這是一個獨立的沙盒，<b>跟遊戲裡真正在跑的 5,850 個 POP 沒有連結</b>，
      改這裡的數字不會影響你的選情。<br><br>
      它要回答的問題只有一個：一個人為什麼支持你？遊戲裡的支持度是一條公式算出來的浮點數，
      你只看得到結果。這一頁把每一項都攤開——基礎不情願 −20、政黨認同 +42、媒體宣傳 +30——
      點任何一個人就展開他的完整拆解。<br><br>
      兩個值刻意分開：<b>支持度</b>（−100～+100）是他站哪一邊，
      <b>激進度</b>（0～100）是他願意為了這件事做到什麼程度。
      一個人可以「很支持但很消極」，也可以「不太支持但很激進」——
      這兩格才是把兩個值分開的理由。
    </div>`)}

    ${card('用來算的那個你', `<div class="grid2">
      ${tile('政黨', me.party ? esc(data.byId.party[me.party]?.shortName ?? '') : '無黨籍', '', 'sm')}
      ${tile('兩岸立場', (me.china > 0 ? '+' : '') + me.china.toFixed(1), me.china < 0 ? '偏抗中' : me.china > 0 ? '偏友中' : '中間', 'sm')}
      ${tile('知名度', me.fame.toFixed(1), '決定媒體宣傳那一項的上限', 'sm')}
      ${tile('汙名', me.stigma.toFixed(1), '只增不減的那一項', 'sm')}
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn ghost xs" data-act="lab-reroll">換一批人</button>
      <span class="xs muted" style="align-self:center">種子 ${esc(String(ui.seed))}</span>
    </div>`)}

    ${card(`${sum.n} 個人的樣貌`, `<div class="grid2">
      ${tile('平均支持度', `<span class="num ${sum.avgS > 0 ? 'tone-ok' : 'tone-bad'}">${sum.avgS > 0 ? '+' : ''}${sum.avgS.toFixed(1)}</span>`, '', 'sm')}
      ${tile('平均激進度', `<span class="num">${sum.avgM.toFixed(1)}</span>`, '', 'sm')}
    </div>
    <div class="sec-t" style="margin-top:10px">支持度分佈</div>
    ${bandRow(sum.supportBands, sum.n)}
    <div class="sec-t" style="margin-top:10px">激進度分佈</div>
    ${bandRow(sum.militancyBands, sum.n)}`)}

    ${card('把兩個值分開之後看得到的東西', `
      ${row('死忠（支持又願意動）', `<span class="num tone-ok">${q.loyal}</span>`)}
      ${row('支持但消極（會投票，不會幫你做別的）', `<span class="num">${q.passive}</span>`)}
      ${row('游離未定', `<span class="num">${q.swing}</span>`)}
      ${row('反對而且激進（會去你的場子鬧）', `<span class="num tone-bad">${q.hostile}</span>`)}
      ${row('反對但沉默', `<span class="num muted">${q.quiet}</span>`)}
      <div class="xs muted" style="margin-top:8px;line-height:1.75">
        「支持但消極」跟「反對但激進」這兩格，是把支持度跟激進度拆成兩個值的全部理由。
        只用一個數字的話，這兩種人會被算成同一種人，而他們在選戰裡做的事完全不一樣。
      </div>`)}

    ${card('點一個人看他的拆解', personRows)}`;
}

function partyColorOf(data, pid) {
  return data.byId.party[pid]?.color ?? 'var(--fg-2)';
}

function macro(s, data) {
  const c = s.central;
  return html`
    ${card('經濟', `<div class="grid2">
      ${tile('國內生產毛額', `<span class="num">${F.bil(c.fiscal.gdp)}</span>`)}
      ${tile('經濟成長率', `<span class="num ${c.fiscal.gdpGrowth > 0.02 ? 'tone-good' : c.fiscal.gdpGrowth < 0 ? 'tone-bad' : ''}">${(c.fiscal.gdpGrowth * 100).toFixed(2)}%</span>`)}
      ${tile('失業率', `<span class="num ${c.fiscal.unemployment > 0.05 ? 'tone-bad' : 'tone-ok'}">${(c.fiscal.unemployment * 100).toFixed(2)}%</span>`)}
      ${tile('通貨膨脹', `<span class="num ${c.fiscal.inflation > 0.03 ? 'tone-warn' : ''}">${(c.fiscal.inflation * 100).toFixed(2)}%</span>`)}
      ${tile('加權指數', `<span class="num">${F.int(c.stockIndex)}</span>`)}
      ${tile('匯率', `<span class="num">${c.monetary.exchangeRateUSD.toFixed(2)}</span>`, '新台幣兌美元')}
    </div>`)}
    ${card('能源', `
      ${row('備轉容量率', `<span class="num ${c.energy.reserveMargin < 0.07 ? 'tone-bad' : 'tone-ok'}">${(c.energy.reserveMargin * 100).toFixed(1)}%</span>`)}
      ${row('電價', `<span class="num">${c.energy.electricityPrice.toFixed(2)} 元／度</span>`)}
      ${row('再生能源佔比', `<span class="num">${(c.energy.mix.renewable * 100).toFixed(1)}%</span>`)}
      ${row('台灣電能公司累虧', `<span class="num">${F.yi(c.energy.tpecDeficit)}</span>`)}`)}
    ${card('國防與外交', `<div class="grid2">
      ${wordTile('戰備', 'readiness', c.defense.readiness)}
      ${wordTile('不對稱戰力', 'readiness', c.defense.asymmetricCapability)}
      ${wordTile('對美關係', 'relation', c.diplomacy.usRelation, true)}
      ${wordTile('兩岸關係', 'relation', c.diplomacy.prcRelation, true)}
      ${wordTile('對日關係', 'relation', c.diplomacy.japanRelation, true)}
      ${tile('國防預算佔比', `<span class="num">${(c.defense.budgetRatio * 100).toFixed(2)}%</span>`)}
    </div>`)}
    ${card('社會', `
      ${row('總生育率', `<span class="num">${c.society.birthRate.toFixed(2)}</span>`)}
      ${row('高齡人口比', `<span class="num">${(c.society.agingRatio * 100).toFixed(1)}%</span>`)}
      ${row('吉尼係數', `<span class="num">${c.society.giniIndex.toFixed(3)}</span>`)}
      ${row('房價所得比', `<span class="num">${c.society.housingAffordability.toFixed(1)}</span>`)}
      ${row('健保財務', `<span class="word">${esc(word('sol', c.society.healthcareSustainability))}</span>`)}
      ${row('年金永續', `<span class="word">${esc(word('sol', c.society.pensionSustainability))}</span>`)}
      ${row('社會信任', `<span class="word">${esc(word('sol', c.society.socialTrust))}</span>`)}`)}`;
}

const solColor = (v) => v >= 3.5 ? 'var(--good)' : v >= 2.5 ? 'var(--ok)' : v >= 1.5 ? 'var(--mid)' : 'var(--bad)';

/** 依任意分組計算生活水準與人口比例 */
function solBy(s, data, keyFn) {
  const P = s.pops, acc = {};
  let total = 0;
  for (let i = 0; i < P.n; i++) {
    const k = keyFn(i, P, data);
    if (k == null) continue;
    acc[k] ??= { sol: 0, w: 0 };
    acc[k].sol += P.sol[i] * P.size[i];
    acc[k].w += P.size[i];
    total += P.size[i];
  }
  for (const k in acc) { acc[k].value = acc[k].sol / acc[k].w; acc[k].share = acc[k].w / total; }
  return acc;
}

function solRows(acc, label) {
  return Object.entries(acc).sort((a, b) => b[1].value - a[1].value).map(([k, v]) => `
    <div class="solrow">
      <span class="sr-n">${esc(label(k))}</span>
      <span class="sr-b"><i style="width:${(v.value / 5 * 100).toFixed(1)}%;background:${solColor(v.value)}"></i></span>
      <span class="sr-w">${esc(word('sol', v.value))}</span>
      <span class="sr-p">${(v.share * 100).toFixed(1)}%</span>
    </div>`).join('');
}

function pops(s, data, tab) {
  const heat = data.issues.issues.map((i) => ({
    label: i.name, value: s.issues[i.id],
    text: word('issueHeat', s.issues[i.id]),
    color: s.issues[i.id] >= 4 ? 'var(--bad)' : s.issues[i.id] >= 3 ? 'var(--warn)' : 'var(--accent)',
  })).sort((a, b) => b.value - a.value);

  const byStratum = solBy(s, data, (i, P) => data.strataIds[P.stratum[i]]);
  const byGen = solBy(s, data, (i, P) => data.genIds[P.gen[i]]);
  const byRegion = solBy(s, data, (i, P) => data.districts.districts[P.district[i]].regionId);

  const GEN = { youth: '青年（18–34）', middle: '中壯（35–54）', senior: '樂齡（55 以上）' };
  return html`
    ${card('各階層生活水準', solRows(byStratum, (k) => data.byId.stratum[k].name)
      + `<div class="xs muted" style="margin-top:8px;line-height:1.7">
        右邊的百分比是這群人佔全國人口的比例。他們的日子過得怎麼樣，決定了投票日會不會出門。</div>`)}
    ${card('各世代生活水準', solRows(byGen, (k) => GEN[k] ?? k)
      + `<div class="xs muted" style="margin-top:8px;line-height:1.7">
        世代之間的落差是這座島最安靜也最深的裂痕。年輕人過得比長輩差的那一天，選舉的邏輯就會整個改變。</div>`)}
    ${card('各縣市生活水準', solRows(byRegion, (k) => data.byId.region[k].name))}
    ${card('議題熱度', barRows(heat, { min: 5 }))}`;
}

function values(s, data) {
  return chinaBlock(s, data) + genderBlock(s, data) + card('國家價值觀', data.values.axes.map((ax) => {
    const v = s.values[ax.id];
    const br = bracketOf(data, ax.id, v);
    const locked = isConsensus(s, ax.id);
    return axisBar(ax.negName, ax.posName, v)
      + (br?.desc ? `<div class="xs muted" style="margin:-4px 0 12px;line-height:1.65">${esc(br.desc)}</div>` : '')
      + (locked ? `<div class="xs" style="color:var(--gold);margin:-8px 0 12px">這件事已經沒什麼人在爭了。</div>` : '');
  }).join('')) + card('', `<div class="xs muted" style="line-height:1.8">
    每一條軸每個月最多只會移動一點點。要讓一條軸跨過一整級，大概需要四到五年的持續施力——
    法案、教育、媒體、還有你反覆講的那些話。</div>`);
}

/**
 * 兩岸態度的七個維度。
 *
 * 統獨是這座島上最多人在意的一件事，把它壓成一條線太粗糙了。
 * 這七個維度彼此獨立，而且底下那一排「主要理由」才是真正決定
 * 什麼樣的說法打得動什麼人的東西——理由不等於方向。
 */
function chinaBlock(s, data) {
  const cn = s.flags.chinaMood ?? chinaMood(s);
  const rows = data.china.dims.map((d) => {
    const v = cn[d.id] ?? 0;
    return axisBar(d.negName, d.posName, v)
      + `<div class="xs muted" style="margin:-4px 0 12px;line-height:1.65">${esc(d.desc)}</div>`;
  }).join('');

  // 各理由的人口比例
  const P = s.pops;
  const cnt = new Array(data.reasonKeys.length).fill(0);
  let w = 0;
  for (let i = 0; i < P.n; i++) { cnt[P.chinaReason[i]] += P.size[i]; w += P.size[i]; }
  const reasons = data.china.reasons.map((r, i) => `
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k">${esc(r.name)}</span>
        <span class="row-v num">${(cnt[i] / Math.max(1, w) * 100).toFixed(1)}%</span>
      </div>
      <div class="xs muted" style="line-height:1.7;margin-top:3px">${esc(r.desc)}</div>
    </div>`).join('');

  return card('對岸這件事', rows) + card('他們在意的理由是什麼', reasons
    + `<div class="xs muted" style="margin-top:8px;line-height:1.8">
      同樣從經濟出發，有人主張離不開那個市場，也有人主張押在那裡遲早被掐住咽喉——
      他們在這張表上是同一類。所以同一則經濟新聞會同時強化這兩群人原本的立場，
      而不是把他們推往同一個方向。這就是為什麼講道理很少能說服任何人。</div>`);
}

/**
 * 男女的差距。
 * 台灣年輕世代的性別政治落差正在快速擴大，而且它已經開始改變選舉結果。
 */
function genderBlock(s, data) {
  const g = s.flags.genderSupport;
  if (!g) return '';
  const rows = data.partyIds.map((pid) => {
    const p = s.parties[pid];
    const m = (g.male[pid] ?? 0) * 100, f = (g.female[pid] ?? 0) * 100;
    return { pid, name: p.shortName ?? p.name, color: p.color, m, f, gap: m - f };
  }).sort((a, b) => (b.m + b.f) - (a.m + a.f)).slice(0, 6);

  const body = rows.map((r) => {
    const L = F.genderLean(r.m, r.f);
    return `<div class="gaprow">
      <span class="ct-n" style="color:${r.color}">${esc(r.name)}</span>
      <span class="g-lean ${L.cls}">${esc(L.text)}</span>
      <span class="g-raw">男 ${r.m.toFixed(1)}　女 ${r.f.toFixed(1)}</span>
    </div>`;
  }).join('');

  const G = data.pops.gender;
  const worst = rows.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  const wl = worst ? F.genderLean(worst.m, worst.f) : null;
  return card('男女的差距', body + `
    <div class="xs muted" style="margin-top:8px;line-height:1.8">
      每一列寫的是哪一邊比較挺、差幾個百分點：${esc(wl?.text ?? '')}就是說
      ${esc(worst?.name ?? '')}在${wl?.side === 'male' ? '男性' : '女性'}那邊多拿了
      ${(wl?.amount ?? 0).toFixed(1)} 個百分點。<br>
      這道落差在青年世代會被放大到 ${((G.gapByGeneration?.youth ?? 1.75)).toFixed(2)} 倍，
      到了樂齡世代則縮到 ${((G.gapByGeneration?.senior ?? 0.45)).toFixed(2)} 倍——
      也就是說，這件事是新的，而且還在擴大。
    </div>`);
}

function world(s, data) {
  const items = Object.values(s.world).slice(0, 13).map((b) => ({ label: b.name, value: b.stance }));
  return html`
    ${card('對台友好程度', radar(items))}
    ${card('十五個區塊', Object.values(s.world).map((b) => `
      <div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="row-k"><b>${esc(b.name)}</b></span>
          <span class="row-v word">${esc(biWord('relation', b.stance))}</span>
        </div>
        <div class="xs muted" style="margin-top:3px">
          經貿 ${esc(word('reach', b.economicLink))}${b.militaryPressure > 0 ? `・軍事壓力 ${esc(word('issueHeat', b.militaryPressure))}` : ''}・景氣 ${b.cycle > 0.2 ? '看好' : b.cycle < -0.2 ? '低迷' : '持平'}
        </div>
      </div>`).join(''))}`;
}

function history(s, data) {
  const h = s.history;
  if (h.length < 2) return card('走勢', '<div class="xs muted">還沒有累積足夠的年度資料。等過幾年再回來看。</div>');
  const labels = h.map((x) => String(x.year));
  return html`
    ${card('支持度', lineChart([{ data: h.map((x) => x.approval), color: 'var(--accent)' }], { labels, min: 0, max: 100 }))}
    ${card('全國生活水準', lineChart([{ data: h.map((x) => x.sol), color: 'var(--good)' }], { labels, min: 0, max: 5 }))}
    ${card('失業率', lineChart([{ data: h.map((x) => x.unemployment * 100), color: 'var(--warn)' }], { labels }))}
    ${card('加權指數', lineChart([{ data: h.map((x) => x.stockIndex), color: 'var(--gold)' }], { labels }))}
    ${card('國債佔 GDP', lineChart([{ data: h.map((x) => x.debtToGdp * 100), color: 'var(--bad)' }], { labels }))}`;
}
