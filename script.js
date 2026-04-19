import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

(() => {
  "use strict";

  window.__IBT_BOOTED = true;

  const SAVE_KEY = "ibt_save_v6";

  const PRICES = {
    wood: 5,
    stone: 12,
  };

  const GOLD_VALUE = 120;

  const BOT_SPEED = 86; // px/s
  const BOT_CARRY = 2;
  const HARVEST_SECONDS = 0.85;

  const BOT_MAX = 35;
  const BOT_BASE_COST = 500;
  const BOT_COST_GROWTH = 1.20;

  const SHIP_CAPACITY_BY_LEVEL = [0, 10, 15, 22, 30, 40, 55, 75];
  const SHIP_CAPACITY_COST = [0, 0, 2000, 6000, 12000, 25000, 50000, 100000];
  const SHIP_BUY_COST = [0, 5000, 9000, 15000, 25000, 40000, 65000];
  const SHIP_LOAD_SECONDS_PER_UNIT = 0.25;
  const SHIP_CYCLE_SECONDS_MIN = 70;
  const SHIP_CYCLE_SECONDS_MAX = 70;

  const GEM_CHANCE_ON_RETURN = 0.02;

  const MINE_UNLOCK_COST_GEMS = 10;
  const MINE_MIN_BOTS = 5;
  const MINE_MAX_BOTS = 10;
  const MINE_GOLD_PER_HOUR_PER_BOT = 2;
  const MINE_TEST_HOUR_SECONDS = 60; // faster test timing (1 "hour" = 60s)
  const EFFICIENCY_BASE = 2;
  const EFFICIENCY_BOOST = 4;
  const EFFICIENCY_BOOST_COST_GEMS = 2;
  const EFFICIENCY_BOOST_SECONDS = 60;

  const MODEL_PATHS = {
    bot: "assets/models/worker.glb",
    tree: "assets/models/tree.glb",
    stone: "assets/models/stone.glb",
    ship: "assets/models/ship.glb",
    boat: "assets/models/boat.glb",
  };

  const ACHIEVEMENTS = [
    { id: "first_ship", title: "First Ship", desc: "Complete your first ship trip." },
    { id: "three_ships", title: "3 Ship Trips", desc: "Complete three ship trips. (Future-ready)" },
    { id: "money_1000", title: "First $1,000", desc: "Reach $1,000 money." },
    { id: "bots_10", title: "10 Bots", desc: "Hire 10 bots." },
    { id: "bots_25", title: "25 Bots", desc: "Hire 25 bots." },
    { id: "bots_35", title: "35 Bots", desc: "Max out bots." },
    { id: "first_gem", title: "First Gem", desc: "Find your first gem." },
    { id: "unlock_mine", title: "Gold Mine", desc: "Unlock the gold mine." },
  ];

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function normalize(vx, vy) {
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return { x: 0, y: 0 };
    return { x: vx / d, y: vy / d };
  }

  function nowMs() {
    return performance.now();
  }

  function formatMoney(amount) {
    const v = Math.floor(amount);
    return `$${v.toLocaleString()}`;
  }

  function formatTimer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function encodePath(p) {
    return encodeURI(p);
  }

  function safeClone(obj) {
    try {
      return SkeletonUtils.clone(obj);
    } catch {
      return obj.clone(true);
    }
  }

  class Sound {
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

  class Toasts {
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

  class AchievementSystem {
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

  class ResourceNode {
    constructor(id, type, x, y) {
      this.id = id;
      this.type = type; // "wood" | "stone"
      this.x = x;
      this.y = y;
      this.radius = 14;
      this.amount = 4;
    }
  }

  class Port {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.radius = 22;
    }
  }

  class Bot {
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

  class Ship {
    constructor(capacity, rng) {
      this.capacity = capacity;
      this.loadWood = 0;
      this.loadStone = 0;
      this.state = "Loading"; // "Waiting" | "Loading" | "Traveling" | "Returning"
      this.timer = 0;
      this.halfTripSeconds = 35;
      this._loadCooldown = 0;
      this._rng = rng;
    }

    currentLoad() {
      return this.loadWood + this.loadStone;
    }

    isFull() {
      return this.currentLoad() >= this.capacity;
    }

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

        // Arrived back at port -> sell
        const moneyGained = this.loadWood * PRICES.wood + this.loadStone * PRICES.stone;
        game.money += moneyGained;
        game.soldUnits += this.currentLoad();
        game.shipTrips += 1;
        game.visual.addFloater(`+$${moneyGained}`, '#4ade80', game.port.x, 60, game.port.y);

        if (game.shipTrips === 1) game.ach.unlock("first_ship");
        if (game.shipTrips === 3) game.ach.unlock("three_ships");

        // Gems: small random chance on return
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

      const available = game.portStorage.wood + game.portStorage.stone;
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

      if (game.portStorage.wood > 0) {
        game.portStorage.wood -= 1;
        this.loadWood += 1;
      } else if (game.portStorage.stone > 0) {
        game.portStorage.stone -= 1;
        this.loadStone += 1;
      }

      if (this.isFull()) {
        this.startTrip(game);
      }
    }
  }

  class Visual3D {
    constructor(containerEl, worldWidth, worldHeight, rng) {
      this.containerEl = containerEl;
      this.worldWidth = worldWidth;
      this.worldHeight = worldHeight;
      this.rng = rng;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog = new THREE.Fog(0x38bdf8, 600, 1300);

      this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 4000);
      this.camera.position.set(worldWidth / 2, 820, worldHeight / 2 + 360);
      this.camera.lookAt(worldWidth / 2, 0, worldHeight / 2);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.containerEl.appendChild(this.renderer.domElement);

      this.models = {
        bot: null,
        tree: null,
        stone: null,
        ship: null,
      };

      this.botObjects = new Map();
      this.nodeObjects = new Map();
      this.shipObject = null;
      this.portObject = null;
      this.floaters = [];
      this.portBounce = 0;
      this.boatObjects = [];

      this._initLights();
      this._initGround();
      this._initPort();
      this._initShip();
      this._resizeToContainer();

      window.addEventListener("resize", () => this._resizeToContainer());
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => this._resizeToContainer());
        ro.observe(this.containerEl);
      }

      this._loadModels();
    }

    _initLights() {
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      this.scene.add(ambient);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
      this.scene.add(hemi);

      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(350, 900, 300);
      this.scene.add(dir);
    }

    _initGround() {
      this.tileSize = 40;
      this.cols = Math.ceil((this.worldWidth + 1000) / this.tileSize);
      this.rows = Math.ceil((this.worldHeight + 1000) / this.tileSize);
      this.offsetX = -500;
      this.offsetZ = -500;

      const geometry = new THREE.BoxGeometry(this.tileSize - 2, 4, this.tileSize - 2);
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
      this.groundMesh = new THREE.InstancedMesh(geometry, material, this.cols * this.rows);

      const dummy = new THREE.Object3D();
      let i = 0;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tx = this.offsetX + c * this.tileSize;
          const tz = this.offsetZ + r * this.tileSize;
          dummy.position.set(tx + this.tileSize / 2, -2, tz + this.tileSize / 2);
          dummy.updateMatrix();
          this.groundMesh.setMatrixAt(i, dummy.matrix);
          i++;
        }
      }
      this.scene.add(this.groundMesh);
    }

    _initPort() {
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(22, 22, 10, 32),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.1 })
      );
      platform.position.set(this.worldWidth / 2, 5, this.worldHeight / 2);
      this.scene.add(platform);
      this.portObject = platform;
    }

    _initShip() {
      this.shipObjects = [];
      for (let i = 0; i < 7; i++) {
        const placeholder = new THREE.Mesh(
          new THREE.BoxGeometry(46, 16, 22),
          new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.35, metalness: 0.1 })
        );
        placeholder.position.set(this.worldWidth / 2 + 60 + i * 55, 120, this.worldHeight / 2 + 18);
        this.scene.add(placeholder);
        this.shipObjects.push(placeholder);
      }
    }

    addFloater(text, color, x, y, z) {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.position = "absolute";
      el.style.color = color;
      el.style.fontWeight = "bold";
      el.style.fontSize = "22px";
      el.style.textShadow = "1px 1px 2px #000, -1px -1px 2px #000";
      el.style.pointerEvents = "none";
      el.style.zIndex = "100";
      document.body.appendChild(el);
      this.floaters.push({ el, pos: new THREE.Vector3(x, y, z), life: 1.5 });
    }

    triggerPortBounce() {
      this.portBounce = 1.0;
    }

    _resizeToContainer() {
      const rect = this.containerEl.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    _applyMaterialFixups(root, tintHex) {
      const tint = new THREE.Color(tintHex);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        const hasVertexColors = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.color);
        for (const m of materials) {
          if (!m) continue;

          // Remove the dummy texture intercept so it doesn't render models in solid black
          if (m.map) m.map = null;

          if (hasVertexColors) {
            m.vertexColors = true;
            if (m.color) m.color.set(0xffffff);
          } else if (m.color) {
            // Many Kenney models are untextured; give a readable tint.
            m.color.copy(tint);
          }
          
          if (typeof m.metalness === "number") m.metalness = Math.min(m.metalness, 0.2);
          if (typeof m.roughness === "number") m.roughness = Math.max(m.roughness, 0.7);
          m.needsUpdate = true;
        }
      });
    }

    _buildInstance(base, targetHeight, tintHex) {
      const obj = safeClone(base);
      this._applyMaterialFixups(obj, tintHex);

      // Scale to a consistent height.
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 1e-6) {
        const s = targetHeight / size.y;
        obj.scale.multiplyScalar(s);
      }

      // Pivot: keep world-position separate from centering/grounding so we don't overwrite it later.
      const box2 = new THREE.Box3().setFromObject(obj);
      const center = new THREE.Vector3();
      box2.getCenter(center);
      const pivot = new THREE.Group();
      obj.position.set(-center.x, -box2.min.y, -center.z);
      pivot.add(obj);
      return pivot;
    }

    async _loadModels() {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (url.endsWith('colormap.png')) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        return url;
      });
      const gltfLoader = new GLTFLoader(manager);
      // Keep "appropriate loaders" available as future fallback.
      // eslint-disable-next-line no-unused-vars
      const fbxLoader = new FBXLoader();
      // eslint-disable-next-line no-unused-vars
      const objLoader = new OBJLoader();

      const loadGLB = async (path) => {
        const url = encodePath(path);
        const gltf = await gltfLoader.loadAsync(url);
        return gltf.scene;
      };

      const safeLoad = async (key, path) => {
        try {
          const scene = await loadGLB(path);
          scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = false;
              o.receiveShadow = false;
            }
          });
          this.models[key] = scene;
        } catch (err) {
          console.warn("Failed to load model:", key, path, err);
          this.models[key] = null;
        }
      };

      await Promise.all([
        safeLoad("bot", MODEL_PATHS.bot),
        safeLoad("tree", MODEL_PATHS.tree),
        safeLoad("stone", MODEL_PATHS.stone),
        safeLoad("ship", MODEL_PATHS.ship),
        safeLoad("boat", MODEL_PATHS.boat),
      ]);

      if (this.models.bot) this._applyMaterialFixups(this.models.bot, 0x3b82f6);
      if (this.models.tree) this._applyMaterialFixups(this.models.tree, 0x22c55e);
      if (this.models.stone) this._applyMaterialFixups(this.models.stone, 0x94a3b8);
      if (this.models.ship) this._applyMaterialFixups(this.models.ship, 0xf87171);
      if (this.models.boat) this._applyMaterialFixups(this.models.boat, 0x8b5a2b);

      if (this.models.ship) {
        for (let i = 0; i < 7; i++) {
          const old = this.shipObjects[i];
          const shipPivot = this._buildInstance(this.models.ship, 45, 0xf87171);
          shipPivot.rotation.y = Math.PI / 2;
          if (old) {
            shipPivot.position.copy(old.position);
            this.scene.remove(old);
          }
          this.scene.add(shipPivot);
          this.shipObjects[i] = shipPivot;
          this.shipObjects[i].visible = false;
        }
      }
    }

    _makeBotObject() {
      const group = new THREE.Group();
      if (this.models.bot) {
        group.add(this._buildInstance(this.models.bot, 36, 0xffffff));
      } else {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(8, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.7 })
        );
        m.position.y = 8;
        group.add(m);
      }
      const carry = new THREE.Mesh(
        new THREE.BoxGeometry(8, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
      );
      carry.position.set(0, 42, 0);
      carry.visible = false;
      group.carryObject = carry;
      group.add(carry);
      return group;
    }

    _makeNodeObject(type) {
      const model = type === "wood" ? this.models.tree : this.models.stone;
      if (model) {
        const tint = type === "wood" ? 0x22c55e : 0x94a3b8;
        const obj = this._buildInstance(model, type === "wood" ? 90 : 40, tint);
        obj.rotation.y = this.rng() * Math.PI * 2;
        return obj;
      }
      const color = type === "wood" ? 0x22c55e : 0x94a3b8;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(12, 16, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
      );
      m.position.y = 10;
      return m;
    }

    ensureBot(bot) {
      if (this.botObjects.has(bot.id)) return;
      const obj = this._makeBotObject();
      obj.position.set(bot.x, 0, bot.y);
      this.scene.add(obj);
      this.botObjects.set(bot.id, obj);
    }

    ensureNode(node) {
      if (this.nodeObjects.has(node.id)) return;
      const obj = this._makeNodeObject(node.type);
      obj.position.set(node.x, 0, node.y);
      this.scene.add(obj);
      this.nodeObjects.set(node.id, obj);
    }

    removeBotsAbove(maxId) {
      for (const [id, obj] of this.botObjects.entries()) {
        if (id <= maxId) continue;
        this.scene.remove(obj);
        this.botObjects.delete(id);
      }
    }

    update(dt) {
      if (this.portBounce > 0) {
        this.portBounce -= dt * 4;
        const s = 1 + Math.sin(Math.max(0, this.portBounce) * Math.PI) * 0.25;
        this.portObject.scale.set(s, s, s);
      } else {
        this.portObject.scale.set(1, 1, 1);
      }

      const rect = this.containerEl.getBoundingClientRect();
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const f = this.floaters[i];
        f.life -= dt;
        if (f.life <= 0) {
          f.el.remove();
          this.floaters.splice(i, 1);
          continue;
        }
        f.pos.y += 40 * dt;
        const vec = f.pos.clone().project(this.camera);
        const x = (vec.x * 0.5 + 0.5) * rect.width + window.scrollX + rect.left;
        const y = (vec.y * -0.5 + 0.5) * rect.height + window.scrollY + rect.top;
        f.el.style.left = `${x}px`;
        f.el.style.top = `${y}px`;
        f.el.style.opacity = Math.min(1, f.life).toString();
        f.el.style.transform = `translate(-50%, -50%) scale(${1 + (1.5 - f.life) * 0.2})`;
      }
    }

    syncCargo(ship, shipObj) {
      if (!shipObj) return;
      if (!shipObj.cargoGroup) {
        shipObj.cargoGroup = new THREE.Group();
        shipObj.cargoGroup.position.set(0, 10, 0);
        shipObj.add(shipObj.cargoGroup);
        shipObj.cargoBoxes = [];
      }
      const target = ship.currentLoad();
      while (shipObj.cargoBoxes.length < target) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(4, 4, 4),
          new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 })
        );
        const i = shipObj.cargoBoxes.length;
        const x = (i % 3) * 5 - 5;
        const z = (Math.floor(i / 3) % 4) * 5 - 7.5;
        const y = Math.floor(i / 12) * 5;
        m.position.set(x, y, z);
        shipObj.cargoGroup.add(m);
        shipObj.cargoBoxes.push(m);
      }
      while (shipObj.cargoBoxes.length > target) {
        const m = shipObj.cargoBoxes.pop();
        shipObj.cargoGroup.remove(m);
      }
      let woodCount = ship.loadWood;
      for (let i = 0; i < shipObj.cargoBoxes.length; i++) {
        shipObj.cargoBoxes[i].material.color.setHex(i < woodCount ? 0x8b5a2b : 0x94a3b8);
      }
    }

    _syncGround(game) {
      let hash = `${game.port.x},${game.port.y},${game.shipCount}`;
      for (let s = 0; s < game.shipCount; s++) {
        const b = game._shipBerthPosition(s);
        hash += `,${Math.floor(b.x)},${Math.floor(b.y)}`;
      }
      if (this._lastGroundHash === hash) return;
      this._lastGroundHash = hash;

      const color = new THREE.Color();
      let i = 0;

      let maxBerthX = game.port.x;
      for (let s = 0; s < game.shipCount; s++) {
        maxBerthX = Math.max(maxBerthX, game._shipBerthPosition(s).x);
      }

      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tx = this.offsetX + c * this.tileSize + this.tileSize / 2;
          const tz = this.offsetZ + r * this.tileSize + this.tileSize / 2;
          
          let isRoad = false;
          
          if (tx >= game.port.x - 20 && tx <= maxBerthX + 20 && Math.abs(tz - game.port.y) < 25) isRoad = true;
          
          for (let s = 0; s < game.shipCount; s++) {
            const berth = game._shipBerthPosition(s);
            if (Math.abs(tx - berth.x) < 25 && tz >= Math.min(game.port.y, berth.y) - 25 && tz <= Math.max(game.port.y, berth.y) + 25) isRoad = true;
            if (Math.hypot(tx - berth.x, tz - berth.y) < 40) isRoad = true;
          }
          
          if (Math.hypot(tx - game.port.x, tz - game.port.y) < 55) isRoad = true;

          if (isRoad) color.setHex((r + c) % 2 === 0 ? 0x94a3b8 : 0x64748b);
          else color.setHex((r + c) % 2 === 0 ? 0x166534 : 0x14532d);
          
          this.groundMesh.setColorAt(i, color);
          i++;
        }
      }
      if (this.groundMesh.instanceColor) this.groundMesh.instanceColor.needsUpdate = true;
    }

    sync(game, alpha) {
      this._syncGround(game);
      this.portObject.position.set(game.port.x, 5, game.port.y);

      for (const bot of game.bots) {
        this.ensureBot(bot);
        const obj = this.botObjects.get(bot.id);
        obj.position.x = lerp(bot.prevX, bot.x, alpha);
        obj.position.z = lerp(bot.prevY, bot.y, alpha);
        obj.position.y = 0;
        
        if (bot.inventoryCount() > 0) {
          obj.carryObject.visible = true;
          obj.carryObject.material.color.setHex(bot.inventoryWood > 0 ? 0x8b5a2b : 0x94a3b8);
          obj.carryObject.position.y = 42 + Math.sin(nowMs() / 150) * 2;
        } else {
          obj.carryObject.visible = false;
        }
      }
      this.removeBotsAbove(game.bots.length);

      for (const n of game.nodes) {
        this.ensureNode(n);
        const obj = this.nodeObjects.get(n.id);
        if (obj) {
          obj.position.set(n.x, 0, n.y);
          const s = 0.5 + (Math.max(0, n.amount) / 4) * 0.5;
          obj.scale.set(s, s, s);
        }
      }

      for (let i = 0; i < 7; i++) {
        const shipObj = this.shipObjects[i];
        if (i < game.ships.length) {
          const ship = game.ships[i];
          shipObj.visible = true;
          const ship2d = game._shipDrawPosition(ship, i);
          const shipHeight = ship.state === "Traveling" || ship.state === "Returning" ? 200 : (ship.state === "Departing" ? 120 + Math.sin(nowMs() / 50) * 1.5 : 120);
          shipObj.position.set(ship2d.x, shipHeight, ship2d.y);
          this.syncCargo(ship, shipObj);
        } else {
          shipObj.visible = false;
        }
      }

      while (this.boatObjects.length < game.deliveries.length) {
        const m = this.models.boat ? this._buildInstance(this.models.boat, 25, 0x8b5a2b) : new THREE.Mesh(new THREE.BoxGeometry(20, 10, 30), new THREE.MeshStandardMaterial({color:0x8b5a2b}));
        this.scene.add(m);
        this.boatObjects.push(m);
      }

      for (let i = 0; i < this.boatObjects.length; i++) {
        const obj = this.boatObjects[i];
        if (i < game.deliveries.length) {
          const d = game.deliveries[i];
          obj.visible = true;
          const start = { x: -80, y: -80 }; // Water corner
          const port = { x: game.port.x, y: game.port.y };
          const progress = clamp(d.t / 2.0, 0, 1);
          const pos = d.phase === 'IN' ? { x: lerp(start.x, port.x, progress), y: lerp(start.y, port.y, progress) } : { x: lerp(port.x, start.x, progress), y: lerp(port.y, start.y, progress) };
          
          obj.position.set(pos.x, Math.sin(d.t * Math.PI * 4) * 2, pos.y);
          obj.lookAt(d.phase === 'IN' ? port.x : start.x, obj.position.y, d.phase === 'IN' ? port.y : start.y);
        } else {
          obj.visible = false;
        }
      }
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }

    pickWorldPoint(clientX, clientY) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(plane, hit);
      if (!ok) return null;
      return {
        x: clamp(hit.x, 0, this.worldWidth),
        y: clamp(hit.z, 0, this.worldHeight),
      };
    }
  }

  class Game {
    constructor(stageEl, ui) {
      this.stageEl = stageEl;
      this.ui = ui;

      this.width = 960;
      this.height = 540;

      this.rng = mulberry32(Math.floor(Math.random() * 1e9));
      this.nodes = [];
      this.port = new Port(this.width * 0.5, this.height * 0.5);
      this.bots = [];

      this.shipCount = 1;
      this.shipCapacityLevel = 1;
      this.ships = [new Ship(10, this.rng)];

      this.money = 0;
      this.gems = 0;
      this.gold = 0;
      this.soldUnits = 0;
      this.shipTrips = 0;

      this.mineUnlocked = false;
      this.efficiencyBoostTimer = 0;

      this.portStorage = { wood: 0, stone: 0 };
      this.botCount = 1;
      this.pendingBots = 0;
      this.deliveries = [];

      this.paused = false;
      this.statusText = "Running";

      this._nodeId = 1;
      this._lastSaveAt = 0;

      this.sound = new Sound();
      this.toasts = new Toasts(document.getElementById("toasts"));
      this.ach = new AchievementSystem(this.toasts, this.sound);

      this.visual = new Visual3D(stageEl, this.width, this.height, this.rng);

      this._uiBotListCooldown = 0;
      this._uiChipCooldown = 0;

      this._initWorld();
      this._load();
      this._syncShips();
      this._syncBots();
      this._wireUI();
    }

    _initWorld() {
      const margin = 60;
      const place = (type, count) => {
        for (let i = 0; i < count; i++) {
          const x = lerp(margin, this.width - margin, this.rng());
          const y = lerp(margin, this.height - margin, this.rng());
          this.nodes.push(new ResourceNode(this._nodeId++, type, x, y));
        }
      };
      place("wood", 10);
      place("stone", 8);
    }

    _syncShips() {
      const count = clamp(Number(this.shipCount) || 1, 1, 7);
      this.shipCount = count;
      const cap = SHIP_CAPACITY_BY_LEVEL[this.shipCapacityLevel] || 10;
      for (const s of this.ships) s.capacity = cap;
      while (this.ships.length < count) {
        this.ships.push(new Ship(cap, this.rng));
      }
    }

    _spawnBot() {
      const id = this.bots.length + 1;
      const t = id * 0.85;
      const radius = 26 + Math.sqrt(id) * 7;
      const ox = Math.cos(t) * radius + (this.rng() - 0.5) * 10;
      const oy = Math.sin(t) * radius + (this.rng() - 0.5) * 10;
      const x = clamp(this.port.x + ox, 12, this.width - 12);
      const y = clamp(this.port.y + oy, 12, this.height - 12);
      this.bots.push(new Bot(id, x, y, this.rng));
      this.visual.ensureBot(this.bots[this.bots.length - 1]);
    }

    _syncBots() {
      const desired = clamp(Number(this.botCount) - this.pendingBots, 1, BOT_MAX);
      while (this.bots.length < desired) this._spawnBot();
      while (this.bots.length > desired) this.bots.pop();
      if (this.botCount >= 10) this.ach.unlock("bots_10");
      if (this.botCount >= 25) this.ach.unlock("bots_25");
      if (this.botCount >= 35) this.ach.unlock("bots_35");
    }

    nextBotCost() {
      const owned = this.botCount;
      if (owned >= BOT_MAX) return null;
      return Math.ceil(BOT_BASE_COST * Math.pow(BOT_COST_GROWTH, owned));
    }

    buyShipCost() {
      if (this.shipCount >= 7) return null;
      return SHIP_BUY_COST[this.shipCount] || null;
    }

    capacityUpgradeCost() {
      if (this.shipCapacityLevel >= 7) return null;
      return SHIP_CAPACITY_COST[this.shipCapacityLevel + 1] || null;
    }

    efficiencyMultiplier() {
      return this.efficiencyBoostTimer > 0 ? EFFICIENCY_BOOST : EFFICIENCY_BASE;
    }

    miningBots() {
      if (!this.mineUnlocked) return 0;
      if (this.botCount < MINE_MIN_BOTS) return 0;
      return Math.min(this.botCount, MINE_MAX_BOTS);
    }

    _wireUI() {
      const { btnPause, btnReset, buyBot, buyShip, upgradeShip, unlockMine, boostEfficiency, sellGold } = this.ui;

      if (btnPause) {
        btnPause.addEventListener("click", () => {
          this.paused = !this.paused;
          btnPause.textContent = this.paused ? "Resume" : "Pause";
          this.statusText = this.paused ? "Paused" : "Running";
        });
      }

      if (btnReset) {
        btnReset.addEventListener("click", () => {
          const ok = confirm("Reset this run? This clears your local save.");
          if (!ok) return;
          try {
            localStorage.removeItem("ibt_save_v1");
            localStorage.removeItem("ibt_save_v2");
            localStorage.removeItem("ibt_save_v3");
            localStorage.removeItem("ibt_save_v4");
            localStorage.removeItem("ibt_save_v5");
            localStorage.removeItem("ibt_save_v6"); // Added v6 cleanup
          } catch {
            // ignore
          }
          location.reload();
        });
      }

      if (buyBot) {
        buyBot.addEventListener("click", () => {
          const cost = this.nextBotCost();
          if (cost === null) return;
          if (this.money < cost) return;
          this.money -= cost;
          this.botCount += 1;
          this.pendingBots += 1;
          this.deliveries.push({ t: 0, phase: 'IN' });
          this._syncBots();
          this._save(true);
        });
      }

      if (buyShip) {
        buyShip.addEventListener("click", () => {
          const cost = this.buyShipCost();
          if (cost === null || this.money < cost) return;
          this.money -= cost;
          this.shipCount += 1;
          this._syncShips();
          this._save(true);
        });
      }

      if (upgradeShip) {
        upgradeShip.addEventListener("click", () => {
          const cost = this.capacityUpgradeCost();
          if (cost === null || this.money < cost) return;
          this.money -= cost;
          this.shipCapacityLevel += 1;
          this._syncShips();
          this._save(true);
        });
      }

      if (unlockMine) {
        unlockMine.addEventListener("click", () => {
          if (this.mineUnlocked) return;
          if (this.gems < MINE_UNLOCK_COST_GEMS) return;
          if (this.botCount < MINE_MIN_BOTS) return;
          this.gems -= MINE_UNLOCK_COST_GEMS;
          this.mineUnlocked = true;
          this.ach.unlock("unlock_mine");
          this._save(true);
        });
      }

      if (boostEfficiency) {
        boostEfficiency.addEventListener("click", () => {
          if (!this.mineUnlocked) return;
          if (this.gems < EFFICIENCY_BOOST_COST_GEMS) return;
          this.gems -= EFFICIENCY_BOOST_COST_GEMS;
          this.efficiencyBoostTimer = EFFICIENCY_BOOST_SECONDS;
          this._save(true);
        });
      }

      if (sellGold) {
        sellGold.addEventListener("click", () => {
          const units = Math.floor(this.gold);
          if (units <= 0) return;
          this.gold -= units;
          this.money += units * GOLD_VALUE;
          this._save(true);
        });
      }

      this.visual.renderer.domElement.addEventListener("click", (e) => {
        const hit = this.visual.pickWorldPoint(e.clientX, e.clientY);
        if (!hit) return;

        if (e.shiftKey) {
          // Prevent stacking too many nodes in the exact same spot
          for (const n of this.nodes) {
            if (dist({x: hit.x, y: hit.y}, n) < 20) return;
          }
          const node = new ResourceNode(this._nodeId++, "wood", hit.x, hit.y);
          this.nodes.push(node);
          this.visual.ensureNode(node);
          return;
        }
        if (e.altKey) {
          // Prevent stacking
          for (const n of this.nodes) {
            if (dist({x: hit.x, y: hit.y}, n) < 20) return;
          }
          const node = new ResourceNode(this._nodeId++, "stone", hit.x, hit.y);
          this.nodes.push(node);
          this.visual.ensureNode(node);
          return;
        }

        this.port.x = hit.x;
        this.port.y = hit.y;
      });

      window.addEventListener("beforeunload", () => this._save(true));
    }

    _load() {
      try {
        const tryKeys = ["ibt_save_v6", "ibt_save_v5", "ibt_save_v4", "ibt_save_v3", "ibt_save_v2", "ibt_save_v1"];
        let data = null;
        let version = 0;
        for (const k of tryKeys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed.v !== "number") continue;
          data = parsed;
          version = parsed.v;
          break;
        }
        if (!data) return;

        if (version === 1 && data.storage) {
          this.portStorage.wood = Number(data.storage.wood ?? 0) || 0;
          this.portStorage.stone = Number(data.storage.stone ?? 0) || 0;
        }

        if (version === 2) {
          this.money = Number(data.money ?? 0) || 0;
          this.portStorage.wood = Number(data.portStorage?.wood ?? 0) || 0;
          this.portStorage.stone = Number(data.portStorage?.stone ?? 0) || 0;
        }

        if (version === 3) {
          this.money = Number(data.money ?? 0) || 0;
          this.portStorage.wood = Number(data.portStorage?.wood ?? 0) || 0;
          this.portStorage.stone = Number(data.portStorage?.stone ?? 0) || 0;
          this.botCount = clamp(Number(data.botCount ?? 1) || 1, 1, BOT_MAX);
          this.shipCount = clamp(Number(data.shipLevel ?? 1) || 1, 1, 7);
        }

        if (version === 4 || version === 5 || version === 6) {
          this.money = Number(data.money ?? 0) || 0;
          this.gems = clamp(Number(data.gems ?? 0) || 0, 0, 999999);
          this.gold = clamp(Number(data.gold ?? 0) || 0, 0, 999999);
          this.mineUnlocked = !!data.mineUnlocked;
          this.efficiencyBoostTimer = clamp(Number(data.efficiencyBoostTimer ?? 0) || 0, 0, 999999);

          this.portStorage.wood = Number(data.portStorage?.wood ?? 0) || 0;
          this.portStorage.stone = Number(data.portStorage?.stone ?? 0) || 0;
          this.botCount = clamp(Number(data.botCount ?? 1) || 1, 1, BOT_MAX);
          this.shipCount = clamp(Number(data.shipLevel ?? data.shipCount ?? 1) || 1, 1, 7);
          this.shipCapacityLevel = clamp(Number(data.shipCapacityLevel ?? 1) || 1, 1, 7);
          this.shipTrips = clamp(Number(data.shipTrips ?? 0) || 0, 0, 999999);
          this.pendingBots = Number(data.pendingBots) || 0;
          if (Array.isArray(data.deliveries)) this.deliveries = data.deliveries;

          if (Array.isArray(data.achievements)) this.ach.load(data.achievements);
        }

        if (data.port && typeof data.port.x === "number" && typeof data.port.y === "number") {
          this.port.x = clamp(data.port.x, 30, this.width - 30);
          this.port.y = clamp(data.port.y, 30, this.height - 30);
        }

        if (Array.isArray(data.nodes) && data.nodes.length > 0) {
          const nodes = [];
          let maxId = 0;
          for (const n of data.nodes) {
            if (!n || (n.type !== "wood" && n.type !== "stone")) continue;
            if (typeof n.x !== "number" || typeof n.y !== "number") continue;
            const id = Number(n.id) || 0;
            maxId = Math.max(maxId, id);
            const node = new ResourceNode(id, n.type, clamp(n.x, 20, this.width - 20), clamp(n.y, 20, this.height - 20));
            node.amount = clamp(Number(n.amount ?? 4) || 4, 1, 4);
            nodes.push(node);
          }
          if (nodes.length > 0) {
            this.nodes = nodes;
            this._nodeId = Math.max(maxId + 1, this._nodeId);
          }
        }

        if (Array.isArray(data.ships)) {
          this.ships = [];
          const cap = SHIP_CAPACITY_BY_LEVEL[this.shipCapacityLevel] || 10;
          for (const s of data.ships) {
            const ship = new Ship(cap, this.rng);
            ship.loadWood = clamp(Number(s.loadWood ?? 0) || 0, 0, ship.capacity);
            ship.loadStone = clamp(Number(s.loadStone ?? 0) || 0, 0, ship.capacity);
            const validStates = new Set(["Waiting", "Loading", "Departing", "Traveling", "Returning"]);
            if (validStates.has(s.state)) ship.state = s.state;
            ship.timer = clamp(Number(s.timer ?? 0) || 0, 0, 999999);
            ship.halfTripSeconds = 35;
            ship.timer = Math.min(ship.timer, 35);
            this.ships.push(ship);
          }
        } else if (data.ship) {
          const s = data.ship;
          const cap = SHIP_CAPACITY_BY_LEVEL[this.shipCapacityLevel] || 10;
          const ship = new Ship(cap, this.rng);
          ship.loadWood = clamp(Number(s.loadWood ?? 0) || 0, 0, ship.capacity);
          ship.loadStone = clamp(Number(s.loadStone ?? 0) || 0, 0, ship.capacity);
          const validStates = new Set(["Waiting", "Loading", "Departing", "Traveling", "Returning"]);
          if (validStates.has(s.state)) ship.state = s.state;
          ship.timer = clamp(Number(s.timer ?? 0) || 0, 0, 999999);
          ship.halfTripSeconds = 35;
          ship.timer = Math.min(ship.timer, 35);
          this.ships = [ship];
        }

        this._syncShips();
      } catch {
        // ignore broken saves
      }
    }

    _save(force) {
      const t = nowMs();
      if (!force && t - this._lastSaveAt < 9000) return;
      this._lastSaveAt = t;

      const payload = {
        v: 6,
        money: Math.floor(this.money),
        gems: Math.floor(this.gems),
        gold: this.gold,
        mineUnlocked: this.mineUnlocked,
        efficiencyBoostTimer: this.efficiencyBoostTimer,
        shipTrips: Math.floor(this.shipTrips),

        botCount: Math.floor(this.botCount),
        pendingBots: Math.floor(this.pendingBots),
        deliveries: this.deliveries,
        shipCount: Math.floor(this.shipCount),
        shipCapacityLevel: Math.floor(this.shipCapacityLevel),
        portStorage: { wood: Math.floor(this.portStorage.wood), stone: Math.floor(this.portStorage.stone) },
        port: { x: this.port.x, y: this.port.y },
        ships: this.ships.map(s => ({
          capacity: s.capacity,
          loadWood: s.loadWood,
          loadStone: s.loadStone,
          state: s.state,
          timer: s.timer,
          halfTripSeconds: s.halfTripSeconds,
        })),
        nodes: this.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, amount: n.amount })),
        achievements: this.ach.export(),
      };

      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      } catch {
        // ignore quota errors
      }
    }

    _pickTargetNode(bot) {
      const desired = bot.preferred;
      let best = null;
      let bestD = Infinity;
      for (const n of this.nodes) {
        if (n.amount <= 0) continue;
        const preferBoost = n.type === desired ? 0.92 : 1.0;
        const d = dist(bot, n) * preferBoost;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (!best) return null;
      bot.targetNodeId = best.id;
      return best;
    }

    _findNodeById(id) {
      for (const n of this.nodes) if (n.id === id) return n;
      return null;
    }

    _moveTowards(entity, targetX, targetY, speed, dt) {
      const dir = normalize(targetX - entity.x, targetY - entity.y);
      entity.x += dir.x * speed * dt;
      entity.y += dir.y * speed * dt;
      entity.x = clamp(entity.x, 12, this.width - 12);
      entity.y = clamp(entity.y, 12, this.height - 12);
    }

    _updateGoldMine(dt) {
      if (!this.mineUnlocked) return;
      if (this.efficiencyBoostTimer > 0) this.efficiencyBoostTimer = Math.max(0, this.efficiencyBoostTimer - dt);
      const bots = this.miningBots();
      if (bots <= 0) return;
      const mult = this.efficiencyMultiplier();
      const goldPerSecondPerBot = MINE_GOLD_PER_HOUR_PER_BOT / MINE_TEST_HOUR_SECONDS;
      this.gold += bots * goldPerSecondPerBot * mult * dt;
    }

    update(dt) {
      if (this.paused) return;

      for (let i = this.deliveries.length - 1; i >= 0; i--) {
        const d = this.deliveries[i];
        d.t += dt;
        if (d.phase === 'IN' && d.t >= 2.0) {
          d.phase = 'OUT';
          d.t = 0;
          this.pendingBots = Math.max(0, this.pendingBots - 1);
          this._syncBots(); // Spawns the bot out of the boat!
          this.visual.addFloater("Bot Arrived!", "#3b82f6", this.port.x, 40, this.port.y);
        } else if (d.phase === 'OUT' && d.t >= 2.0) {
          this.deliveries.splice(i, 1);
        }
      }

      for (const bot of this.bots) bot.snapshotPrev();

      for (const bot of this.bots) {
        if (bot.inventoryCount() >= BOT_CARRY) {
          bot.state = "TO_PORT";
          bot.targetNodeId = null;
        }

        if (bot.state === "SEEK") {
          const node = this._pickTargetNode(bot);
          bot.state = node ? "TO_NODE" : "IDLE";
          continue;
        }

        if (bot.state === "IDLE") {
          const node = this._pickTargetNode(bot);
          if (node) bot.state = "TO_NODE";
          continue;
        }

        if (bot.state === "TO_NODE") {
          const node = this._findNodeById(bot.targetNodeId);
          if (!node) {
            bot.state = "SEEK";
            continue;
          }
          const d = dist(bot, node);
          if (d <= node.radius + 10) {
            bot.state = "HARVEST";
            bot.harvestTimer = 0;
            continue;
          }
          this._moveTowards(bot, node.x, node.y, BOT_SPEED, dt);
          continue;
        }

        if (bot.state === "HARVEST") {
          const node = this._findNodeById(bot.targetNodeId);
          if (!node) {
            bot.state = "SEEK";
            continue;
          }

          const d = dist(bot, node);
          if (d > node.radius + 14) {
            bot.state = "TO_NODE";
            continue;
          }

          bot.harvestTimer += dt;
          if (bot.harvestTimer >= HARVEST_SECONDS) {
            bot.harvestTimer -= HARVEST_SECONDS;
            if (node.amount > 0) {
              node.amount -= 1;
              if (node.type === "wood") bot.inventoryWood += 1;
              else bot.inventoryStone += 1;
              this.sound.beep("collect");
            }
            if (bot.inventoryCount() >= BOT_CARRY) {
              bot.state = "TO_PORT";
              bot.targetNodeId = null;
            }

            if (node.amount <= 0) {
              const margin = 60;
              node.x = lerp(margin, this.width - margin, this.rng());
              node.y = lerp(margin, this.height - margin, this.rng());
              node.amount = 4;
              
              for (const b of this.bots) {
                if (b.targetNodeId === node.id) {
                  b.state = "SEEK";
                  b.targetNodeId = null;
                }
              }
            }
          }
          continue;
        }

        if (bot.state === "TO_PORT") {
          const d = dist(bot, this.port);
          if (d <= this.port.radius + 12) {
            this.visual.triggerPortBounce();
            this.visual.addFloater(`+${bot.inventoryCount()}`, bot.inventoryWood > 0 ? '#fb923c' : '#9ca3af', this.port.x, 20, this.port.y);
            this.portStorage.wood += bot.inventoryWood;
            this.portStorage.stone += bot.inventoryStone;
            bot.inventoryWood = 0;
            bot.inventoryStone = 0;
            bot.state = "SEEK";
            continue;
          }
          this._moveTowards(bot, this.port.x, this.port.y, BOT_SPEED, dt);
          continue;
        }
      }

      for (const ship of this.ships) {
        ship.update(dt, this);
      }
      this._updateGoldMine(dt);
      this._save(false);

      if (this.money >= 1000) this.ach.unlock("money_1000");
    }

    _shipDrawPosition(ship, index) {
      const berth = this._shipBerthPosition(index);
      const atPort = berth;
      const off = { x: this.width + 90, y: this.port.y + 18 + (index * 55) };

      if (ship.state === "Traveling") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        const p = this._shipBezier(atPort, off, t);
        return { x: p.x, y: lerp(atPort.y, 40, t) };
      }
      if (ship.state === "Returning") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        const p = this._shipBezier(off, atPort, t);
        return { x: p.x, y: lerp(40, atPort.y, t) };
      }
      return atPort;
    }

    _shipBerthPosition(index) {
      // Base berth is to the "east" of the port.
      let bx = this.port.x + 60 + (index * 55);
      let by = this.port.y + 18;

      // If that area is blocked by nearby trees/stones, push away from the closest obstacle.
      let closest = null;
      let closestD = Infinity;
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - bx, n.y - by);
        if (d < closestD) {
          closestD = d;
          closest = n;
        }
      }
      const safe = 80;
      if (closest && closestD < safe) {
        const dx = bx - closest.x;
        const dy = by - closest.y;
        const dir = normalize(dx, dy);
        const push = safe - closestD + 30;
        bx += dir.x * push;
        by += dir.y * push;
      }

      bx = clamp(bx, 20, this.width - 20);
      by = clamp(by, 20, this.height - 20);
      return { x: bx, y: by };
    }

    _shipBezier(start, end, t) {
      // Compute a simple detour control point if the straight segment intersects obstacles.
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const segx = end.x - start.x;
      const segy = end.y - start.y;
      const segLen = Math.hypot(segx, segy) || 1;
      const segDir = { x: segx / segLen, y: segy / segLen };
      const perp = { x: -segDir.y, y: segDir.x };

      const closestOnSeg = (p) => {
        const vx = p.x - start.x;
        const vy = p.y - start.y;
        const proj = vx * segDir.x + vy * segDir.y;
        const u = clamp(proj / segLen, 0, 1);
        return { x: start.x + segx * u, y: start.y + segy * u, u };
      };

      let worst = null;
      let worstD = Infinity;
      for (const n of this.nodes) {
        // only consider obstacles near the segment (and not too close to the offscreen endpoint)
        const cp = closestOnSeg(n);
        const d = Math.hypot(n.x - cp.x, n.y - cp.y);
        if (d < worstD) {
          worstD = d;
          worst = { node: n, cp };
        }
      }

      let control = mid;
      const safeRadius = 70;
      if (worst && worstD < safeRadius) {
        const awayX = worst.cp.x - worst.node.x;
        const awayY = worst.cp.y - worst.node.y;
        let away = normalize(awayX, awayY);
        if (Math.hypot(away.x, away.y) < 1e-6) away = perp;
        const strength = clamp((safeRadius - worstD) + 90, 90, 180);
        control = { x: mid.x + away.x * strength, y: mid.y + away.y * strength };
      } else {
        // small default curve so it doesn't look like a laser line
        control = { x: mid.x + perp.x * 40, y: mid.y + perp.y * 40 };
      }

      // Quadratic Bezier interpolation
      const a = { x: lerp(start.x, control.x, t), y: lerp(start.y, control.y, t) };
      const b = { x: lerp(control.x, end.x, t), y: lerp(control.y, end.y, t) };
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    }

    syncUI(dt) {
      const {
        moneyTotal,
        gemsTotal,
        goldTotal,
        mineStatus,
        botCount,
        buyBot,
        buyBotCost,
        buyShip,
        buyShipCost,
        upgradeShip,
        upgradeShipCost,
        portWood,
        portStone,
        shipState,
        shipTimer,
        shipLoad,
        shipMeta,
        unlockMine,
        boostEfficiency,
        sellGold,
        botList,
        statusLine,

        chipMoney,
        chipGems,
        chipGold,
        chipBots,
        chipShip,
        chipStorage,
      } = this.ui;

      moneyTotal.textContent = formatMoney(this.money);
      gemsTotal.textContent = String(Math.floor(this.gems));
      goldTotal.textContent = String(Math.floor(this.gold));
      botCount.textContent = String(this.botCount);
      portWood.textContent = String(Math.floor(this.portStorage.wood));
      portStone.textContent = String(Math.floor(this.portStorage.stone));

      const totalLoad = this.ships.reduce((sum, s) => sum + s.currentLoad(), 0);
      const totalCap = this.ships.reduce((sum, s) => sum + s.capacity, 0);
      const loadWood = this.ships.reduce((sum, s) => sum + s.loadWood, 0);
      const loadStone = this.ships.reduce((sum, s) => sum + s.loadStone, 0);

      let minTime = Infinity;
      for (const s of this.ships) {
        if (s.state === "Traveling" || s.state === "Returning") {
          if (s.timer < minTime) minTime = s.timer;
        }
      }

      shipState.textContent = `${this.ships.length} Ships Active`;
      shipLoad.textContent = `Total Load: ${totalLoad} / ${totalCap} (W:${loadWood}, S:${loadStone})`;
      shipTimer.textContent = minTime === Infinity ? "--:--" : formatTimer(minTime);
      shipMeta.textContent = `Ships: ${this.shipCount}/7 • Cap Lv: ${this.shipCapacityLevel}/7`;

      const nextBot = this.nextBotCost();
      if (buyBotCost) buyBotCost.textContent = nextBot === null ? "MAX LEVEL" : formatMoney(nextBot);
      if (buyBot) buyBot.disabled = nextBot === null || this.money < nextBot;

      const shipBuy = this.buyShipCost();
      if (buyShipCost) buyShipCost.textContent = shipBuy === null ? "MAX LEVEL" : formatMoney(shipBuy);
      if (buyShip) buyShip.disabled = shipBuy === null || this.money < shipBuy;

      const capUpg = this.capacityUpgradeCost();
      if (upgradeShipCost) upgradeShipCost.textContent = capUpg === null ? "MAX LEVEL" : formatMoney(capUpg);
      if (upgradeShip) upgradeShip.disabled = capUpg === null || this.money < capUpg;

      if (unlockMine) unlockMine.disabled = this.mineUnlocked || this.gems < MINE_UNLOCK_COST_GEMS || this.botCount < MINE_MIN_BOTS;
      if (boostEfficiency) boostEfficiency.disabled = !this.mineUnlocked || this.gems < EFFICIENCY_BOOST_COST_GEMS;
      if (sellGold) sellGold.disabled = Math.floor(this.gold) <= 0;

      const miningBots = this.miningBots();
      const mult = this.efficiencyMultiplier();
      if (mineStatus) {
        if (!this.mineUnlocked) mineStatus.textContent = `Locked. Requires ${MINE_MIN_BOTS} bots.`;
        else if (miningBots <= 0) mineStatus.textContent = `Unlocked. Need ${MINE_MIN_BOTS} bots. (Max ${MINE_MAX_BOTS} miners)`;
        else {
          const boost = this.efficiencyBoostTimer > 0 ? ` • Boost: ${formatTimer(this.efficiencyBoostTimer)}` : "";
          mineStatus.textContent = `Mining bots: ${miningBots}/${MINE_MAX_BOTS} • Efficiency: ${mult}x${boost}`;
        }
      }

      if (statusLine) statusLine.textContent = this.statusText;

      this._uiBotListCooldown -= dt;
      if (this._uiBotListCooldown <= 0) {
        this._uiBotListCooldown = 0.35; // reduce heavy DOM churn
        botList.textContent = "";
        for (const b of this.bots) {
          const row = document.createElement("div");
          row.className = "botrow";

          const top = document.createElement("div");
          top.className = "botrow__top";

          const left = document.createElement("div");
          left.textContent = `Bot #${b.id}`;

          const right = document.createElement("span");
          right.className = "pill";
          right.textContent = `${b.state}`;

          top.append(left, right);

          const inv = document.createElement("div");
          inv.textContent = `Cargo: ${b.inventoryCount()}/${BOT_CARRY} (W:${b.inventoryWood}, S:${b.inventoryStone})`;

          const pref = document.createElement("div");
          pref.textContent = `Pref: ${b.preferred} • Speed: ${BOT_SPEED} • Harvest: ${HARVEST_SECONDS.toFixed(2)}s`;

          row.append(top, inv, pref);
          botList.append(row);
        }
      }

      this._uiChipCooldown -= dt;
      if (this._uiChipCooldown <= 0) {
        this._uiChipCooldown = 0.18;
        chipMoney.textContent = formatMoney(this.money);
        chipGems.textContent = String(Math.floor(this.gems));
        chipGold.textContent = String(Math.floor(this.gold));
        chipBots.textContent = String(this.botCount);
        chipShip.textContent = `${this.shipCount} Ships (Lv ${this.shipCapacityLevel})`;
        chipStorage.textContent = `${Math.floor(this.portStorage.wood)}W ${Math.floor(this.portStorage.stone)}S`;
      }
    }
  }

  function main() {
    const statusLine = document.getElementById("statusLine");
    try {
      const stageEl = document.getElementById("stage3d");
      
      const ui = {
        moneyTotal: document.getElementById("moneyTotal"),
        botCount: document.getElementById("botCount"),
        buyBot: document.getElementById("buyBot"),
        buyBotCost: document.getElementById("buyBotCost"),
        buyShip: document.getElementById("buyShip"),
        buyShipCost: document.getElementById("buyShipCost"),
        upgradeShip: document.getElementById("upgradeShip"),
        upgradeShipCost: document.getElementById("upgradeShipCost"),

        gemsTotal: document.getElementById("gemsTotal"),
        goldTotal: document.getElementById("goldTotal"),
        mineStatus: document.getElementById("mineStatus"),
        unlockMine: document.getElementById("unlockMine"),
        boostEfficiency: document.getElementById("boostEfficiency"),
        sellGold: document.getElementById("sellGold"),

        portWood: document.getElementById("portWood"),
        portStone: document.getElementById("portStone"),

        shipState: document.getElementById("shipState"),
        shipTimer: document.getElementById("shipTimer"),
        shipLoad: document.getElementById("shipLoad"),
        shipMeta: document.getElementById("shipMeta"),

        botList: document.getElementById("botList"),
        statusLine,

        chipMoney: document.getElementById("chipMoney"),
        chipGems: document.getElementById("chipGems"),
        chipGold: document.getElementById("chipGold"),
        chipBots: document.getElementById("chipBots"),
        chipShip: document.getElementById("chipShip"),
        chipStorage: document.getElementById("chipStorage"),

        btnPause: document.getElementById("btnPause"),
        btnReset: document.getElementById("btnReset"),
      };

      const game = new Game(stageEl, ui);

      let last = nowMs();
      let acc = 0;
      const step = 1 / 60;

      function frame() {
        const t = nowMs();
        const dt = clamp((t - last) / 1000, 0, 0.1);
        last = t;
        acc += dt;

        while (acc >= step) {
          game.update(step);
          game.visual.update(step);
          acc -= step;
        }

        const alpha = clamp(acc / step, 0, 1);
        game.visual.sync(game, alpha);
        game.visual.render();
        game.syncUI(dt);
        requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      if (statusLine) statusLine.textContent = `Game error: ${err?.message || err}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();
