export const SAVE_KEY = "ibt_save_v6";

export const PRICES = {
  wood: 10,
  stone: 16,
};

export const GOLD_VALUE = 120;

export const BOT_SPEED = 85; // px/s
export const BOT_CARRY = 2;
export const HARVEST_SECONDS = 0.85;

export const BOT_MAX = 35;
export const BOT_BASE_COST = 420;
export const BOT_COST_GROWTH = 1.20;

export const SHIP_CAPACITY_BY_LEVEL = [0, 10, 15, 23, 30, 40, 55, 75, 90, 110, 140];
export const SHIP_CAPACITY_COST = [0, 0, 1000, 2000, 5000, 20000, 50000, 100000, 130000, 180000, 250000];
export const SHIP_CAPACITY_RES = [0, 0, 50, 90, 180, 400, 800, 1500, 1700, 2200, 3000];
export const SHIP_BUY_COST = [0, 1000, 3500, 10000, 25000, 40000, 65000];
export const SHIP_BUY_RES = [0, 50, 90, 180, 400, 800, 1500];
export const SHIP_LOAD_SECONDS_PER_UNIT = 0.25;
export const SHIP_CYCLE_SECONDS_MIN = 70;
export const SHIP_CYCLE_SECONDS_MAX = 70;

export const GEM_CHANCE_ON_RETURN = 0.07;

export const MINE_UNLOCK_COST_GEMS = 5;
export const MINE_MIN_BOTS = 5;
export const MINE_MAX_BOTS = 10;
export const MINE_GOLD_PER_HOUR_PER_BOT = 2;
export const MINE_TEST_HOUR_SECONDS = 60; // faster test timing (1 "hour" = 60s)
export const EFFICIENCY_BASE = 2;
export const EFFICIENCY_BOOST = 4;
export const EFFICIENCY_BOOST_COST_GEMS = 2;
export const EFFICIENCY_BOOST_SECONDS = 60;

export const ACHIEVEMENTS = [
  { id: "first_ship", title: "First Ship", desc: "Complete your first ship trip." },
  { id: "three_ships", title: "3 Ship Trips", desc: "Complete three ship trips. (Future-ready)" },
  { id: "money_1000", title: "First $1,000", desc: "Reach $1,000 money." },
  { id: "bots_10", title: "10 Bots", desc: "Hire 10 bots." },
  { id: "bots_25", title: "25 Bots", desc: "Hire 25 bots." },
  { id: "bots_35", title: "35 Bots", desc: "Max out bots." },
  { id: "first_gem", title: "First Gem", desc: "Find your first gem." },
  { id: "unlock_mine", title: "Gold Mine", desc: "Unlock the gold mine." },
];

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function normalize(vx, vy) {
  const d = Math.hypot(vx, vy);
  if (d < 1e-6) return { x: 0, y: 0 };
  return { x: vx / d, y: vy / d };
}

export function nowMs() {
  return performance.now();
}

export function formatMoney(amount) {
  const v = Math.floor(amount);
  return `$${v.toLocaleString()}`;
}

export function formatTimer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export class Sound {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._last = new Map();
  }
  _getCtx() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._ctx = new Ctx();
    return this._ctx;
  }
  _throttle(key, ms) {
    const t = performance.now();
    const last = this._last.get(key) || 0;
    if (t - last < ms) return false;
    this._last.set(key, t);
    return true;
  }
  beep(kind) {
    if (!this.enabled) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    if (!this._throttle(kind, 120)) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    if (kind === "horn") {
      o.type = "sawtooth";
      o.frequency.value = 110;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.start(t);
      o.stop(t + 1.1);
      return;
    }
    o.type = "sine";
    const base = kind === "collect" ? 740 : kind === "ship" ? 220 : 880;
    o.frequency.value = base;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.start(t);
    o.stop(t + 0.14);
  }
}

export class Toasts {
  constructor(el) {
    this.el = el;
  }
  show(title, desc) {
    const t = document.createElement("div");
    t.className = "toast toast--good";
    const tt = document.createElement("div");
    tt.className = "toast__title";
    tt.textContent = title;
    const dd = document.createElement("div");
    dd.className = "toast__desc";
    dd.textContent = desc;
    t.append(tt, dd);
    this.el.append(t);
    setTimeout(() => t.remove(), 3800);
  }
}

