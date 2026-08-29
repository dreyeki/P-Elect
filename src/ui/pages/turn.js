// @ts-check
import { html, raw, esc } from '../../util/dom.js';
import { card, row, wordRow, tile, effectPreview, chip } from '../components.js';
import * as F from '../../util/format.js';
import { word } from '../../util/scale.js';
import { ACTIONS, apOf, actionState, lockedActions } from '../../systems/CharacterSystem.js';
import { latestPublic, latestAny } from '../../systems/PollSystem.js';
import { biWord } from '../../util/scale.js';
import * as People from '../../systems/PeopleSystem.js';
import { ledger } from '../../systems/FavorSystem.js';
import * as ImageSys from '../../systems/ImageSystem.js';
import { app } from '../app.js';

export function turnPage(s, data) {
  const pend = pending(s, data);
  const news = s.news.slice(0, 14);

  return html`
    ${raw(s.player.hospitalTurns > 0 ? card('', `
      <div style="text-align:center;padding:6px 0">
        <div class="tile-v tone-bad">你正在住院</div>
        <div class="small muted" style="margin-top:6px;line-height:1.7">
          醫生要你把行程全部推掉，接下來 ${s.player.hospitalTurns} 個回合由團隊代理。
          支持者送來的花把病房堆滿了，對手則在這段時間往前走了一大步。
        </div>
      </div>`) : '')}

    ${raw(pend.length ? card(`待決事項 ${pend.length}`, pend.join('')) : '')}

    ${raw(imageBlock(s, data))}

    ${card('本回合行動', actionList(s, data), `<span class="xs muted">剩 ${apOf(s, data) - s.player.apUsed} 點</span>`)}

    ${card('民調與風向', pollBlock(s, data))}

    ${card('選區裡的人', peopleBlock(s, data))}

    ${raw(favorBlock(s, data))}

    ${card('新聞', news.length ? news.map(newsRow).join('') : '<div class="xs muted">島上這幾天很安靜，沒有什麼值得上報的事。</div>')}
  `;
}

/**
 * 主打形象。
 * 這一格放在首頁最上面，因為那是選民記住你的那一句話——
 * 玩家每個回合做的每一件事，都應該看著這句話決定要不要做。
 */
function imageBlock(s, data) {
  const p = s.player;
  const img = data.images.playerImages.find((x) => x.id === p.image);
  if (!img) {
    if (p.fame < 1) return '';
    return card('主打形象', `<div class="xs muted" style="line-height:1.75">
      你還沒有決定要讓人記住哪一句話。現在提到你，每個人講的都不一樣，
      這在選舉的時候是一件很致命的事。</div>`);
  }
  const left = ImageSys.monthsUntilReview(s, data);
  const years = ((s.meta.turn - (p.imageSince ?? s.meta.turn)) / 12);
  const mature = years >= 2 ? '已經立起來了' : years >= 1 ? '還在長' : '才剛掛上去';
  return card('主打形象', `
    <div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="row-k"><b>${esc(img.name)}</b></span>
        <span class="row-v xs ${left > 0 ? 'muted' : 'tone-warn'}">${
          left > 0 ? `${left} 個月後可以重新決定` : '可以重新決定了'}</span>
      </div>
      <div class="small" style="margin-top:5px;line-height:1.75">「${esc(img.slogan)}」</div>
      <div class="xs muted" style="margin-top:5px;line-height:1.7">
        打了 ${years.toFixed(1)} 年，${mature}。${esc(img.backfire?.text ?? '')}
      </div>
    </div>`);
}

/**
 * 選區裡的人。
 * 這一格從開局第一回合就在，而且會一直在——
 * 這些人不是選舉那一刻才生出來的對手，他們一直都在同一條街上跑。
 */
