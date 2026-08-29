// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, tile, row, attrLine, wordTile } from '../components.js';
import * as F from '../../util/format.js';
import { word, biWord } from '../../util/scale.js';
import { slots, roleAvailable } from '../../systems/TeamSystem.js';
import { ROLE_NAME } from '../../core/GameState.js';
import { officeCost } from '../../systems/DistrictSystem.js';
import * as Asset from '../../systems/AssetSystem.js';

/* ───────── 團隊 ───────── */
export function teamPage(s, data) {
  const cap = slots(s, data);
  const offer = s.flags.recruitOffer;
  return html`
    ${card(`團隊 ${s.team.length}／${cap}`, s.team.length ? s.team.map((t) => `
      <div class="staff">
        <span class="av">${esc(t.name[0])}</span>
        <span class="si">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <b>${esc(t.name)}</b><span class="xs muted">${esc(t.roleName ?? data.byId.staffRole[t.role].name)}</span>
          </div>
          <div class="xs muted" style="margin-top:2px">
            能力 ${esc(word('ability', t.ability))}・忠誠 <span class="${t.loyalty <= 1 ? 'tone-bad' : ''}">${esc(word('loyalty', t.loyalty))}</span>
            ${t.ambition >= 4 ? '・<span class="tone-warn">' + esc(word('ambition', t.ambition)) + '</span>' : ''}
          </div>
          <div class="xs muted">月薪 ${esc(F.money(t.salary))}${t.knownSecrets ? `・知道你 ${t.knownSecrets} 件不該知道的事` : ''}</div>
          <div class="btn-row" style="margin-top:6px">
            <button class="btn ghost xs" data-act="train-staff" data-id="${esc(t.id)}" style="padding:4px 9px">培養（1 AP）</button>
            <button class="btn ghost xs danger" data-act="fire-staff" data-id="${esc(t.id)}" style="padding:4px 9px">請他離開</button>
          </div>
        </span>
      </div>`).join('') : '<div class="xs muted">你現在什麼人都沒有。一個人做政治，能做的事很有限。</div>')}

    ${raw(offer ? card('有人想加入', `
      <div class="staff">
        <span class="av">${esc(offer.name[0])}</span>
        <span class="si">
          <b>${esc(offer.name)}</b><span class="xs muted">　${esc(offer.roleName)}</span>
          <div class="xs muted" style="margin-top:3px">
            能力 ${esc(word('ability', offer.ability))}・忠誠 ${esc(word('loyalty', offer.loyalty))}・${esc(word('ambition', offer.ambition))}
          </div>
          <div class="xs muted">開價 ${esc(F.money(offer.salary))}／月</div>
        </span>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="hire" ${s.team.length >= cap ? 'disabled' : ''}>聘用</button>
        <button class="btn ghost" data-act="decline-hire">婉拒</button>
      </div>
      ${s.team.length >= cap ? '<div class="warnline">你的職位還撐不起這麼多幕僚。</div>' : ''}`) : '')}

    ${card('職位效果', data.staffRoles.roles.map((r) => {
      const has = s.team.find((t) => t.role === r.id);
      const open = has || roleAvailable(s, r);
      return `<div class="row" style="display:block">
        <div style="display:flex;justify-content:space-between">
          <span class="row-k ${open ? '' : 'muted'}">${esc(r.name)}</span>
          <span class="row-v xs ${has ? 'tone-ok' : open ? 'muted' : 'tone-warn'}">${
            has ? esc(has.name) : open ? '從缺' : '還沒有人願意來'}</span>
        </div>
        <div class="xs muted" style="margin-top:2px;line-height:1.6">${esc(r.desc)}</div>
        ${open ? '' : `<div class="xs muted" style="margin-top:3px;line-height:1.6">${esc(r.unlockNote ?? '')}</div>`}
      </div>`;
    }).join(''))}`;
}