export class AchievementSystem {
  constructor(toasts, sound) {
    this.toasts = toasts;
    this.sound = sound;
    this.unlocked = new Set();
  }
  load(list) {
    if (!Array.isArray(list)) return;
    for (const id of list) this.unlocked.add(id);
  }
  export() {
    return [...this.unlocked];
  }
  unlock(id) {
    if (this.unlocked.has(id)) return false;
    const meta = ACHIEVEMENTS.find((a) => a.id === id);
    if (!meta) return false;
    this.unlocked.add(id);
    this.toasts.show(`🏆 ${meta.title}`, meta.desc);
    this.sound.beep("ach");
    return true;
  }
}

export class ResourceNode {
  constructor(id, type, x, y) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.radius = 14;
    this.amount = 4;
  }
}

export class Port {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 22;
  }
}

export class Bot {
  constructor(id, x, y, rng) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.rng = rng;
    this.state = "SEEK";
    this.targetNodeId = null;
    this.inventoryWood = 0;
    this.inventoryStone = 0;
    this.harvestTimer = 0;
    this.preferred = rng() < 0.5 ? "wood" : "stone";
  }
  inventoryCount() {
    return this.inventoryWood + this.inventoryStone;
  }
  snapshotPrev() {
    this.prevX = this.x;
    this.prevY = this.y;
  }
}

export class Ship {
  constructor(capacity, rng) {
    this.capacity = capacity;
    this.loadWood = 0;
    this.loadStone = 0;
    this.state = "Loading";
    this.timer = 0;
    this.halfTripSeconds = 35;
    this._loadCooldown = 0;
    this._rng = rng;
  }
  currentLoad() { return this.loadWood + this.loadStone; }
  isFull() { return this.currentLoad() >= this.capacity; }
  startTrip(game) {
    this.state = "Departing";
    this.timer = 1.0;
    if (game) game.sound.beep("horn");
  }
  update(dt, game) {
    if (this.state === "Departing") {
      this.timer -= dt;
      if (this.timer <= 0) {
        const full = lerp(SHIP_CYCLE_SECONDS_MIN, SHIP_CYCLE_SECONDS_MAX, this._rng());
        this.halfTripSeconds = full / 2;
        this.state = "Traveling";
        this.timer = this.halfTripSeconds;
      }
      return;
    }
    if (this.state === "Traveling" || this.state === "Returning") {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.state === "Traveling") {
        this.state = "Returning";
        this.timer = this.halfTripSeconds;
        return;
      }
      const moneyGained = this.loadWood * PRICES.wood + this.loadStone * PRICES.stone;
      game.money += moneyGained;
      game.soldUnits += this.currentLoad();
      game.shipTrips += 1;
      game.visual.addFloater(`+$${moneyGained}`, '#4ade80', game.port.x, 60, game.port.y);
      if (game.shipTrips === 1) game.ach.unlock("first_ship");
      if (game.shipTrips === 3) game.ach.unlock("three_ships");
      if (this._rng() < GEM_CHANCE_ON_RETURN) {
        game.gems += 1;
        game.ach.unlock("first_gem");
      }
      this.loadWood = 0;
      this.loadStone = 0;
      this.state = "Loading";
      this.timer = 0;
      return;
    }
    const availableW = game.shipFilterWood ? game.portStorage.wood : 0;
    const availableS = game.shipFilterStone ? game.portStorage.stone : 0;
    const available = availableW + availableS;
    if (available <= 0) {
      this.state = "Waiting";
      this._loadCooldown = 0;
      return;
    }
    if (this.isFull()) {
      this.startTrip(game);
      return;
    }
    this.state = "Loading";
    this._loadCooldown -= dt;
    if (this._loadCooldown > 0) return;
    this._loadCooldown = SHIP_LOAD_SECONDS_PER_UNIT;
    
    const takeW = game.shipFilterWood && game.portStorage.wood > 0;
    const takeS = game.shipFilterStone && game.portStorage.stone > 0;
    if (takeW && takeS) {
      // Alternate evenly
      if (this.loadWood <= this.loadStone) {
        game.portStorage.wood -= 1;
        this.loadWood += 1;
      } else {
        game.portStorage.stone -= 1;
        this.loadStone += 1;
      }
    } else if (takeW) {
      game.portStorage.wood -= 1;
      this.loadWood += 1;
    } else if (takeS) {
      game.portStorage.stone -= 1;
      this.loadStone += 1;
    }
    if (this.isFull()) {
      this.startTrip(game);
    }
  }
}