function peopleBlock(s, data) {
  const list = People.inDistrict(s, s.player.homeDistrict)
    .slice(0, data.people.homePageDisplay?.maxShown ?? 5);
  if (!list.length) return '<div class="xs muted">這個選區目前沒有其他在跑的人。這種情況不會維持太久。</div>';
  const rows = list.map((p) => {
    const party = p.party ? data.byId.party[p.party] : null;
    const arc = data.people.archetypes.find((a) => a.id === p.archetype);
    const th = People.threat(p);
    const age = s.meta.year - p.birthYear;
    const traits = p.traits.map((t) => data.people.traits.find((x) => x.id === t)?.name).filter(Boolean);
    const fav = p.favor ?? 0;
    const favTag = Math.abs(fav) < 0.3 ? ''
      : fav > 0 ? `<span class="chip ok xs">欠你人情</span>`
        : `<span class="chip warn xs">你欠他人情</span>`;
    return `<div class="npcrow">
      <span class="npc-n" style="color:${party ? party.color : 'var(--fg-2)'}">${esc(p.name)}</span>
      <span class="npc-p xs">${esc(party ? party.shortName : '無黨籍')}・${age} 歲</span>
      <span class="npc-a xs muted">${esc(arc?.name ?? '')}${traits.length ? '・' + esc(traits[0]) : ''}</span>
      <span class="npc-t">${esc(word('npcThreat', th))}</span>
      ${favTag}
    </div>`;
  }).join('');
  return `${rows}<div class="xs muted" style="margin-top:8px;line-height:1.7">
    這些人跟你跑同一批婚喪喜慶。等到要選的時候，名單多半就是從這裡出來的。</div>`;
}

/** 手上握著誰的人情、又欠了誰 */
function favorBlock(s, data) {
  const L = ledger(s);
  if (!L.owed.length && !L.owing.length) return '';
  const line = (p, owed) => `<span class="chip ${owed ? 'ok' : 'warn'} xs">${esc(p.name)}　${esc(word('favorDebt', Math.abs(p.favor)))}</span>`;
  return card('人情往來', `
    ${L.owed.length ? `<div class="small" style="margin-bottom:6px">欠你的：${L.owed.slice(0, 6).map((p) => line(p, true)).join('')}</div>` : ''}
    ${L.owing.length ? `<div class="small">你欠的：${L.owing.slice(0, 6).map((p) => line(p, false)).join('')}</div>` : ''}
    <div class="xs muted" style="margin-top:8px;line-height:1.7">
      這一行真正的貨幣不是錢，是誰欠誰。握著別人的人情，幫忙會自己找上門；欠著別人的，請託也會。</div>`);
}

function newsRow(n) {
  return `<div class="news k-${esc(n.kind ?? 'x')}"><div class="news-t">${esc(n.text)}</div></div>`;
}