/* ───────── 財務 ───────── */
export function financePage(s, data) {
  const f = s.finance;
  const salaries = s.team.reduce((a, t) => a + t.salary, 0);
  const office = officeCost(s, data);
  return html`
    ${card('三個帳戶', `<div class="grid2">
      ${tile('現金', `<span class="num ${f.personal < 0 ? 'tone-bad' : ''}">${F.money(f.personal)}</span>`)}
      ${tile('競選經費', `<span class="num ${f.campaign < 100000 ? 'tone-warn' : ''}">${F.money(f.campaign)}</span>`)}
      ${tile('淨資產', `<span class="num ${Asset.netWorth(s) < 0 ? 'tone-bad' : ''}">${F.money(Asset.netWorth(s))}</span>`, '房產與投資扣掉負債')}
      ${tile('總負債', `<span class="num ${Asset.totalDebt(s) > 0 ? 'tone-warn' : ''}">${F.money(Asset.totalDebt(s))}</span>`, `年收入的 ${Asset.debtRatio(s, data).toFixed(1)} 倍`)}
    </div>
    <div class="xs muted" style="margin-top:8px;line-height:1.7">
      私產可以轉進競選專戶，反過來不行——那叫挪用，而且會留下紀錄。
    </div>
    <div class="btn-row">
      <button class="btn" data-act="transfer" data-amt="500000">轉 50 萬進專戶</button>
      <button class="btn" data-act="transfer" data-amt="2000000">轉 200 萬進專戶</button>
    </div>`)}

    ${raw(assetBlock(s, data))}

    ${card('每回合固定支出', `
      ${row('幕僚薪資', `<span class="num">${F.money(salaries)}</span>`)}
      ${row('服務處與組織維持', `<span class="num">${F.money(office)}</span>`)}
      ${row('個人生活開支', `<span class="num">${F.money(livingOf(s))}</span>`)}
      ${raw(debtPaymentRow(s))}
      ${row('職務薪俸', `<span class="num tone-ok">＋${F.money(salaryOf(s))}</span>`)}`)}

    ${raw(f.pending.length ? card('待決獻金', f.pending.map((d) => `
      <div class="donation">
        <div class="dam">${esc(F.money(d.amount))}</div>
        <div class="small" style="margin-top:4px"><b>${esc(d.donorName)}</b>　<span class="chip">${esc(d.sourceName)}</span></div>
        <div class="small dim" style="margin-top:6px;line-height:1.7">${esc(d.flavor)}</div>
        ${d.condition ? `<div class="warnline">⚠ ${esc(d.condition.desc)}。</div>` : ''}
        ${d.stigmaOnAccept > 0 ? `<div class="warnline">⚠ 收下這筆錢會留下紀錄，往後翻不掉。</div>` : ''}
        <div class="btn-row">
          <button class="btn primary" data-act="accept-donation" data-id="${esc(d.id)}">收下</button>
          <button class="btn ghost" data-act="refuse-donation" data-id="${esc(d.id)}">婉拒</button>
        </div>
      </div>`).join('')) : '')}

    ${card('已收獻金', f.donations.length ? f.donations.slice(-8).reverse().map((d) => `
      <div class="row"><span class="row-k">${esc(d.donorName)}</span>
      <span class="row-v"><span class="num">${esc(F.money(d.amount))}</span>
      ${d.condition && !d.settled ? `<span class="chip warn">條件未了</span>` : ''}</span></div>`).join('')
      : '<div class="xs muted">你還沒有收過任何一筆政治獻金。</div>')}

    ${card('財產申報', `
      ${row('上次申報', `<span class="num">${F.money(f.lastDeclaredAssets)}</span>`, '')}
      ${row('目前實際', `<span class="num">${F.money(Asset.netWorth(s))}</span>`)}
      <div class="xs muted" style="margin-top:6px;line-height:1.7">
        每年十二月自動申報。差距超過兩成會有人來問，那個時候再解釋就來不及了。
      </div>`)}`;
}
/**
 * 房子、貸款、投資。
 * 這一格是玩家在按下每一個「要不要收這筆錢」之前，最該看一眼的地方。
 */
function assetBlock(s, data) {
  const A = s.assets;
  if (!A) return '';
  const rows = [];
  if (A.house) {
    rows.push(`<div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between">
        <span class="row-k">自用住宅</span>
        <span class="row-v"><span class="num">${esc(F.money(A.house.value))}</span></span>
      </div>
      <div class="xs muted" style="margin-top:2px;line-height:1.7">
        房貸餘額 ${esc(F.money(A.house.mortgage))}${A.house.mortgage > 0
          ? `・每月扣 ${esc(F.money(Asset.monthlyPayment(A.house.mortgage, A.house.rate, Math.max(1, A.house.termYears))))}`
          : '・已經還完了'}</div>
    </div>`);
  }
  for (const l of A.loans ?? []) {
    rows.push(`<div class="row"><span class="row-k">${esc(l.name)}</span>
      <span class="row-v"><span class="num tone-warn">${esc(F.money(l.balance))}</span>
      <span class="xs muted">　月付 ${esc(F.money(l.monthly))}</span></span></div>`);
  }
  for (const h of A.holdings ?? []) {
    const pnl = h.value - h.cost;
    const pct = h.cost ? pnl / h.cost * 100 : 0;
    rows.push(`<div class="row"><span class="row-k">${esc(h.name)}</span>
      <span class="row-v"><span class="num ${pnl >= 0 ? 'tone-ok' : 'tone-bad'}">${esc(F.money(h.value))}</span>
      <span class="xs muted">　${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span></span></div>`);
  }
  if (!rows.length) return '';
  return card('私有財產', rows.join('') + `
    <button class="btn ghost full" data-act="open-finances" style="margin-top:8px">貸款與投資</button>`);
}

