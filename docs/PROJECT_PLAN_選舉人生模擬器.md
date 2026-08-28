# 《選舉人生：福爾摩沙》項目計畫文檔

**版本**：v0.2
**日期**：2026-08-27
**專案代號**：`p-election`
**倉庫路徑**：`C:\Users\DreYeKi\Documents\AAgame\p-election`
**搭配文檔**：《遊戲策劃書》(`GDD_選舉人生模擬器.md`)

---

## 目錄

1. [技術決策](#1-技術決策)
2. [目錄結構](#2-目錄結構)
3. [架構設計](#3-架構設計)
4. [資料檔規格](#4-資料檔規格)
5. [模組拆分與介面](#5-模組拆分與介面)
6. [存檔系統與版本遷移](#6-存檔系統與版本遷移)
7. [開發里程碑](#7-開發里程碑)
8. [效能預算](#8-效能預算)
9. [測試策略](#9-測試策略)
10. [GitHub Pages 部署](#10-github-pages-部署)
11. [程式碼規範](#11-程式碼規範)
12. [內容製作流程](#12-內容製作流程)
13. [風險清單](#13-風險清單)
14. [驗收標準](#14-驗收標準)

---

## 1. 技術決策

| 項目 | 決策 | 理由 |
|---|---|---|
| 語言 | **原生 JavaScript (ES2022)** | 零建置、直接部署、手機相容性最佳 |
| 模組系統 | **ES Modules**（`<script type="module">`） | 現代瀏覽器原生支援，免打包 |
| 框架 | **無** | 純文字遊戲的 DOM 更新量可控，自建輕量渲染層即可 |
| 樣式 | **原生 CSS + CSS Variables** | 主題切換、字級調整靠變數即可 |
| 圖表 | **手刻 SVG**（少量 Canvas） | 無依賴、體積小、可完全控制樣式 |
| 資料格式 | **JSON**（靜態 `fetch` 載入） | 可與程式邏輯分離，方便平衡調校 |
| 存檔 | **localStorage**（含 JSON 匯出/匯入） | 單機、離線、無後端 |
| 建置 | **無建置步驟** | `git push` 即部署 |
| 測試 | **Node 內建 `node:test`** | 開發期用，不進入產品 |
| 型別 | **JSDoc 註解 + `// @ts-check`** | 取得 IDE 型別提示，但不引入 TypeScript 建置 |

**明確排除**：npm 執行期依賴、bundler、TypeScript 編譯、後端 API、任何 CDN 外部資源（確保完全離線可玩）。

---

## 2. 目錄結構

```
p-election/
├── index.html                  # 唯一入口
├── manifest.webmanifest        # PWA（可加入主畫面、離線）
├── sw.js                       # Service Worker（離線快取）
├── README.md
├── docs/
│   ├── GDD_選舉人生模擬器.md
│   ├── PROJECT_PLAN_選舉人生模擬器.md
│   ├── BALANCE_LOG.md          # 平衡調校紀錄
│   └── CHANGELOG.md
├── css/
│   ├── reset.css
│   ├── theme.css               # CSS 變數：色彩、字級、間距
│   ├── layout.css              # 版面骨架、導覽列
│   └── components.css          # 卡片、按鈕、圖表、對話框
├── src/
│   ├── main.js                 # 啟動、載入資料、掛載 UI
│   ├── core/
│   │   ├── GameState.js        # 狀態根物件與存取器
│   │   ├── EventBus.js         # 發布訂閱
│   │   ├── Rng.js              # 可重現亂數（seeded, xorshift128）
│   │   ├── TurnEngine.js       # 回合流程排程器
│   │   ├── Modifier.js         # 修正值堆疊系統
│   │   └── Formula.js          # 共用數學工具（clamp、softmax、lerp）
│   ├── systems/
│   │   ├── WorldSystem.js      # 15 區塊演化
│   │   ├── EconomySystem.js    # 縣市 + 中央經濟
│   │   ├── CorporationSystem.js# 企業 mood、市值、股市
│   │   ├── PopSystem.js        # POP 生活水準、意識形態、支持度
│   │   ├── ValueSystem.js      # 8 軸國家價值觀
│   │   ├── PartySystem.js      # 政黨、派系、黨內鬥爭
│   │   ├── LegislatureSystem.js# 立法院、法案流程、表決
│   │   ├── CouncilSystem.js    # 地方議會、地方議案
│   │   ├── InterpellationSystem.js # 質詢攻防
│   │   ├── BudgetSystem.js     # 中央與地方預算
│   │   ├── ElectionSystem.js   # 各級選舉、初選、競選
│   │   ├── EventSystem.js      # 事件觸發、條件求值
│   │   ├── MediaSystem.js      # 媒體框架、議題熱度、民調
│   │   ├── ScandalSystem.js    # 醜聞、調查、司法
│   │   ├── CharacterSystem.js  # 玩家屬性、標籤、疲勞與過勞住院
│   │   ├── TeamSystem.js       # 玩家團隊：招募、培養、忠誠、背叛
│   │   ├── FinanceSystem.js    # 私產、競選經費、政治獻金、財產申報
│   │   └── DistrictSystem.js   # 195 選區、基層組織成長與衰退
│   ├── data/
│   │   └── loader.js           # JSON 載入與 schema 驗證
│   ├── ui/
│   │   ├── Router.js           # 頁面切換（hash-based）
│   │   ├── render.js           # 極簡 VDOM-less 渲染（html`` 模板）
│   │   ├── pages/
│   │   │   ├── TurnPage.js
│   │   │   ├── PoliticsPage.js
│   │   │   ├── DataPage.js
│   │   │   ├── MapPage.js
│   │   │   ├── RegionPage.js
│   │   │   ├── WorldPage.js
│   │   │   ├── ProfilePage.js
│   │   │   ├── ElectionPage.js
│   │   │   └── HistoryPage.js
│   │   ├── components/
│   │   │   ├── NewsCard.js
│   │   │   ├── DecisionModal.js
│   │   │   ├── StatBar.js
│   │   │   ├── EffectPreview.js   # 「這會影響什麼」箭頭圖示
│   │   │   ├── LawTierSlider.js
│   │   │   └── SeatChart.js
│   │   └── charts/
│   │       ├── LineChart.js
│   │       ├── BarChart.js
│   │       ├── StackedBar.js
│   │       ├── RadarChart.js
│   │       ├── AxisSlider.js
│   │       └── TaiwanMap.js       # 內嵌 SVG 路徑
│   ├── save/
│   │   ├── SaveManager.js
│   │   └── migrations.js
│   └── util/
│       ├── format.js           # 數字、貨幣、百分比格式化
│       ├── text.js             # 文本模板插值 {region} {value}
│       └── validate.js
├── data/
│   ├── meta.json               # 資料版本、schema 版本
│   ├── naming.json             # 所有虛構名稱集中管理
│   ├── scales.json             # 四字語詞刻度總表
│   ├── districts.json          # 195 個議員選區
│   ├── regions.json            # 22 縣市初始數值
│   ├── central.json            # 中央初始數值
│   ├── world.json              # 15 世界區塊
│   ├── corporations.json       # 企業清單
│   ├── parties.json            # 政黨與派系
│   ├── laws.json               # 25 條中央法律
│   ├── localBills.json         # 15 條地方議案
│   ├── values.json             # 8 軸價值觀定義與修正表
│   ├── pops.json               # POP 模板與初始分佈規則
│   ├── media.json              # 媒體清單
│   ├── issues.json             # 12 大議題定義
│   ├── budget.json             # 歲入歲出科目定義
│   ├── elections.json          # 選舉時程與選區劃分
│   ├── starts.json             # 2 種開局起點
│   ├── backgrounds.json        # 6 種出身背景
│   ├── tags.json               # 人物標籤定義
│   ├── staffRoles.json         # 團隊 6 職位定義
│   ├── nameGen.json            # 姓名生成字庫
│   ├── events/
│   │   ├── economy.json
│   │   ├── energy.json
│   │   ├── crossStrait.json
│   │   ├── diplomacy.json
│   │   ├── disaster.json
│   │   ├── society.json
│   │   ├── scandal.json
│   │   ├── party.json
│   │   ├── election.json
│   │   ├── media.json
│   │   ├── personal.json
│   │   └── world.json
│   └── interpellation/
│       ├── topics.json         # 質詢議題池
│       └── responses.json      # 答詢方應對模板
├── tests/
│   ├── economy.test.js
│   ├── pop.test.js
│   ├── election.test.js
│   ├── legislature.test.js
│   ├── save.test.js
│   └── balance.sim.js          # 長線模擬平衡檢測
└── tools/
    ├── validate-data.js        # 資料檔 schema 檢查（CI 用）
    └── balance-report.js       # 跑 100 局 AI 自動遊玩，輸出統計
```

---

## 3. 架構設計

### 3.1 分層

```
┌──────────────────────────────────────┐
│  UI 層  (src/ui)                      │  只讀 GameState，透過 Action 改變狀態
│  Router / Pages / Components / Charts │
└──────────────┬───────────────────────┘
               │ dispatch(action)  ▲ EventBus 通知重繪
               ▼                   │
┌──────────────────────────────────────┐
│  系統層 (src/systems)                 │  純函式為主，輸入 state → 輸出 patch
│  15 個 System，各自 tick(state)       │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  核心層 (src/core)                    │
│  GameState / TurnEngine / Rng /       │
│  Modifier / Formula / EventBus        │
└──────────────┬───────────────────────┘
               ▼
┌──────────────────────────────────────┐
│  資料層 (data/*.json + src/data)      │  唯讀，開局載入後不再變動
└──────────────────────────────────────┘
```

**鐵則**
1. UI 層絕不直接寫入 `GameState`，一律透過 `dispatch`
2. 系統層絕不觸碰 DOM
3. 所有隨機都走 `Rng`（帶 seed），確保存檔可重現、bug 可複製
4. 資料（`data/*.json`）與邏輯（`src/`）嚴格分離，平衡調校不改程式碼

### 3.2 回合排程器

```js
// src/core/TurnEngine.js
const PIPELINE = [
  WorldSystem.tick,
  EconomySystem.tick,
  CorporationSystem.tick,
  PopSystem.tick,
  ValueSystem.tick,
  PartySystem.tick,
  ScandalSystem.tick,
  EventSystem.generate,     // → 產出待決事項
  // ── 玩家行動階段（等待輸入）──
  LegislatureSystem.session,
  CouncilSystem.session,
  BudgetSystem.phase,
  ElectionSystem.phase,
  MediaSystem.tick,         // 民調與新聞在最後結算
];
```

每個 `tick(state, ctx)` 回傳 `{ patches, logs, events }`，由引擎統一套用，方便除錯與回放。

### 3.3 修正值堆疊（Modifier）

所有加成都不是直接改基礎值，而是壓入 modifier stack：

```js
state.modifiers.push({
  id: "law_labor_tier3",
  source: "LAW_LABOR_STANDARDS",
  target: "pop.bluecollar.solDelta",
  op: "add",           // add | mult | set
  value: +4,
  duration: -1,        // -1 = 永久（直到法案改變）
  startTurn: 42
});
```

好處：任何數值都能追溯來源，UI 上可以顯示「你的支持度 52%：基本盤 +38、經濟表現 +9、能源危機 −7、媒體 +12」。這是本專案除錯與玩家體驗的關鍵設計。

---

## 4. 資料檔規格

### 4.1 `meta.json`

```json
{
  "dataVersion": "0.1.0",
  "saveSchemaVersion": 1,
  "startDate": { "year": 2026, "month": 1 },
  "endDate": { "year": 2050, "month": 12 }
}
```

### 4.2 `regions.json`（22 筆）

依 GDD §6.1 的 `Region` 結構。所有數值以 2025 年公開統計為基底，允許 ±10% 的遊戲性調整。

**資料來源標註規則**：每個縣市物件加 `"_source"` 欄位註明原始資料來源與年份，方便日後更新（例：`"_source": "內政部戶政司 2025/12; 主計總處 2024 GDP"`）。

### 4.2b `districts.json`（195 筆）

195 個縣市議員選舉區，全國 913 席、人口 2330 萬。每筆含 `id`、`regionId`、`name`、`areas`、`seats`、`type`、`population`、`urbanity`(0–5)、`lean`(−5~+5)。不確定的欄位標 `_estimated: true`。立委選區由議員選區組合而成，對應表在 `elections.json`。

### 4.2c `scales.json`

四字語詞刻度總表，見 GDD 附錄 B。這個檔決定所有抽象數值怎麼被玩家看到——**改這個檔就能整批調整遊戲語氣**，不需要動程式。

### 4.3 `laws.json`（25 筆）

```json
{
  "id": "LAW_INCOME_TAX",
  "name": "所得稅法",
  "shortName": "綜所稅",
  "category": "fiscal",
  "committee": "財政",
  "defaultTier": 2,
  "controversy": 65,
  "tiers": [
    {
      "name": "大幅減稅",
      "desc": "最高級距降至 30%，免稅額提高 30%",
      "effects": {
        "central": { "revenueMult": -0.14 },
        "popSoL": { "whitecollar": 3, "techpro": 5, "capitalist": 8, "bluecollar": 1 },
        "national": { "giniDelta": 0.006 },
        "corpMood": { "_all": 8 },
        "valuePressure": { "marketFreedom": 1.2 }
      },
      "partyStance": { "PDA": -0.25, "CRP": 0.30, "TPL": 0.10, "NGF": -0.40 }
    }
  ]
}
```

`partyStance` 為 −1 ~ +1，直接進入表決機率計算。

### 4.4 `events/*.json`

依 GDD §17.1 格式。**必填欄位**：`id`、`category`、`trigger.condition`、`headline`、`options[≥2]`。

**條件式語法**：使用受限的表達式子集（僅比較、邏輯、屬性存取、`in` 運算），由 `EventSystem` 自建的小型求值器解析——**不使用 `eval`**，避免資安與效能問題。

```js
// 支援的語法範例
"central.energy.reserveMargin < 0.06 && month in [6,7,8]"
"region.economy.unemployment > 0.05 && region.id == 'KHH'"
"player.scandal > 60 || party.cohesion < 30"
```

### 4.5 `pops.json`

不直接列 1000+ 個 POP，而是存 **生成規則**：

```json
{
  "strata": [ { "id": "bluecollar", "name": "藍領勞工", "baseIssueWeights": {...}, "baseIdeology": {...} } ],
  "generations": [ { "id": "youth", "ageRange": [18,34], "ideologyShift": { "progressivism": 20 } } ],
  "identities": [ { "id": "localist", "ideologyShift": { "unification": -40 } } ],
  "regionDistribution": {
    "KHH": { "bluecollar": 0.22, "service": 0.24, "whitecollar": 0.18, "...": "..." }
  },
  "minPopSize": 3000
}
```

開局時由 `PopSystem.generate()` 展開為實際 POP 陣列。這讓資料檔維持在數十 KB 而非數 MB。

### 4.6 資料檔大小預算

| 檔案 | 目標大小 |
|---|---|
| `regions.json` | < 180 KB |
| `events/*.json` 全部 | < 400 KB |
| `laws.json` + `localBills.json` | < 120 KB |
| 其他全部 | < 150 KB |
| **總計（gzip 前）** | **< 900 KB** |

首次載入目標：4G 網路 3 秒內可開始遊戲。

---

## 5. 模組拆分與介面

### 5.1 System 統一介面

```js
/**
 * @typedef {Object} SystemResult
 * @property {Object[]} patches   狀態變更清單
 * @property {string[]} logs      除錯訊息
 * @property {Object[]} events    產生的事件
 */

/**
 * @param {GameState} state
 * @param {TurnContext} ctx  { turn, year, month, rng, data }
 * @returns {SystemResult}
 */
export function tick(state, ctx) { }
```

### 5.2 各系統職責與開發順序

| # | System | 依賴 | 複雜度 | 預估工時 |
|---|---|---|---|---|
| 1 | `Rng` / `Formula` / `Modifier` | — | 低 | 1 天 |
| 2 | `GameState` / `TurnEngine` / `EventBus` | 1 | 中 | 2 天 |
| 3 | `WorldSystem` | 2 | 低 | 2 天 |
| 4 | `EconomySystem` | 2,3 | **高** | 5 天 |
| 5 | `CorporationSystem` | 4 | 中 | 3 天 |
| 6 | `PopSystem` | 4 | **最高** | 7 天 |
| 7 | `ValueSystem` | 6 | 中 | 3 天 |
| 8 | `PartySystem` | 6 | 高 | 4 天 |
| 9 | `LegislatureSystem` | 7,8 | **高** | 5 天 |
| 10 | `CouncilSystem` | 9 | 中 | 3 天 |
| 11 | `BudgetSystem` | 4,9 | 高 | 4 天 |
| 12 | `ElectionSystem` | 6,8 | **高** | 6 天 |
| 13 | `InterpellationSystem` | 9,14 | 中 | 3 天 |
| 14 | `MediaSystem` | 6 | 中 | 3 天 |
| 15 | `EventSystem` | 全部 | 中 | 4 天 |
| 16 | `ScandalSystem` | 14 | 低 | 2 天 |
| 17 | `CharacterSystem` | 2 | 中 | 3 天 |
| 18 | `DistrictSystem` | 6 | 中 | 3 天 |
| 19 | `TeamSystem` | 17 | 中 | 3 天 |
| 20 | `FinanceSystem` | 17 | 中 | 3 天 |

**系統層小計約 69 個工作天**（單人、非全職口徑；實際依投入時間換算）。

### 5.3 UI 開發

| 項目 | 預估 |
|---|---|
| 渲染層 + Router + 主題 | 3 天 |
| 8 個主頁面 | 8 天 |
| 圖表元件（7 種） | 5 天 |
| 台灣 SVG 地圖 | 2 天 |
| 決策 Modal 與影響預告 | 3 天 |
| 響應式與手機優化 | 3 天 |
| **小計** | **24 天** |

---

## 6. 存檔系統與版本遷移

### 6.1 存檔格式

```js
{
  saveSchemaVersion: 1,
  dataVersion: "0.1.0",
  savedAt: "2026-08-27T10:00:00Z",
  slot: "auto" | 1 | 2 | 3,
  rngSeed: 1839472019,
  rngCounter: 48302,          // 保證從存檔繼續遊玩的隨機序列一致
  turn: 42,
  state: { /* 完整 GameState 深拷貝 */ },
  history: [ /* 壓縮的歷史指標時序，供圖表使用 */ ]
}
```

### 6.2 大小控制

完整 `GameState` 含 5850 個 POP，若用物件陣列約 12 MB JSON，用 SoA 扁平化後約 1.8 MB。localStorage 上限通常 5–10 MB。

**壓縮策略**
1. POP 一律以 SoA Float32Array 儲存，序列化時轉 base64 → 體積降 85%
2. 歷史時序只保留每年 12 筆的月資料 + 每年一筆的年摘要
3. 3 個手動存檔位 + 1 個自動存檔位，超過則提示玩家匯出後刪除
4. 若超過 4 MB，退回 **IndexedDB**（`SaveManager` 已預留抽象層）

### 6.3 版本遷移

```js
// src/save/migrations.js
export const migrations = {
  1: (save) => save,                       // 初版
  2: (save) => { /* 新增欄位補預設值 */ },
  // ...
};

export function migrate(save) {
  let s = save;
  for (let v = s.saveSchemaVersion; v < CURRENT_SCHEMA; v++) {
    s = migrations[v + 1](s);
    s.saveSchemaVersion = v + 1;
  }
  return s;
}
```

**原則**：每次改變 `GameState` 結構就 +1 版本並寫遷移函式。**永不破壞舊存檔** — 這是單機遊戲的信用底線。

---

## 7. 開發里程碑

### M0：專案骨架（第 1 週）

- [ ] 建立倉庫、目錄結構、`index.html`、CSS 主題
- [ ] `GameState` / `EventBus` / `Rng` / `Formula` / `Modifier`
- [ ] `TurnEngine` 空跑 12 回合不報錯
- [ ] `SaveManager` 存讀檔往返測試通過
- **驗收**：能按「下一回合」，日期從 2026/01 走到 2026/12

### M1：世界會呼吸（第 2–4 週）

- [ ] `data/regions.json` 22 縣市完整填寫
- [ ] `data/central.json`、`data/world.json` 15 區塊
- [ ] `WorldSystem` + `EconomySystem` + `CorporationSystem`
- [ ] 資料頁：中央儀表板 + 縣市列表 + 折線圖
- **驗收**：不做任何操作空跑 60 回合，各縣市 GDP、失業率、股市呈現合理趨勢，無 NaN、無爆值

### M2：人有立場（第 5–8 週）

- [ ] `DistrictSystem`：載入 195 選區、基層組織成長與衰退
- [ ] `PopSystem`：5850 個 POP 生成（SoA）、SoL、意識形態漂移、政黨支持度、熱情度
- [ ] `ValueSystem`：8 軸價值觀與修正表
- [ ] 資料頁：POP 階層卡片、8 軸滑桿視覺化
- **驗收**：空跑 120 回合，POP 支持度與 SoL 的變化能用經濟數據解釋；價值觀軸移動速率符合 GDD §20.5 目標值

### M3：政治機器（第 9–13 週）

- [ ] `PartySystem`：7 政黨 + 派系、cohesion、分裂合併
- [ ] `LegislatureSystem`：25 條法律、法案流程、表決模型
- [ ] `CouncilSystem`：15 條地方議案
- [ ] `BudgetSystem`：中央歲入歲出、地方財政、審查流程
- [ ] 政治頁：席次圖、法案清單、派系關係、預算編列 UI
- **驗收**：玩家可提案並通過一條法案，全國數值在後續 12 回合內出現可追溯的連鎖反應

### M4：玩家在場（第 14–17 週）

- [ ] `CharacterSystem`：建角、2 起點、6 背景、六屬性、標籤、汙名印象、AP=2、疲勞與過勞住院
- [ ] `TeamSystem`：6 職位槽、幕僚招募培養、忠誠與背叛
- [ ] `FinanceSystem`：私產、競選經費、政治獻金、財產申報
- [ ] `InterpellationSystem`：質詢攻防、承諾清單
- [ ] `ScandalSystem`：醜聞累積、調查鏈
- [ ] 個人頁、行動選單、決策 Modal + 影響預告
- **驗收**：從素人起點玩 24 回合，能明顯感受到角色成長與行動取捨

### M5：選舉（第 18–21 週）

- [ ] `ElectionSystem`：投票率與熱情度模型、得票模型（含 0.98~1.05 乘數）、SNTV 配票、初選
- [ ] 週回合模式：選前 2 個月自動切換為 1 週 1 回合
- [ ] 選舉頁：選情預測、對手分析、開票動畫
- **驗收**：完整跑完 2026 地方選舉與 2028 大選，結果分佈與各縣市政治底色相符（不能出現金門翻綠這種荒謬結果）

### M6：世界說話（第 22–25 週）

- [ ] `EventSystem` 條件求值器
- [ ] `MediaSystem`：媒體框架、議題熱度、民調房效應
- [ ] 事件庫 MVP 120 則（12 分類各 10 則）
- [ ] 首頁新聞流、史冊頁
- **驗收**：連玩 48 回合，事件不重複、與當下數值狀態相關、有明顯的敘事推進感

### M7：完整體驗（第 26–29 週）

- [ ] 台灣 SVG 地圖、雷達圖、堆疊條等剩餘圖表
- [ ] 結局與評分系統、12 種結局文本
- [ ] 教學提示卡、快速模式（委任幕僚）
- [ ] PWA：`manifest` + Service Worker 離線可玩
- [ ] 手機實機測試（iOS Safari + Android Chrome）
- **驗收**：一位沒看過文檔的朋友能在 10 分鐘內理解在玩什麼，並自主玩滿一屆任期

### M8：平衡與內容擴充（第 30–36 週）

- [ ] `tools/balance-report.js` 跑 100 局 AI 自動遊玩
- [ ] 依統計調整 `data/*.json`（不改程式碼）
- [ ] 事件庫擴充至 400 則
- [ ] 難度分級（輕鬆 / 標準 / 硬核）
- **驗收**：100 局統計中，5 種起點皆有 15%–60% 的「成功生涯」比例；無單一 dominant strategy

### M9：發布（第 37–38 週）

- [ ] `README` 與遊戲說明頁
- [ ] GitHub Pages 上線
- [ ] 版本標記 `v1.0.0`
- [ ] 蒐集回饋的 issue 模板

**總期程**：約 38 週（單人業餘投入口徑）。若全職投入約 12–16 週。

### 7.1 MVP 最短路徑（若想先做出能玩的東西）

若要在 **6 週內**產出可玩雛形，砍到只剩：
`M0` + `M1`（只做 6 個縣市）+ `M3` 的法案系統（只做 8 條法律）+ `M4` 的立委起點 + 30 則事件。
先驗證「調法案 → 數值變 → 民調變」的核心迴圈是否有趣，再擴充。

---

## 8. 效能預算

| 項目 | 預算 | 測試裝置基準 |
|---|---|---|
| 首次載入（含資料） | < 3 秒 | 中階 Android + 4G |
| 單回合完整結算 | < 120 ms | 中階 Android |
| POP 系統單回合（5850 POP） | < 70 ms | — |
| 頁面切換 | < 80 ms | — |
| 圖表渲染（單張） | < 30 ms | — |
| 存檔寫入 | < 200 ms | — |
| 記憶體佔用 | < 150 MB | — |

**優化手段**
- POP 以 SoA（Structure of Arrays）Float32Array 儲存，5850 × 約 40 欄，單回合為純數值迴圈
- 圖表資料做降採樣（超過 120 點時每 N 點取一）
- 頁面採虛擬捲動（縣市列表、事件史冊）
- 重運算結果快取，以 `turn` 為 key 失效
- Service Worker 快取所有靜態資源

---

## 9. 測試策略

### 9.1 單元測試（`node --test tests/`）

| 測試檔 | 覆蓋 |
|---|---|
| `economy.test.js` | GDP 成長公式、通膨、稅收在極端參數下不爆值 |
| `pop.test.js` | SoL 邊界、意識形態收斂速率、支持度 softmax 總和為 1 |
| `election.test.js` | 得票率總和 = 100%、SNTV 席次分配、5% 政黨門檻 |
| `legislature.test.js` | 表決機率邊界、法案流程狀態機無死鎖 |
| `save.test.js` | 存讀往返一致、各版本遷移正確 |
| `data.test.js` | 所有 JSON 通過 schema 驗證、id 唯一、交叉引用存在 |

### 9.2 模擬測試（`tests/balance.sim.js`）

固定 seed 跑 100 局完整生涯，輸出：
- 各起點的成功率分佈
- 常見的數值失控案例（GDP 暴衝、支持度鎖在 0 或 100）
- 事件觸發頻率統計（找出從不觸發或過度觸發的事件）
- 8 軸價值觀的終局分佈（檢查是否所有局都收斂到同一組值）

### 9.3 手動測試檢查表

每個里程碑結束時執行：
- [ ] iOS Safari 直式 / 橫式
- [ ] Android Chrome 直式 / 橫式
- [ ] 桌機 Chrome / Firefox
- [ ] 離線模式（關網後重新載入）
- [ ] 存檔匯出 → 清空 localStorage → 匯入 → 狀態完全一致
- [ ] 深色 / 淺色主題、3 種字級
- [ ] 快速連點「下一回合」20 次無狀態錯亂

---

## 10. GitHub Pages 部署

### 10.1 設定

1. 倉庫 Settings → Pages → Source 選 `Deploy from a branch` → `main` / `(root)`
2. 所有資源使用 **相對路徑**（`./data/regions.json`，不要用 `/data/...`），否則子路徑部署會 404
3. 新增 `.nojekyll` 空檔（避免 Jekyll 處理底線開頭的檔案）

### 10.2 CI（可選，`.github/workflows/check.yml`）

```yaml
name: check
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: node tools/validate-data.js     # JSON schema 與交叉引用檢查
      - run: node --test tests/
```

### 10.3 Service Worker 注意事項

`sw.js` 快取版本號必須隨每次發布遞增，否則玩家會卡在舊版：

```js
const CACHE = 'p-election-v1.0.0';   // 每次發布必改
```

並提供「檢查更新」按鈕，讓玩家在不清快取的情況下取得新版。

---

## 11. 程式碼規範

- **檔名**：System 與 Class 用 `PascalCase.js`，工具函式用 `camelCase.js`
- **變數**：`camelCase`；常數 `SCREAMING_SNAKE`；ID 字串 `SCREAMING_SNAKE`（如 `LAW_INCOME_TAX`）
- **註解語言**：繁體中文（本專案領域術語中文為主，混英文反而難讀）
- **型別**：檔案頂端加 `// @ts-check`，用 JSDoc 標註公開函式的參數與回傳
- **不可變性**：System 內部不直接修改 `state`，回傳 patch 由引擎套用
- **禁用**：`eval`、`with`、`innerHTML` 插入未跳脫的資料（用 `textContent` 或自建模板跳脫）
- **魔術數字**：所有平衡相關的數字必須進 `data/*.json` 或檔案頂端的 `CONST` 區塊，禁止散落在函式中
- **Commit**：`feat:` / `fix:` / `data:` / `balance:` / `docs:` / `refactor:` 前綴

---

## 12. 內容製作流程

### 12.1 事件撰寫規範

每則事件必須滿足：

1. **標題像新聞**：用該媒體的語氣，插值當下數值
2. **至少 2 個選項，且沒有明顯最優解**：每個選項都要有代價
3. **代價要在不同的維度**：不能是「A 選項好處 5 分、B 選項好處 3 分」
4. **非特殊情況下，禁止任何一個句子少於 7 個字**：句子以「。！？；」切分，扣除標點後計字，唯一例外是引號內的人物直接對白。`headline` 14–26 字、`body` 每句 ≥20 字、`hint` ≥12 字、`text` 8–20 字。由 `tools/validate_events.js` 自動檢查，違規則 CI 失敗
5. **不用真實人名與團體名**：一律用 `naming.json` 中的虛構名稱或程序生成的 NPC
6. **不做立場宣導**：同一議題的正反方都要有站得住腳的論述

### 12.2 事件撰寫模板

```json
{
  "id": "EVT_XXX",
  "category": "",
  "weight": 50,
  "cooldown": 12,
  "trigger": { "condition": "" },
  "requires": { "playerRole": ["legislator", "mayor"] },
  "headline": "",
  "body": "",
  "options": [
    { "text": "", "tooltip": "選這個大概會…", "effects": {}, "followUp": null }
  ],
  "_designNote": "設計意圖：測試玩家在 X 與 Y 之間的取捨"
}
```

### 12.3 資料調校流程

```
1. 跑 tools/balance-report.js
2. 讀 docs/BALANCE_LOG.md 上次調了什麼
3. 一次只改一組參數（避免無法歸因）
4. 重跑，比對統計差異
5. 記錄到 BALANCE_LOG.md：改了什麼、為什麼、結果如何
6. commit 前綴用 balance:
```

---

## 13. 風險清單

| # | 風險 | 機率 | 衝擊 | 緩解 |
|---|---|---|---|---|
| R1 | **範圍膨脹** — 系統太多做不完 | 高 | 高 | 嚴守 §7.1 MVP 路徑，M3 前不做任何新系統；每個里程碑結束時強制檢視待辦是否超出原計畫 20% |
| R2 | **POP 系統效能不足** — 1200 POP × 8 軸 × 每回合 | 中 | 高 | M2 一開始就用扁平化陣列實作，並在 M2 驗收前於實機手機測試 |
| R3 | **數值系統互相打架** — 改一個參數炸掉全局 | 高 | 中 | Modifier 堆疊系統讓所有變化可追溯；`balance.sim.js` 每次改動都跑 |
| R4 | **政治敏感導致爭議** | 中 | 中 | 嚴守虛構命名規範；所有路線都給予可行的勝利條件與真實代價；README 明確聲明為虛構模擬 |
| R5 | **存檔體積超過 localStorage 上限** | 中 | 中 | M0 就把 `SaveManager` 抽象化，預留 IndexedDB 後端 |
| R6 | **事件庫產能不足** — 400 則是巨大的寫作量 | 高 | 中 | 用參數化模板（一個模板 × N 個縣市 / 產業 = N 則事件）；事件與 UI 分離，可在發布後持續補 |
| R7 | **手機瀏覽器相容性** | 低 | 中 | 只用 baseline 已支援的 API；避免 `structuredClone` 之外的新特性；每個里程碑做實機測試 |
| R8 | **平衡調到最後只有一種玩法有效** | 中 | 高 | `balance-report.js` 明確檢測 dominant strategy；M8 專門處理 |
| R9 | **資料正確性** — 22 縣市數值來源錯誤 | 中 | 低 | 每筆資料標 `_source`；README 聲明數值為遊戲化改編，非官方統計 |
| R10 | **獨力開發動能中斷** | 中 | 高 | 每個里程碑都產出「可玩的東西」而非半成品；M1 結束就能看到世界在動 |

---

## 14. 驗收標準

### 14.1 v1.0 發布門檻

**功能**
- [ ] 5 種開局起點皆可完整遊玩到生涯結束
- [ ] 22 縣市 + 中央 + 15 世界區塊數值系統全部運作
- [ ] 25 條中央法律 + 15 條地方議案皆可修改且有可觀測影響
- [ ] 質詢、預算、派系、價值觀、POP 五大系統完整
- [ ] 玩家系統完整：六屬性、標籤、汙名印象、團隊、三帳戶財務、政治獻金、過勞住院
- [ ] 195 選區與基層組織系統運作，選舉可下沉到選區層級
- [ ] 種子系統：同一種子重開，世界完全一致
- [ ] 至少完成 2 次總統大選 + 2 次地方選舉的完整循環
- [ ] 事件庫 ≥ 400 則
- [ ] 12 種結局文本

**品質**
- [ ] 所有抽象數值皆以四字語詞呈現，介面上找不到裸露的 0–5 數字
- [ ] 事件文本 100% 通過句長檢查（0 個少於 7 字的句子）
- [ ] 所有單元測試通過
- [ ] `balance.sim.js` 100 局無 NaN、無數值鎖死
- [ ] 效能達 §8 全部指標
- [ ] iOS Safari 與 Android Chrome 實機通過檢查表
- [ ] 離線可玩（PWA）
- [ ] 存檔遷移測試通過（v1 → 當前版本）

**內容**
- [ ] 零真實人名、政黨名、企業名、媒體名
- [ ] 所有意識形態路線皆有可行勝利路徑（`balance-report` 驗證）
- [ ] README 含玩法說明與免責聲明

### 14.2 「這個遊戲成功了」的主觀判準

玩家在玩完第一局後，會想開第二局並說出這句話：

> 「這次我要試試看，如果我一開始就不跟地方派系合作，會怎樣。」

如果玩家只覺得「我把數字調到最高了」，那就是平衡失敗，不是遊戲完成。

---

## 附錄 A：第一週具體任務清單

| 天 | 任務 | 產出 |
|---|---|---|
| D1 | 建 repo、目錄結構、`index.html`、`theme.css` | 空白頁面能載入並顯示標題 |
| D2 | `Rng.js`（xorshift128 + seed）、`Formula.js` | 單元測試通過，同 seed 產出相同序列 |
| D3 | `GameState.js`、`EventBus.js` | 狀態初始化、訂閱與通知可用 |
| D4 | `Modifier.js` | 修正堆疊套用與過期清除測試通過 |
| D5 | `TurnEngine.js` + 空的 15 個 System stub | 按鈕點擊可推進回合，日期正確遞增 |
| D6 | `SaveManager.js` + localStorage | 存讀往返一致 |
| D7 | `data/meta.json`、`loader.js`、`validate-data.js` | 載入流程完成，資料驗證工具可跑 |

---

## 附錄 B：資料填寫優先序

先做這 6 個檔就能進入 M1 驗收：

1. `meta.json`（10 分鐘）
2. `naming.json`（1 小時）
3. `world.json` — 15 區塊（2 小時）
4. `central.json`（2 小時）
5. `regions.json` — 22 縣市（**8–12 小時，最耗時**）
6. `corporations.json` — 15 家企業（2 小時）

建議 `regions.json` 分兩批：先做 6 個縣市（北北桃中南高）驗證結構，確認無誤再補齊其餘 16 個。

---

**文檔結束**