function pending(s, data) {
  const out = [];
  for (const ev of s.pendingEvents) {
    out.push(`<button class="pending" data-act="open-event" data-id="${esc(ev.id)}">
      <span class="pi">${icon(ev.category)}</span>
      <span><span class="ph">${esc(ev.headline)}</span>
      <span class="pb">${esc(ev.body.slice(0, 46))}…</span></span></button>`);
  }
  for (const d of s.finance.pending) {
    out.push(`<button class="pending" data-act="open-donation" data-id="${esc(d.id)}">
      <span class="pi">💰</span>
      <span><span class="ph">${esc(d.donorName)} 政治獻金 ${esc(F.money(d.amount))}</span>
      <span class="pb">${d.condition ? esc(d.condition.desc) : '對方表示沒有任何附帶條件。'}</span></span></button>`);
  }
  for (const inv of (s.invitations ?? []).slice(0, 2)) {
    const show = data.byId.show[inv.showId];
    out.push(`<button class="pending" data-act="open-shows">
      <span class="pi">🎙️</span>
      <span><span class="ph">${esc(show.name)} 發來通告</span>
      <span class="pb">這集要談${esc(inv.topicName)}，還有 ${inv.expiresIn} 個回合可以答應。</span></span></button>`);
  }
  if (s.flags.recruitOffer) {
    const r = s.flags.recruitOffer;
    out.push(`<button class="pending" data-act="open-recruit">
      <span class="pi">🧑‍💼</span>
      <span><span class="ph">${esc(r.name)} 想來當你的${esc(r.roleName)}</span>
      <span class="pb">能力 ${esc(word('ability', r.ability))}，月薪開 ${esc(F.money(r.salary))}。</span></span></button>`);
  }
  // 有人拿著一份印刷精美的資料來找你。
  // 遊戲不會標示這是不是詐騙，但每一段話裡都留了線索。
  if (s.assets?.scamOffer) {
    const o = s.assets.scamOffer;
    out.push(`<button class="pending" data-act="open-scam">
      <span class="pi">📈</span>
      <span><span class="ph">有人來介紹一個投資機會</span>
      <span class="pb">${esc(o.pitch.slice(0, 46))}…</span></span></button>`);
  }
  if (s.election?.phase === 'decide') {
    out.push(`<button class="pending" data-act="nav-election">
      <span class="pi">🗳️</span>
      <span><span class="ph">選舉登記就要截止了</span>
      <span class="pb">你必須決定這一次要不要出來選，選哪一個位子。</span></span></button>`);
  }
  // 社交邀約：婚宴、告別式、運動會、企業活動
  for (const inv of (s.socialInvites ?? []).slice(0, 3)) {
    const k = data.byId.invitation[inv.kindId];
    if (!k) continue;
    out.push(`<button class="pending" data-act="open-invites">
      <span class="pi">${esc(k.icon)}</span>
      <span><span class="ph">${esc(k.name)}的邀約</span>
      <span class="pb">${esc(inv.lead.slice(0, 44))}…</span></span></button>`);
  }
  // 人情牽制帶來的幫忙或請託
  (s.favorPending ?? []).forEach((f, i) => {
    out.push(`<button class="pending" data-act="open-favor" data-id="${i}">
      <span class="pi">${f.kind === 'help' ? '🤝' : '📿'}</span>
      <span><span class="ph">${esc(f.headline)}</span>
      <span class="pb">${esc(f.body.slice(0, 44))}…</span></span></button>`);
  });
  if (s.mediaAttack) {
    out.push(`<button class="pending" data-act="open-attack">
      <span class="pi">📰</span>
      <span><span class="ph">${esc(s.mediaAttack.headline)}</span>
      <span class="pb">${esc(s.mediaAttack.body.slice(0, 44))}…</span></span></button>`);
  }
  if (s.flags.graftCase) {
    const g = s.flags.graftCase;
    out.push(`<button class="pending" data-act="open-graft">
      <span class="pi">🚨</span>
      <span><span class="ph">${esc(g.name)}名下有一筆說不清楚的錢</span>
      <span class="pb">記者已經在服務處門口，你必須在今天之內決定怎麼處理。</span></span></button>`);
  }
  if (s.flags.pendingPrimaryEvent && s.meta.turn >= s.flags.pendingPrimaryEvent.turn) {
    out.push(`<button class="pending" data-act="open-aftermath">
      <span class="pi">🗳️</span>
      <span><span class="ph">初選之後的那通電話來了</span>
      <span class="pb">這件事跟你上一次沒有拿到的那張提名有關。</span></span></button>`);
  }
  return out;
}

const ICONS = { economy: '📈', energy: '⚡', crossStrait: '🌊', disaster: '🌀', society: '🏙️', scandal: '🔍', party: '🏳️', personal: '🏠', world: '🌏', law: '📜' };
const icon = (c) => ICONS[c] ?? '📰';