function debtPaymentRow(s) {
  const A = s.assets;
  if (!A) return '';
  let pay = (A.loans ?? []).reduce((a, l) => a + l.monthly, 0);
  if (A.house?.mortgage > 0) {
    pay += Asset.monthlyPayment(A.house.mortgage, A.house.rate, Math.max(1, A.house.termYears));
  }
  if (pay <= 0) return '';
  return `<div class="row"><span class="row-k">房貸與貸款月付</span>
    <span class="row-v"><span class="num tone-warn">${esc(F.money(pay))}</span></span></div>`;
}

const SALARY = { citizen: 0, aide: 45000, village: 50000, councilor: 120000, legislator: 190000, mayor: 240000, minister: 220000, president: 470000 };
const LIVING = { citizen: 50000, aide: 55000, village: 60000, councilor: 90000, legislator: 140000, mayor: 180000, minister: 170000, president: 250000 };
const salaryOf = (s) => SALARY[s.player.role] ?? 0;
const livingOf = (s) => LIVING[s.player.role] ?? 50000;

/* ───────── 個人 ───────── */
export function profilePage(s, data) {
  const p = s.player;
  const age = s.meta.year - p.birthYear;
  const bg = data.backgrounds.backgrounds.find((b) => b.id === p.background);
  return html`
    ${card(p.name, `
      ${row('年齡', `<span class="num">${age} 歲</span>`)}
      ${row('現職', esc(p.office?.name ?? ROLE_NAME[p.role]))}
      ${row('政黨', p.party ? `<span style="color:${data.byId.party[p.party]?.color}">${esc(s.parties[p.party]?.name)}</span>` : '無黨籍')}
      ${row('出身', esc(bg?.name ?? ''))}
      ${row('學歷', esc(p.education))}`)}

    ${card('屬性', `
      ${attrLine('體力', 'stamina', p.attrs.stamina)}
      ${attrLine('交際', 'sociability', p.attrs.sociability)}
      ${attrLine('魅力', 'charisma', p.attrs.charisma)}
      ${attrLine('口才', 'eloquence', p.attrs.eloquence)}
      ${attrLine('判斷', 'judgment', p.attrs.judgment)}
      ${attrLine('氣魄', 'boldness', p.attrs.boldness)}
      <div class="xs muted" style="margin-top:8px;line-height:1.7">
        氣魄不只是加值。太慫的人看不到某些選項，太衝的人也做不出退縮的樣子。
      </div>`)}

    ${card('形象', `<div class="grid2">
      ${wordTile('知名度', 'fame', p.fame)}
      ${wordTile('民心', 'favor', p.favorNational, true)}
      ${wordTile('清廉印象', 'integrity', p.integrity)}
      ${wordTile('黨內聲望', 'partyPrestige', p.partyPrestige)}
    </div>
    <div class="row" style="display:block;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k">汙名印象<span class="xs muted">（只增不減）</span></span>
        <span class="word ${p.stigma >= 3 ? 'tone-bad' : p.stigma >= 1.5 ? 'tone-warn' : 'tone-ok'}">${esc(word('stigma', p.stigma))}</span>
      </div>
      <div class="bar b"><i style="width:${(p.stigma / 5 * 100).toFixed(0)}%"></i></div>
      <div class="xs muted" style="margin-top:6px;line-height:1.7">
        清廉印象是輿論，可以靠時間跟形象工程拉回來。汙名印象是紀錄，媒體跟對手永遠可以再翻出來。
      </div>
    </div>`)}

    ${card('標籤', s.tags.length ? s.tags.map((t) => {
      const tag = data.byId.tag[t];
      return `<div style="margin-bottom:8px"><span class="tag">${esc(tag.name)}</span>
        <div class="xs muted" style="line-height:1.65">${esc(tag.desc)}</div></div>`;
    }).join('') : '<div class="xs muted">還沒有人替你貼上任何標籤。這代表你還沒做過什麼夠鮮明的事。</div>')}

    ${card('經歷', p.careerLog.length
      ? p.careerLog.slice(-14).reverse().map((c) => `<div class="row">
          <span class="row-k xs">${esc(c.text)}</span>
          <span class="row-v xs muted">第 ${c.turn} 回合</span></div>`).join('')
      : '<div class="xs muted">你的政治生涯還沒有留下任何一行紀錄。</div>')}

    ${card('系統', `
      ${row('種子', `<span class="num">${esc(s.meta.seedStr)}</span>`)}
      ${row('回合', `<span class="num">${s.meta.turn}</span>`)}
      <div class="btn-row">
        <button class="btn" data-act="save-game" data-id="1">存到欄位一</button>
        <button class="btn" data-act="save-game" data-id="2">存到欄位二</button>
        <button class="btn ghost" data-act="export-save">匯出存檔</button>
      </div>
      <div class="btn-row">
        <button class="btn ghost" data-act="fontsize" data-id="s">小字</button>
        <button class="btn ghost" data-act="fontsize" data-id="m">中字</button>
        <button class="btn ghost" data-act="fontsize" data-id="l">大字</button>
      </div>
      <div class="btn-row">
        <button class="btn danger" data-act="restart">重新開始一局</button>
      </div>`)}`;
}