function actionList(s, data) {
  const left = apOf(s, data) - s.player.apUsed;
  const blocked = s.player.hospitalTurns > 0;
  const open = ACTIONS.filter((a) => actionState(s, data, a).unlocked);
  const grid = open.map((a) => {
    const dis = blocked || a.ap > left;
    return `<button class="actbtn ${dis ? 'locked' : ''}" data-act="do-action" data-id="${a.id}"
      title="${esc(a.desc)}" ${dis ? 'disabled' : ''}>
      <span class="an">${esc(a.name)}</span><span class="aa">${a.ap}</span>
    </button>`;
  }).join('');
  const locked = lockedActions(s, data);
  const lockedBlock = locked.length ? `
    <details class="lockbox">
      <summary>還沒解鎖的 ${locked.length} 項</summary>
      ${locked.map((x) => `<div class="lockrow"><b>${esc(x.a.name)}</b><span>${esc(x.st.why ?? '')}</span></div>`).join('')}
    </details>` : '';
  const unit = s.meta.scale === 'week' ? '這一週' : '這個月';
  const hint = blocked ? `你在住院，${unit}什麼都做不了。`
    : left <= 0 ? `${unit}的時間已經用完了。` : open[0].desc;

  // 常駐通告佔掉的行動點要讓玩家看得見，不然他會以為是程式壞了
  const gigs = (s.canvassGigs ?? []).filter((g) => g.active);
  const gigBlock = gigs.length ? `
    <div class="xs muted" style="margin-top:6px;line-height:1.7">
      固定要跑的場子：${gigs.map((g) => `${esc(g.name)}<button class="lnk xs" data-act="drop-gig" data-id="${esc(g.sceneId)}">退掉</button>`).join('、')}
      　合計先佔掉 ${gigs.length} 點。
    </div>` : '';

  return `<div class="actgrid">${grid}</div>
    <div class="xs muted" style="margin-top:8px;line-height:1.6">${esc(hint)}</div>
    ${gigBlock}
    ${lockedBlock}
    <button class="btn primary full" data-act="end-turn" style="margin-top:10px">${esc(endTurnLabel(s, data, left))}</button>`;
}

/**
 * 結束回合的按鈕不該永遠寫同一句話。
 * 在住院、在選戰倒數、還有行動點沒用——
 * 這幾種情況下玩家按下去的意義完全不同，那句話就該不一樣。
 *
 * 刻意不提「還有幾件事沒處理」：待決事項就在畫面上方列著，
 * 在按鈕上再念一次只會讓人覺得被催促。
 */
export function endTurnLabel(s, data, left) {
  if (s.player.hospitalTurns > 0) return '躺著讓時間過去';
  if (s.election?.phase === 'campaign') {
    const w = s.election.weeksLeft ?? 0;
    return w <= 1 ? '撐完投票前的最後一週' : `結束這一週（投票倒數 ${w} 週）`;
  }
  // 選戰期間一回合是一週。這一段要放在所有以「月」為單位的說法前面，
  // 否則玩家會在只剩三週的時候看到「結束十二月」。
  const week = s.meta.scale === 'week';
  if (week) {
    if (left >= 2) return `還剩 ${left} 點沒用，結束這一週`;
    if ((s.player.fatigueRaw ?? 0) >= 60) return '真的撐不住了，結束這一週';
    return '結束這一週';
  }
  if (left >= 2) return `還剩 ${left} 點沒用，就這樣結束`;
  if (left === 1) return '把剩下的一點時間留給自己';
  if ((s.player.fatigueRaw ?? 0) >= 60) return '真的撐不住了，結束這個月';
  const m = s.meta.month;
  if (m === 12) return '結束十二月，準備跨年';
  if (m === 1 && s.meta.turn > 2) return '結束一月，這一年才剛開始';
  return '結束這個月';
}

/** 民調要有人做才有。沒人做的時候，這一格就該老實承認自己不知道。 */
function pollBlock(s, data) {
  const pub = latestPublic(s);
  const any = latestAny(s);
  const idx = any ? (s.polls ?? []).indexOf(any) : -1;
  const ago = any ? s.meta.turn - any.turn : null;
  const hot = hottest(s, data);

  if (!any) {
    return `<div class="small muted" style="line-height:1.8">
      最近沒有任何一家民調公司做過調查，你手上也沒有自己的數字。
      在這一行，不知道自己站在哪裡，比站得不好還危險。</div>
      <div class="grid2" style="margin-top:10px">
        ${tile('最熱議題', `<span class="word">${esc(hot)}</span>`, '', 'sm')}
        ${tile('本月新聞', `<span class="num">${s.news.filter((n) => n.turn === s.meta.turn - 1).length}</span>`, '則')}
      </div>
      <button class="btn full" data-act="open-commission" style="margin-top:10px">花錢做一份自己的民調</button>`;
  }

  const mine = any.playerListed
    ? `<span class="num">${any.playerApproval.toFixed(1)}%</span>`
    : '<span class="small muted">未列入</span>';
  const src = `${any.pollsterShort}${any.internal ? '（內參）' : ''}・${ago === 0 ? '本回合' : ago + ' 回合前'}・${any.scopeName}`;

  return `<div class="grid3">
      ${tile('你的支持度', mine, esc(src), 'sm')}
      ${tile('總統滿意度', `<span class="num">${any.presidentApproval.toFixed(0)}%</span>`, '', 'sm')}
      ${tile('最熱議題', `<span class="word">${esc(hot)}</span>`, '', 'sm')}
    </div>
    ${!any.playerListed ? `<div class="xs muted" style="margin-top:8px;line-height:1.7">
      你的知名度還不夠讓民調公司把你放進題目裡。想被問到，得先讓人記得你的名字。</div>` : ''}
    ${any.internal ? '' : `<div class="xs muted" style="margin-top:8px;line-height:1.7">
      這是公開民調，帶著${any.bias > 1 ? '偏藍' : any.bias < -1 ? '偏綠' : '中性'}的房效應與 ±${any.error.toFixed(1)}% 的誤差。想要準的，得自己花錢。</div>`}
    <div class="btn-row">
      <button class="btn ghost" data-act="open-poll" data-idx="${idx}">看這份民調</button>
      <button class="btn ghost" data-act="open-commission">委託內參民調</button>
    </div>`;
}

function hottest(s, data) {
  let best = null, v = -1;
  for (const i of data.issues.issues) if (s.issues[i.id] > v) { v = s.issues[i.id]; best = i; }
  return best ? `${best.name}・${word('issueHeat', v)}` : '無';
}

/**
 * 事件 Modal。
 *
 * 被鎖住的選項不會消失，它會留在那裡變成暗的，旁邊寫著你缺什麼——
 * 一個政治素人可以對颱風有意見，但他宣布不了停班停課，
 * 而看得到那個按鈕是暗的，比看不到那個按鈕有意義得多。
 *
 * 最下面永遠有一個表態反對的選項。這是這一行最常見也最便宜的回應：
 * 不需要方案，只需要立場。用詞每次都會換，效果由口才決定。
 */
export function eventModal(ev, s) {
  const opts = ev.options.map((o) => `
    <button class="opt" data-act="pick-option" data-ev="${esc(ev.id)}" data-idx="${o.idx}">
      <div class="opt-t">${esc(o.text)}</div>
      ${o.hint ? `<div class="opt-h">${esc(o.hint)}</div>` : ''}
      ${effectPreview(o.effects)}
    </button>`).join('');
  const locked = (ev.lockedOptions ?? []).map((o) => `
    <div class="opt locked">
      <div class="opt-t">${esc(o.text)}</div>
      <div class="opt-h">🔒 ${esc(o.why)}</div>
    </div>`).join('');
  const opp = ev.oppose ? `
    <button class="opt oppose" data-act="pick-oppose" data-ev="${esc(ev.id)}">
      <div class="opt-t">${esc(ev.oppose.text)}</div>
      <div class="opt-h">${esc(ev.oppose.hint)}</div>
    </button>` : '';
  return `<div class="modal-h">${esc(ev.headline)}</div>
    <div class="modal-b">${esc(ev.body)}</div>${opts}${opp}${locked}`;
}
