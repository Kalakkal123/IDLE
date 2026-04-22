import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import {
  SAVE_KEY, PRICES, GOLD_VALUE, BOT_SPEED, BOT_CARRY, HARVEST_SECONDS,
  BOT_MAX, BOT_BASE_COST, BOT_COST_GROWTH, SHIP_CAPACITY_BY_LEVEL,
  SHIP_CAPACITY_COST, SHIP_CAPACITY_RES, SHIP_BUY_COST, SHIP_BUY_RES,
  MINE_UNLOCK_COST_GEMS, MINE_MIN_BOTS, MINE_MAX_BOTS, MINE_GOLD_PER_HOUR_PER_BOT,
  MINE_TEST_HOUR_SECONDS, EFFICIENCY_BASE, EFFICIENCY_BOOST, EFFICIENCY_BOOST_COST_GEMS,
  EFFICIENCY_BOOST_SECONDS, clamp, lerp, mulberry32, dist, normalize,
  nowMs, formatMoney, formatTimer, Sound, Toasts, AchievementSystem,
  ResourceNode, Port, Bot, Ship
} from "./script2.js";

(() => {
  "use strict";

  window.__IBT_BOOTED = true;

  const MODEL_PATHS = {
    bot: "assets/models/worker.glb",
    tree: "assets/models/tree.glb",
    stone: "assets/models/stone.glb",
    ship: "assets/models/ship.glb",
    boat: "assets/models/boat.glb",
    port: "assets/models/port.glb",
    factory: "assets/models/goods.glb",
    truck: "assets/models/truck.glb",
    box: "assets/models/box.glb",
    goodsStone: "assets/models/goods-stone.glb",
    goodsWood: "assets/models/goods-wood.glb",
  };

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

  class Visual3D {
    constructor(containerEl, worldWidth, worldHeight, rng) {
      this.containerEl = containerEl;
      this.worldWidth = worldWidth;
      this.worldHeight = worldHeight;
      this.rng = rng;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x38bdf8);
      this.scene.fog = new THREE.Fog(0x38bdf8, 600, 2000);

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
        boat: null,
        port: null,
        factory: null,
        truck: null,
        box: null,
        goodsStone: null,
        goodsWood: null,
      };

      this.botObjects = new Map();
      this.nodeObjects = new Map();
      this.shipObject = null;
      this.portObject = null;
      this.floaters = [];
      this.portBounce = 0;
      this.boatObjects = [];
      this.pickupBoxObjects = [];

      this._initLights();
      this._initGround();
      this._initPort();
      this._initFactory();
      this._initTruck();
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
      this.tileSize = 70;
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
      const group = new THREE.Group();

      group.position.set(this.worldWidth / 2, 0, this.worldHeight / 2);
      this.scene.add(group);
      this.portObject = group;
    }

    _initFactory() {
      const m = new THREE.Mesh(new THREE.BoxGeometry(80, 40, 80), new THREE.MeshStandardMaterial({ color: 0x475569 }));
      m.position.set(80, 20, 80);
      this.scene.add(m);
      this.factoryObject = m;
    }

    _initTruck() {
      this.truckObject = new THREE.Group();
      const tm = new THREE.Mesh(new THREE.BoxGeometry(20, 15, 35), new THREE.MeshStandardMaterial({color: 0x3b82f6}));
      tm.position.y = 7.5;
      this.truckObject.add(tm);
      this.truckCargo = new THREE.Group();
      this.truckCargo.position.set(0, 10, -5);
      this.truckObject.add(this.truckCargo);
      this.scene.add(this.truckObject);
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

    _gammaCorrectColor(color) {
      // Apply reverse gamma correction: raise each component to power 1/2.2
      // This brightens colors that are too dark from gamma issues
      const p = 1 / 2.2;
      color.r = Math.pow(color.r, p);
      color.g = Math.pow(color.g, p);
      color.b = Math.pow(color.b, p);
      return color;
    }

    _applyMaterialFixups(root, tintHex, keepTexture = false) {
      const tint = tintHex !== null && tintHex !== undefined ? new THREE.Color(tintHex) : null;
      root.traverse((o) => {
        if (!o.isMesh) return;
        
        // Ensure each instance gets its own cloned material so fading one doesn't fade all of them
        const materials = (Array.isArray(o.material) ? o.material : [o.material]).map(m => m ? m.clone() : m);
        o.material = Array.isArray(o.material) ? materials : materials[0];
        
        const hasVertexColors = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.color);
        for (const m of materials) {
          if (!m) continue;

          if (!keepTexture && m.map) {
            // Remove the dummy texture so it doesn't block flat tints
            m.map = null;
          }

          if (hasVertexColors) {
            m.vertexColors = true;
            if (tint && m.color) m.color.set(0xffffff);
          } else if (m.map) {
            // Preserve the user's custom textures if they exist!
            if (tint && m.color) m.color.set(0xffffff);
          } else if (tint && m.color) {
            // Many Kenney models are untextured; give a readable tint.
            m.color.copy(tint);
          }
          
          // Apply gamma correction only when not preserving original textures/colors
          if (!keepTexture && m.color) {
            this._gammaCorrectColor(m.color);
          }
          
          // Adjust material properties for crystal clear, sharp colors
          if (typeof m.metalness === "number") m.metalness = Math.min(m.metalness, 0.3);
          if (typeof m.roughness === "number") m.roughness = Math.max(m.roughness, 0.5);
          m.needsUpdate = true;
        }
      });
    }

    _buildInstance(base, targetHeight, tintHex, keepTexture = false) {
      const obj = safeClone(base);
      this._applyMaterialFixups(obj, tintHex, keepTexture);

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
      const gltfLoader = new GLTFLoader(manager);
      // Keep "appropriate loaders" available as future fallback.
      // eslint-disable-next-line no-unused-vars
      const fbxLoader = new FBXLoader();
      // eslint-disable-next-line no-unused-vars
      const objLoader = new OBJLoader();

      const loadGLB = async (path) => {
        const url = encodePath(path);
        const gltf = await gltfLoader.loadAsync(url);
        gltf.scene.animations = gltf.animations;
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
        safeLoad("port", MODEL_PATHS.port),
        safeLoad("factory", MODEL_PATHS.factory),
        safeLoad("truck", MODEL_PATHS.truck),
        safeLoad("box", MODEL_PATHS.box),
        safeLoad("goodsStone", MODEL_PATHS.goodsStone),
        safeLoad("goodsWood", MODEL_PATHS.goodsWood),
      ]);

      if (this.models.bot) this._applyMaterialFixups(this.models.bot, null, true);
      if (this.models.tree) this._applyMaterialFixups(this.models.tree, 0x22c55e, false);
      if (this.models.stone) this._applyMaterialFixups(this.models.stone, 0x94a3b8, false);
      if (this.models.ship) this._applyMaterialFixups(this.models.ship, null, true);
      if (this.models.boat) this._applyMaterialFixups(this.models.boat, null, true);

      // Rebuild existing visual instances now that models are loaded
      for (const obj of this.botObjects.values()) this.scene.remove(obj);
      this.botObjects.clear();
      for (const obj of this.nodeObjects.values()) this.scene.remove(obj);
      this.nodeObjects.clear();
      for (const obj of this.boatObjects) this.scene.remove(obj);
      this.boatObjects = [];
      for (const obj of this.pickupBoxObjects) this.scene.remove(obj);
      this.pickupBoxObjects = [];

      if (this.models.port) {
          const p = safeClone(this.models.port);
          this._applyMaterialFixups(p, null, true); // Keep original model colors
          const box = new THREE.Box3().setFromObject(p);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.z, 1);
          const s = 140 / maxDim;
          p.scale.set(s, s, s);
          
          const center = new THREE.Vector3();
          box.setFromObject(p).getCenter(center);
          const pivot = new THREE.Group();
          p.position.set(-center.x, -box.min.y, -center.z);
          pivot.add(p);
          
          this.scene.add(pivot);
          if (this.portObject) this.scene.remove(this.portObject);
          this.portObject = pivot;
      }

      if (this.models.factory) {
          const f = safeClone(this.models.factory);
          this._applyMaterialFixups(f, null, true); // Keep original model colors
          const box = new THREE.Box3().setFromObject(f);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.z, 1);
          const s = 140 / maxDim;
          f.scale.set(s, s, s);
          
          const center = new THREE.Vector3();
          box.setFromObject(f).getCenter(center);
          const pivot = new THREE.Group();
          f.position.set(-center.x, -box.min.y, -center.z);
          pivot.add(f);
          pivot.position.set(80, 0, 80);
          
          this.scene.add(pivot);
          if (this.factoryObject) this.scene.remove(this.factoryObject);
          this.factoryObject = pivot;
      }

      if (this.models.truck) {
          const t = this._buildInstance(this.models.truck, 30, null, true); // Keep original model colors
          this.truckObject.clear();
          this.truckObject.add(t);
          this.truckCargo = new THREE.Group();
          this.truckCargo.position.set(0, 10, -5);
          this.truckObject.add(this.truckCargo);
      }

      if (this.models.ship) {
        for (let i = 0; i < 7; i++) {
          const old = this.shipObjects[i];
          const shipPivot = this._buildInstance(this.models.ship, 45, null, true);
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
        const instance = this._buildInstance(this.models.bot, 36, null, true);
        group.add(instance);
        if (this.models.bot.animations && this.models.bot.animations.length > 0) {
          group.mixer = new THREE.AnimationMixer(instance.children[0]);
          const clip = this.models.bot.animations[0];
          group.action = group.mixer.clipAction(clip);
          group.action.play();
          group.action.timeScale = 0;
        }
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
        const obj = this._buildInstance(model, type === "wood" ? 90 : 40, tint, false);
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

      for (const obj of this.botObjects.values()) {
        if (obj.mixer) obj.mixer.update(dt);
      }
      for (const obj of this.boatObjects) {
        const bot1 = obj.getObjectByName("bot1");
        if (bot1 && bot1.mixer) bot1.mixer.update(dt);
        const bot2 = obj.getObjectByName("bot2");
        if (bot2 && bot2.mixer) bot2.mixer.update(dt);
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
      const target = (ship.state === "Returning") ? 0 : ship.currentLoad();
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

    syncTruckCargo(game) {
      if (!this.truckObject) return;
      while(this.truckCargo.children.length > 0) this.truckCargo.remove(this.truckCargo.children[0]);
      
      if (game.truck.state === "TO_FACTORY" || game.truck.state === "PROCESSING") {
          for (let i=0; i<game.truck.boxes; i++) {
             let m = this.models.box ? this._buildInstance(this.models.box, 10, 0x8b5a2b, false) : new THREE.Mesh(new THREE.BoxGeometry(8,8,8), new THREE.MeshStandardMaterial({color:0x8b5a2b}));
             m.position.set(0, i*10, 0);
             this.truckCargo.add(m);
          }
      } else if (game.truck.state === "TO_PORT_DROPOFF" || game.truck.state === "RETURN_FACTORY") {
          if (game.truck.load > 0) {
              const type = game.truck.type;
              const model = type === "wood" ? this.models.goodsWood : this.models.goodsStone;
              const tint = type === "wood" ? 0x8b5a2b : 0xd1d5db;
              let m = model ? this._buildInstance(model, 15, tint, false) : new THREE.Mesh(new THREE.BoxGeometry(12,12,12), new THREE.MeshStandardMaterial({color: tint}));
              this.truckCargo.add(m);
          }
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
      this.portObject.position.set(game.port.x, 0, game.port.y);

      for (const bot of game.bots) {
        this.ensureBot(bot);
        const obj = this.botObjects.get(bot.id);
        
        if (["IN_MINE", "IN_BOAT", "LEAVING_MINE"].includes(bot.state)) {
            obj.visible = false;
            continue;
        } else {
            obj.visible = true;
        }

        if (obj.action) {
            const isMoving = ["TO_NODE", "TO_PORT", "TO_MINE"].includes(bot.state);
            obj.action.timeScale = isMoving ? 1 : 0;
        }

        if (bot.state === "WAITING_BOAT") {
            const angle = bot.id * 1.3;
            obj.position.x = game.port.x + Math.cos(angle) * 12;
            obj.position.z = game.port.y + Math.sin(angle) * 12;
            obj.position.y = 0;
            obj.carryObject.visible = false;
            continue;
        }

        obj.position.x = lerp(bot.prevX, bot.x, alpha);
        obj.position.z = lerp(bot.prevY, bot.y, alpha);
        obj.position.y = 0;
        
        const dx = bot.x - bot.prevX;
        const dy = bot.y - bot.prevY;
        if (Math.hypot(dx, dy) > 0.01) {
            obj.rotation.y = Math.PI / 2 - Math.atan2(dy, dx);
        }
        
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

      if (this.truckObject) {
          this.truckObject.position.set(game.truck.x, 0, game.truck.y);
          this.truckObject.rotation.y = game.truck.rotation;
          this.truckObject.visible = game.goodsUnlocked;
          this.syncTruckCargo(game);
      }
      if (this.factoryObject) {
          this.factoryObject.visible = game.goodsUnlocked;
      }

      while(this.pickupBoxObjects.length < game.pickupBoxes) {
          let m = this.models.box ? this._buildInstance(this.models.box, 12, 0x8b5a2b, false) : new THREE.Mesh(new THREE.BoxGeometry(10,10,10), new THREE.MeshStandardMaterial({color:0x8b5a2b}));
          this.scene.add(m);
          this.pickupBoxObjects.push(m);
      }
      while(this.pickupBoxObjects.length > game.pickupBoxes) {
          this.scene.remove(this.pickupBoxObjects.pop());
      }
      for(let i=0; i<this.pickupBoxObjects.length; i++) {
          this.pickupBoxObjects[i].position.set(game.port.x - 40, i * 10, game.port.y - 20);
      }

      for (let i = 0; i < 7; i++) {
        const shipObj = this.shipObjects[i];
        if (i < game.ships.length) {
          const ship = game.ships[i];
          shipObj.visible = true;
          const ship2d = game._shipDrawPosition(ship, i);
          const shipHeight = ship.state === "Traveling" || ship.state === "Returning" ? 200 : (ship.state === "Departing" ? 120 + Math.sin(nowMs() / 50) * 1.5 : 120);
          shipObj.position.set(ship2d.x, shipHeight, ship2d.y);
          
          // Increase the scale slightly as it levels up
          const scale = 1 + (game.shipCapacityLevel - 1) * 0.12;
          shipObj.scale.set(scale, scale, scale);

          const vel = game._shipVelocity(ship, i);
          if (Math.hypot(vel.dx, vel.dy) > 0.001) {
            shipObj.rotation.y = Math.PI / 2 - Math.atan2(vel.dy, vel.dx);
          }
          
          this.syncCargo(ship, shipObj);

          let opacity = 1.0;
          if (ship.state === "Traveling") {
            const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
            if (t > 0.8) opacity = 1.0 - ((t - 0.8) * 5);
          } else if (ship.state === "Returning") {
            const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
            if (t < 0.2) opacity = t * 5;
          }

          shipObj.traverse((o) => {
            if (o.isMesh && o.material) {
              o.material.transparent = true;
              o.material.opacity = opacity;
              o.material.needsUpdate = true;
            }
          });
        } else {
          shipObj.visible = false;
        }
      }

      while (this.boatObjects.length < game.deliveries.length) {
        const pivot = new THREE.Group();
        const m = this.models.boat ? this._buildInstance(this.models.boat, 40, null, true) : new THREE.Mesh(new THREE.BoxGeometry(32, 16, 48), new THREE.MeshStandardMaterial({color:0x8b5a2b}));
        pivot.add(m);
        
        const bot1 = this._makeBotObject();
        bot1.position.set(0, 16, -8);
        bot1.scale.set(0.6, 0.6, 0.6);
        bot1.name = "bot1";
        pivot.add(bot1);
        
        const bot2 = this._makeBotObject();
        bot2.position.set(0, 16, 8);
        bot2.scale.set(0.6, 0.6, 0.6);
        bot2.name = "bot2";
        pivot.add(bot2);
        
        this.scene.add(pivot);
        this.boatObjects.push(pivot);
      }

      for (let i = 0; i < this.boatObjects.length; i++) {
        const obj = this.boatObjects[i];
        if (i < game.deliveries.length) {
          const d = game.deliveries[i];
          obj.visible = true;
          
          let botsInBoat = 0;
          if (!d.type || d.type === "BUY") {
            botsInBoat = d.phase === 'IN' ? 1 : 0;
          } else if (d.type === "MINE_OUT") {
            botsInBoat = d.phase === 'IN' ? 0 : d.count;
          } else if (d.type === "MINE_IN") {
            botsInBoat = d.phase === 'IN' ? d.count : 0;
          }

          const bot1 = obj.getObjectByName("bot1");
          const bot2 = obj.getObjectByName("bot2");
          if (bot1) bot1.visible = botsInBoat >= 1;
          if (bot2) bot2.visible = botsInBoat >= 2;

          const start = { x: -80, y: -80 };
          const port = { x: game.port.x, y: game.port.y };

          const sameKindBoats = game.deliveries.filter(other_d =>
            other_d.type === d.type && other_d.phase === d.phase
          );
          sameKindBoats.sort((a, b) => b.t - a.t); // Oldest boats first (larger 't')
          const queueIndex = sameKindBoats.findIndex(boat => boat === d);
          
          const timeOffset = queueIndex * 1.0; // 1s gap
          const effectiveTime = Math.max(0, d.t - timeOffset);
          const progress = clamp(effectiveTime / 6.0, 0, 1);

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
      this.height = 640;

      this.rng = mulberry32(Math.floor(Math.random() * 1e9));
      this.nodes = [];
      this.port = new Port(this.width * 0.5, this.height * 0.5);
      this.bots = [];

      this.shipCount = 1;
      this.shipCapacityLevel = 1;
      this.ships = [new Ship(10, this.rng)];

      this.shipFilterWood = true;
      this.shipFilterStone = true;

      this.goodsUnlocked = false;
      this.goodsAllocationTarget = 0;
      this.goodsType = "stone";
      this.pickupBoxes = 0;
      this.truck = { x: 170, y: 80, rotation: 0, state: "IDLE", timer: 0, boxes: 0, type: "wood", load: 0 };

      this.money = 0;
      this.gold = 0;
      this.soldUnits = 0;
      this.shipTrips = 0;

      this.mineLevel = 0;
      this.efficiencyBoostTimer = 0;

      this.portStorage = { wood: 0, stone: 0, goodsWood: 0, goodsStone: 0 };
      this.botCount = 1;
      this.pendingBots = 0;
      this.deliveries = [];
      this.mineAllocationTarget = 0;

      this._isResetting = false;
      this.paused = false;
      this.statusText = "Running";

      this._nodeId = 1;
      this._lastSaveAt = 0;

      this.sound = new Sound();
      this.toasts = new Toasts(document.getElementById("toasts"));
      this.ach = new AchievementSystem(this.toasts, this.sound);

      this.visual = new Visual3D(stageEl, this.width, this.height, this.rng);

      this._initWorld();
      this._load();
      this._syncShips();
      this._syncBots();
      
      if (this._savedBotJobs) {
         for (let i = 0; i < this.bots.length; i++) {
            if (this._savedBotJobs[i]) this.bots[i].job = this._savedBotJobs[i];
         }
         delete this._savedBotJobs;
      }

      // Fast-forward mine workers on load so they don't have to wait for boats to arrive back
      if (this.mineLevel > 0 && this.mineAllocationTarget > 0) {
         let assigned = 0;
         for(let i=0; i<this.bots.length; i++) {
             if (this.bots[i].job === "MINE" && assigned < this.mineAllocationTarget) {
                 this.bots[i].state = "IN_MINE";
                 assigned++;
             }
         }
      }

      this._wireUI();
    }

    _initWorld() {
      const margin = 60;
      const place = (type, count) => {
        for (let i = 0; i < count; i++) {
          let nx, ny;
          do {
            nx = lerp(margin, this.width - margin, this.rng());
            ny = lerp(margin, this.height - margin, this.rng());
          } while (dist({x: nx, y: ny}, {x: 80, y: 80}) < 150); // protect factory
          this.nodes.push(new ResourceNode(this._nodeId++, type, nx, ny));
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
      return {
        money: SHIP_BUY_COST[this.shipCount],
        wood: SHIP_BUY_RES[this.shipCount],
        stone: SHIP_BUY_RES[this.shipCount]
      };
    }

    capacityUpgradeCost() {
      if (this.shipCapacityLevel >= 10) return null;
      return {
        money: SHIP_CAPACITY_COST[this.shipCapacityLevel + 1],
        wood: SHIP_CAPACITY_RES[this.shipCapacityLevel + 1],
        stone: SHIP_CAPACITY_RES[this.shipCapacityLevel + 1]
      };
    }

    efficiencyMultiplier() {
      return this.efficiencyBoostTimer > 0 ? EFFICIENCY_BOOST : EFFICIENCY_BASE;
    }

    miningBots() {
      if (this.mineLevel === 0) return 0;
      return this.bots.filter(b => b.state === "IN_MINE" || b.state === "LEAVING_MINE").length;
    }

    _wireUI() {
      const { btnPause, btnReset, buyBot, buyShip, upgradeShip, unlockMine, boostEfficiency, sellGold, toggleWood, toggleStone, unlockGoods, goodsTypeWood, goodsTypeStone } = this.ui;

      if (unlockGoods) {
         unlockGoods.addEventListener("click", () => {
             if (this.goodsUnlocked) return;
             if (this.money < 20000) return;
             this.money -= 20000;
             this.goodsUnlocked = true;
             this.ach.unlock("unlock_goods");
             this._save(true);
         });
      }

      if (btnPause) {
        btnPause.addEventListener("click", () => {
          this.paused = !this.paused;
          btnPause.textContent = this.paused ? "Resume" : "Pause";
          this.statusText = this.paused ? "Paused" : "Running";
        });
      }

      if (btnReset) {
        btnReset.addEventListener("click", () => {
          const ok = confirm("ARE YOU SURE WANT TO RESTART?");
          if (!ok) return;
          this._isResetting = true;
          try {
            localStorage.clear();
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
          if (cost === null || this.money < cost.money || this.portStorage.wood < cost.wood || this.portStorage.stone < cost.stone) return;
          this.money -= cost.money;
          this.portStorage.wood -= cost.wood;
          this.portStorage.stone -= cost.stone;
          this.shipCount += 1;
          if (this.shipCount >= 3) this.ach.unlock("fleet_3");
          if (this.shipCount >= 7) this.ach.unlock("fleet_7");
          this._syncShips();
          this._save(true);
        });
      }

      if (upgradeShip) {
        upgradeShip.addEventListener("click", () => {
          const cost = this.capacityUpgradeCost();
          if (cost === null || this.money < cost.money || this.portStorage.wood < cost.wood || this.portStorage.stone < cost.stone) return;
          this.money -= cost.money;
          this.portStorage.wood -= cost.wood;
          this.portStorage.stone -= cost.stone;
          this.shipCapacityLevel += 1;
          if (this.shipCapacityLevel >= 5) this.ach.unlock("cap_5");
          if (this.shipCapacityLevel >= 10) this.ach.unlock("cap_10");
          this._syncShips();
          this._save(true);
        });
      }

      if (unlockMine) {
        unlockMine.addEventListener("click", () => {
          if (this.mineLevel === 0) {
            if (this.gems < MINE_UNLOCK_COST_GEMS) return;
            if (this.botCount < MINE_MIN_BOTS) return;
            this.gems -= MINE_UNLOCK_COST_GEMS;
            this.mineLevel = 1;
            this.ach.unlock("unlock_mine");
            this._save(true);
          } else if (this.mineLevel === 1) {
            if (this.gems < 10 || this.gold < 200) return;
            this.gems -= 10;
            this.gold -= 200;
            this.mineLevel = 2;
            this.ach.unlock("mine_level_2");
            this._save(true);
          }
        });
      }

      if (boostEfficiency) {
        boostEfficiency.addEventListener("click", () => {
          if (this.mineLevel === 0) return;
          if (this.gems < EFFICIENCY_BOOST_COST_GEMS) return;
          this.gems -= EFFICIENCY_BOOST_COST_GEMS;
          this.efficiencyBoostTimer = EFFICIENCY_BOOST_SECONDS;
          this.ach.unlock("efficiency_boost");
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

      if (toggleWood) {
        toggleWood.addEventListener("click", () => {
          this.shipFilterWood = !this.shipFilterWood;
          this._save(true);
        });
      }

      if (toggleStone) {
        toggleStone.addEventListener("click", () => {
          this.shipFilterStone = !this.shipFilterStone;
          this._save(true);
        });
      }

      if (goodsTypeWood) goodsTypeWood.addEventListener("click", () => {
          this.goodsType = "wood";
          for (const b of this.bots) if (b.job === "GOODS") { b.inventoryWood = 0; b.inventoryStone = 0; b.state = "SEEK"; }
      });
      if (goodsTypeStone) goodsTypeStone.addEventListener("click", () => {
          this.goodsType = "stone";
          for (const b of this.bots) if (b.job === "GOODS") { b.inventoryWood = 0; b.inventoryStone = 0; b.state = "SEEK"; }
      });

      const mineSlider = document.getElementById("mineSlider");
      const goodsSlider = document.getElementById("goodsSlider");
      if (mineSlider) {
        mineSlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10);
          if (val + this.goodsAllocationTarget > this.botCount) {
              this.goodsAllocationTarget = Math.max(0, this.botCount - val);
          }
          this.mineAllocationTarget = val;
          this._save(true);
        });
      }
      if (goodsSlider) {
        goodsSlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10);
          if (val + this.mineAllocationTarget > this.botCount) {
              this.mineAllocationTarget = Math.max(0, this.botCount - val);
          }
          this.goodsAllocationTarget = val;
          this._save(true);
        });
      }

      this.visual.renderer.domElement.addEventListener("click", (e) => {
        const hit = this.visual.pickWorldPoint(e.clientX, e.clientY);
        if (!hit) return;
        
        if (dist({x: hit.x, y: hit.y}, {x: 80, y: 80}) < 150) return; // protect factory area from all clicks

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

      window.addEventListener("beforeunload", () => {
        if (!this._isResetting) this._save(true);
      });
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
          
          if (typeof data.mineLevel === "number") this.mineLevel = data.mineLevel;
          else if (data.mineUnlocked) this.mineLevel = 1;
          else this.mineLevel = 0;

          this.efficiencyBoostTimer = clamp(Number(data.efficiencyBoostTimer ?? 0) || 0, 0, 999999);

          this.portStorage.wood = Number(data.portStorage?.wood ?? 0) || 0;
          this.portStorage.stone = Number(data.portStorage?.stone ?? 0) || 0;
          this.portStorage.goodsWood = Number(data.portStorage?.goodsWood ?? 0) || 0;
          this.portStorage.goodsStone = Number(data.portStorage?.goodsStone ?? 0) || 0;
          this.botCount = clamp(Number(data.botCount ?? 1) || 1, 1, BOT_MAX);
          this.shipCount = clamp(Number(data.shipLevel ?? data.shipCount ?? 1) || 1, 1, 7);
          this.shipCapacityLevel = clamp(Number(data.shipCapacityLevel ?? 1) || 1, 1, 7);
          this.shipTrips = clamp(Number(data.shipTrips ?? 0) || 0, 0, 999999);
          this.pendingBots = Number(data.pendingBots) || 0;
          if (Array.isArray(data.deliveries)) {
            this.deliveries = data.deliveries;
          }
          this.mineAllocationTarget = clamp(Number(data.mineAllocationTarget ?? 0) || 0, 0, MINE_MAX_BOTS);

          if (Array.isArray(data.achievements)) this.ach.load(data.achievements);

          if (typeof data.shipFilterWood === "boolean") this.shipFilterWood = data.shipFilterWood;
          if (typeof data.shipFilterStone === "boolean") this.shipFilterStone = data.shipFilterStone;

          this.goodsUnlocked = !!data.goodsUnlocked;
          this.goodsAllocationTarget = clamp(Number(data.goodsAllocationTarget ?? 0) || 0, 0, 10);
          if (data.goodsType === "wood" || data.goodsType === "stone") this.goodsType = data.goodsType;
          this.pickupBoxes = Number(data.pickupBoxes ?? 0) || 0;
          if (data.truck) this.truck = data.truck;

          if (Array.isArray(data.botJobs)) {
             this._savedBotJobs = data.botJobs;
          }
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
            ship.loadGoodsWood = clamp(Number(s.loadGoodsWood ?? 0) || 0, 0, ship.capacity);
            ship.loadGoodsStone = clamp(Number(s.loadGoodsStone ?? 0) || 0, 0, ship.capacity);
            const validStates = new Set(["Waiting", "Loading", "Departing", "Traveling", "Returning"]);
            if (validStates.has(s.state)) ship.state = s.state;
            ship.timer = clamp(Number(s.timer ?? 0) || 0, 0, 999999);
            ship.halfTripSeconds = 30;
            this.ships.push(ship);
          }
        } else if (data.ship) {
          try {
            const s = data.ship;
            const cap = SHIP_CAPACITY_BY_LEVEL[this.shipCapacityLevel] || 10;
            const ship = new Ship(cap, this.rng);
            ship.loadWood = clamp(Number(s.loadWood ?? 0) || 0, 0, ship.capacity);
            ship.loadStone = clamp(Number(s.loadStone ?? 0) || 0, 0, ship.capacity);
            ship.loadGoodsWood = clamp(Number(s.loadGoodsWood ?? 0) || 0, 0, ship.capacity);
            ship.loadGoodsStone = clamp(Number(s.loadGoodsStone ?? 0) || 0, 0, ship.capacity);
            const validStates = new Set(["Waiting", "Loading", "Departing", "Traveling", "Returning"]);
            if (validStates.has(s.state)) ship.state = s.state;
            ship.timer = clamp(Number(s.timer ?? 0) || 0, 0, 999999);
            ship.halfTripSeconds = 30;
            ship.timer = Math.min(ship.timer, 30);
            this.ships = [ship];
            this._syncShips();
          } catch { 
            // ignore broken saves
          }
        }
      } catch (err) {
        console.warn("Failed to load save", err);
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
        mineLevel: this.mineLevel,
        efficiencyBoostTimer: this.efficiencyBoostTimer,
        shipTrips: Math.floor(this.shipTrips),

        botCount: Math.floor(this.botCount),
        pendingBots: Math.floor(this.pendingBots),
        deliveries: this.deliveries,
        mineAllocationTarget: this.mineAllocationTarget,
        shipFilterWood: this.shipFilterWood,
        shipFilterStone: this.shipFilterStone,
        goodsUnlocked: this.goodsUnlocked,
        goodsAllocationTarget: this.goodsAllocationTarget,
        goodsType: this.goodsType,
        pickupBoxes: this.pickupBoxes,
        truck: this.truck,
        shipCount: Math.floor(this.shipCount),
        shipCapacityLevel: Math.floor(this.shipCapacityLevel),
        portStorage: { ...this.portStorage },
        port: { x: this.port.x, y: this.port.y },
        ships: this.ships.map(s => ({
          capacity: s.capacity,
          loadWood: s.loadWood,
          loadStone: s.loadStone,
          loadGoodsWood: s.loadGoodsWood,
          loadGoodsStone: s.loadGoodsStone,
          state: s.state,
          timer: s.timer,
          halfTripSeconds: s.halfTripSeconds,
        })),
        nodes: this.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, amount: n.amount })),
        achievements: this.ach.export(),
        botJobs: this.bots.map(b => b.job),
      };

      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      } catch {
        // ignore quota errors
      }
    }

    _pickTargetNode(bot) {
      const desired = bot.job === "GOODS" ? this.goodsType : bot.preferred;
      let best = null;
      let bestD = Infinity;
      for (const n of this.nodes) {
        if (n.amount <= 0) continue;
        if (bot.job === "GOODS" && n.type !== desired) continue;
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
      
      if (entity.rotation !== undefined) {
         if (Math.hypot(dir.x, dir.y) > 0.01) {
            entity.rotation = Math.PI / 2 - Math.atan2(dir.y, dir.x);
         }
      }
    }

    _updateGoldMine(dt) {
      if (this.mineLevel === 0) return;
      if (this.efficiencyBoostTimer > 0) this.efficiencyBoostTimer = Math.max(0, this.efficiencyBoostTimer - dt);
      const bots = this.miningBots();
      if (bots <= 0) return;
      const mult = this.efficiencyMultiplier();
      const goldPerSecondPerBot = (MINE_GOLD_PER_HOUR_PER_BOT * this.mineLevel) / MINE_TEST_HOUR_SECONDS;
      this.gold += bots * goldPerSecondPerBot * mult * dt;
      if (this.gold >= 1000) this.ach.unlock("gold_1000");
      if (this.gold >= 5000) this.ach.unlock("gold_5000");
    }

    update(dt) {
      if (this.paused) return;

      // Goods Factory Delivery Truck
      if (this.goodsUnlocked) {
          const tSpeed = 120;
          if (this.truck.state === "IDLE") {
              if (this.pickupBoxes >= this.goodsAllocationTarget && this.goodsAllocationTarget > 0) {
                  this.truck.state = "TO_PICKUP";
              }
          } else if (this.truck.state === "TO_PICKUP") {
              const target = { x: this.port.x - 80, y: this.port.y };
              if (dist(this.truck, target) < 5) {
                  this.truck.boxes = this.pickupBoxes;
                  this.pickupBoxes = 0;
                  this.truck.type = this.goodsType;
                  this.truck.state = "TO_FACTORY";
              } else this._moveTowards(this.truck, target.x, target.y, tSpeed, dt);
          } else if (this.truck.state === "TO_FACTORY") {
              const target = { x: 170, y: 80 };
              if (dist(this.truck, target) < 5) {
                  this.truck.state = "PROCESSING";
                  this.truck.timer = 10.0;
              } else this._moveTowards(this.truck, target.x, target.y, tSpeed, dt);
          } else if (this.truck.state === "PROCESSING") {
              this.truck.timer -= dt;
              if (this.truck.timer <= 0) {
                  this.truck.load = this.truck.boxes * 5;
                  this.truck.boxes = 0;
                  this.truck.state = "TO_PORT_DROPOFF";
              }
          } else if (this.truck.state === "TO_PORT_DROPOFF") {
              const target = { x: this.port.x - 80, y: this.port.y };
              if (dist(this.truck, target) < 5) {
                  if (this.truck.type === "wood") {
                      this.portStorage.goodsWood += this.truck.load;
                      if (this.portStorage.goodsWood >= 100) this.ach.unlock("goods_wood_100");
                  } else {
                      this.portStorage.goodsStone += this.truck.load;
                      if (this.portStorage.goodsStone >= 100) this.ach.unlock("goods_stone_100");
                  }
                  this.truck.load = 0;
                  this.truck.state = "RETURN_FACTORY";
                  this.visual.addFloater(`Dropped Goods!`, '#22c55e', this.truck.x, 30, this.truck.y);
              } else this._moveTowards(this.truck, target.x, target.y, tSpeed, dt);
          } else if (this.truck.state === "RETURN_FACTORY") {
              const target = { x: 170, y: 80 };
              if (dist(this.truck, target) < 5) this.truck.state = "IDLE";
              else this._moveTowards(this.truck, target.x, target.y, tSpeed, dt);
          }
      }

      if (this.mineLevel > 0) {
        let mineAssigned = this.bots.filter(b => b.job === "MINE").length;

        if (mineAssigned < this.mineAllocationTarget) {
            const b = this.bots.find(b => (!b.job || b.job === "BASIC") && ["SEEK", "IDLE", "TO_NODE", "HARVEST", "TO_PORT"].includes(b.state));
            if (b) {
                b.job = "MINE";
                b.state = "TO_MINE";
                b.targetNodeId = null;
                b.inventoryWood = 0;
                b.inventoryStone = 0;
            }
        } else if (mineAssigned > this.mineAllocationTarget) {
            let b = this.bots.find(b => b.job === "MINE" && b.state === "TO_MINE");
            if (!b) b = this.bots.find(b => b.job === "MINE" && b.state === "WAITING_BOAT");
            if (!b) b = this.bots.find(b => b.job === "MINE" && b.state === "IN_MINE");
            if (b) {
                if (b.state === "IN_MINE") b.state = "LEAVING_MINE";
                else { b.job = "BASIC"; b.state = "SEEK"; }
            }
        }

        let waitingCount = this.bots.filter(b => b.state === "WAITING_BOAT").length;
        let incomingOutCapacity = this.deliveries.filter(d => d.type === "MINE_OUT" && d.phase === "IN").reduce((sum, d) => sum + 2, 0);
        if (waitingCount > incomingOutCapacity) this.deliveries.push({ type: "MINE_OUT", t: 0, phase: "IN", count: 0 });

        let leavingCount = this.bots.filter(b => b.state === "LEAVING_MINE").length;
        let incomingInCapacity = this.deliveries.filter(d => d.type === "MINE_IN" && d.phase === "IN").reduce((sum, d) => sum + 2, 0);
        if (leavingCount > incomingInCapacity) {
            const toCarry = Math.min(2, leavingCount - incomingInCapacity);
            let boarded = 0;
            for(const b of this.bots) {
                if (b.state === "LEAVING_MINE" && b.job === "MINE" && boarded < toCarry) {
                    b.state = "IN_BOAT";
                    boarded++;
                }
            }
            this.deliveries.push({ type: "MINE_IN", t: 0, phase: "IN", count: boarded });
        }
      }

      if (this.goodsUnlocked) {
          let goodsAssigned = this.bots.filter(b => b.job === "GOODS").length;
          if (goodsAssigned < this.goodsAllocationTarget) {
              const b = this.bots.find(b => (!b.job || b.job === "BASIC") && ["SEEK", "IDLE", "TO_NODE", "HARVEST", "TO_PORT"].includes(b.state));
              if (b) {
                  b.job = "GOODS";
                  b.state = "SEEK";
                  b.inventoryWood = 0;
                  b.inventoryStone = 0;
              }
          } else if (goodsAssigned > this.goodsAllocationTarget) {
              const b = this.bots.find(b => b.job === "GOODS");
              if (b) {
                  b.job = "BASIC";
                  b.state = "SEEK";
              }
          }
      }

      let basicBots = this.bots.filter(b => !b.job || b.job === "BASIC");
      for (let i = 0; i < basicBots.length; i++) {
          basicBots[i].preferred = i % 2 === 0 ? "wood" : "stone";
      }

      for (let i = this.deliveries.length - 1; i >= 0; i--) {
        const d = this.deliveries[i];
        d.t += dt;
        if (d.phase === 'IN' && d.t >= 6.0) {
          d.phase = 'OUT';
          d.t = 0;
          if (!d.type) d.type = "BUY";

          if (d.type === "BUY") {
            this.pendingBots = Math.max(0, this.pendingBots - 1);
            this._syncBots();
            this.visual.addFloater("Worker Arrived!", "#3b82f6", this.port.x, 40, this.port.y);
          } else if (d.type === "MINE_OUT") {
            let picked = 0;
            for(const b of this.bots) {
                if (b.state === "WAITING_BOAT" && picked < 2) {
                    b.state = "IN_BOAT";
                    picked++;
                }
            }
            d.count = picked; 
          } else if (d.type === "MINE_IN") {
            let dropped = 0;
            for(const b of this.bots) {
                if (b.state === "IN_BOAT" && b.job === "MINE" && dropped < d.count) {
                    b.job = "BASIC";
                    b.state = "SEEK"; 
                    b.x = this.port.x;
                    b.y = this.port.y;
                    dropped++;
                }
            }
            d.count = 0; 
            this.visual.addFloater("Worker Returned!", "#3b82f6", this.port.x, 40, this.port.y);
          }
        } else if (d.phase === 'OUT' && d.t >= 6.0) {
          if (!d.type) d.type = "BUY";
          if (d.type === "MINE_OUT") {
            let arrived = 0;
            for(const b of this.bots) {
                if (b.state === "IN_BOAT" && arrived < d.count) {
                    b.state = "IN_MINE";
                    arrived++;
                }
            }
          }
          this.deliveries.splice(i, 1);
        }
      }

      for (const bot of this.bots) bot.snapshotPrev();

      for (const bot of this.bots) {
        const carryLimit = bot.job === "GOODS" ? 5 : BOT_CARRY;
        if (bot.inventoryCount() >= carryLimit && bot.state !== "TO_PORT") {
          bot.state = "TO_PORT";
          bot.targetNodeId = null;
        }

        if (bot.state === "SEEK") {
          const node = this._pickTargetNode(bot);
          bot.state = node ? "TO_NODE" : "IDLE";
          continue;
        }

        if (bot.state === "TO_MINE") {
          const d = dist(bot, this.port);
          if (d <= this.port.radius + 12) {
            bot.state = "WAITING_BOAT";
            continue;
          }
          this._moveTowards(bot, this.port.x, this.port.y, BOT_SPEED, dt);
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
            if (bot.inventoryCount() >= carryLimit) {
              bot.state = "TO_PORT";
              bot.targetNodeId = null;
            }

            if (node.amount <= 0) {
              const margin = 60;
              let nx, ny;
              do {
                nx = lerp(margin, this.width - margin, this.rng());
                ny = lerp(margin, this.height - margin, this.rng());
              } while (dist({x: nx, y: ny}, {x: 80, y: 80}) < 150); // protect factory
              node.x = nx;
              node.y = ny;
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
            if (bot.job === "GOODS") {
               this.visual.addFloater(`Box Ready!`, '#fbbf24', this.port.x, 20, this.port.y);
               this.pickupBoxes++;
            } else {
               this.visual.addFloater(`+${bot.inventoryCount()}`, bot.inventoryWood > 0 ? '#fb923c' : '#9ca3af', this.port.x, 20, this.port.y);
               this.portStorage.wood += bot.inventoryWood;
               this.portStorage.stone += bot.inventoryStone;
            }
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
      if (this.money >= 10000) this.ach.unlock("money_10000");
      if (this.money >= 100000) this.ach.unlock("money_100000");
      if (this.money >= 1000000) this.ach.unlock("money_1000000");

      if (this.portStorage.wood + this.portStorage.stone >= 1000) this.ach.unlock("storage_1000");
    }

    _shipDrawPosition(ship, index) {
      const atPort = this._shipBerthPosition(index);
      const angle = (index * (Math.PI * 2) / 7);
      const radius = Math.max(this.width, this.height) + 200;
      const off = {
        x: this.port.x + Math.cos(angle) * radius,
        y: this.port.y + Math.sin(angle) * radius
      };

      if (ship.state === "Traveling") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        return this._shipBezier(atPort, off, t);
      }
      if (ship.state === "Returning") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        return this._shipBezier(off, atPort, t);
      }
      return atPort;
    }

    _shipBerthPosition(index) {
      const angle = (index * (Math.PI * 2) / 7);
      const radius = 65; // Radial distance from port center
      let bx = this.port.x + Math.cos(angle) * radius;
      let by = this.port.y + Math.sin(angle) * radius;

      let closest = null;
      let closestD = Infinity;
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - bx, n.y - by);
        if (d < closestD) {
          closestD = d;
          closest = n;
        }
      }
      const safe = 60;
      if (closest && closestD < safe) {
        const dx = bx - closest.x;
        const dy = by - closest.y;
        const dir = normalize(dx, dy);
        const push = safe - closestD + 10;
        bx += dir.x * push;
        by += dir.y * push;
      }

      bx = clamp(bx, 20, this.width - 20);
      by = clamp(by, 20, this.height - 20);
      return { x: bx, y: by };
    }

    _shipVelocity(ship, index) {
      const atPort = this._shipBerthPosition(index);
      const angle = (index * (Math.PI * 2) / 7);
      const radius = Math.max(this.width, this.height) + 200;
      const off = {
        x: this.port.x + Math.cos(angle) * radius,
        y: this.port.y + Math.sin(angle) * radius
      };

      const getVel = (start, end, t) => {
        const p1 = this._shipBezier(start, end, Math.max(0, t - 0.01));
        const p2 = this._shipBezier(start, end, Math.min(1, t + 0.01));
        return { dx: p2.x - p1.x, dy: p2.y - p1.y };
      };

      if (ship.state === "Traveling") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        return getVel(atPort, off, t);
      } else if (ship.state === "Returning") {
        const t = 1 - clamp(ship.timer / ship.halfTripSeconds, 0, 1);
        return getVel(off, atPort, t);
      }
      return { dx: off.x - atPort.x, dy: off.y - atPort.y };
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
        mineStatus,
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
        statusLine,
        unlockGoods,
        goodsPanel,
        goodsStatus,
        goodsTypeWood,
        goodsTypeStone,
        portGoodsWood,
        portGoodsStone,
        toggleWood,
        toggleStone,

        chipMoney,
        chipGems,
        chipGold,
        chipBots,
        chipShip,
        chipStorage,
      } = this.ui;

      portWood.textContent = String(Math.floor(this.portStorage.wood));
      portStone.textContent = String(Math.floor(this.portStorage.stone));

      let loadWood = 0, loadStone = 0, loadGoodsWood = 0, loadGoodsStone = 0;
      for (const s of this.ships) {
        loadWood += s.loadWood;
        loadStone += s.loadStone;
        loadGoodsWood += s.loadGoodsWood;
        loadGoodsStone += s.loadGoodsStone;
      }
      const totalLoad = loadWood + loadStone + loadGoodsWood + loadGoodsStone;
      const totalCap = this.ships.reduce((sum, s) => sum + s.capacity, 0);
      
      let minTime = Infinity;
      for (const s of this.ships) {
        if (s.state === "Traveling" || s.state === "Returning") {
          if (s.timer < minTime) minTime = s.timer;
        }
      }

      const priceHint = document.getElementById("priceHint");
      if (priceHint) priceHint.textContent = `Prices: Wood $${PRICES.wood} - Stone $${PRICES.stone}`;
      const sellGoldMeta = document.getElementById("sellGoldMeta");
      if (sellGoldMeta) sellGoldMeta.textContent = `($${GOLD_VALUE} each)`;

      shipState.textContent = `${this.ships.length} Ships Active`;
      const value = loadWood * PRICES.wood + loadStone * PRICES.stone + loadGoodsWood * PRICES.goodsWood + loadGoodsStone * PRICES.goodsStone;
      shipLoad.textContent = `Total Load: ${totalLoad} / ${totalCap} (W:${loadWood}, S:${loadStone}, pW:${loadGoodsWood}, pS:${loadGoodsStone}) - Value: $${value.toLocaleString()}`;
      shipTimer.textContent = minTime === Infinity ? "--:--" : formatTimer(minTime);
      shipMeta.textContent = `Ships: ${this.shipCount}/7 • Cap Lv: ${this.shipCapacityLevel}/10`;

      const nextBot = this.nextBotCost();
      if (buyBotCost) buyBotCost.textContent = nextBot === null ? "MAX LEVEL" : formatMoney(nextBot);
      if (buyBot) buyBot.disabled = nextBot === null || this.money < nextBot;

      const formatShipCost = (c) => c === null ? "MAX LEVEL" : `$${c.money.toLocaleString()} | ${c.wood}W | ${c.stone}S`;

      const shipBuy = this.buyShipCost();
      if (buyShipCost) buyShipCost.textContent = formatShipCost(shipBuy);
      if (buyShip) buyShip.disabled = shipBuy === null || this.money < shipBuy.money || this.portStorage.wood < shipBuy.wood || this.portStorage.stone < shipBuy.stone;

      const capUpg = this.capacityUpgradeCost();
      if (upgradeShipCost) upgradeShipCost.textContent = formatShipCost(capUpg);
      if (upgradeShip) upgradeShip.disabled = capUpg === null || this.money < capUpg.money || this.portStorage.wood < capUpg.wood || this.portStorage.stone < capUpg.stone;

      const unlockMineCost = document.getElementById("unlockMineCost");
      if (unlockMine && unlockMineCost) {
        if (this.mineLevel === 0) {
          unlockMine.firstChild.nodeValue = "Unlock Mine ";
          unlockMineCost.textContent = `(${MINE_UNLOCK_COST_GEMS} gems)`;
          unlockMine.disabled = this.gems < MINE_UNLOCK_COST_GEMS || this.botCount < MINE_MIN_BOTS;
        } else if (this.mineLevel === 1) {
          unlockMine.firstChild.nodeValue = "Upgrade Mine ";
          unlockMineCost.textContent = `(10 gems, 200 gold)`;
          unlockMine.disabled = this.gems < 10 || this.gold < 200;
        } else {
          unlockMine.firstChild.nodeValue = "Mine Maxed ";
          unlockMineCost.textContent = "";
          unlockMine.disabled = true;
        }
      }

      if (boostEfficiency) boostEfficiency.disabled = this.mineLevel === 0 || this.gems < EFFICIENCY_BOOST_COST_GEMS;
      if (sellGold) sellGold.disabled = Math.floor(this.gold) <= 0;

      const miningBots = this.miningBots();
      const mult = this.efficiencyMultiplier();
      if (mineStatus) {
        if (this.mineLevel === 0) mineStatus.textContent = `Locked. Requires ${MINE_MIN_BOTS} workers.`;
        else if (miningBots <= 0) mineStatus.textContent = `Unlocked (Lv ${this.mineLevel}). Allocate workers below. (Max ${MINE_MAX_BOTS})`;
        else {
          const boost = this.efficiencyBoostTimer > 0 ? ` • Boost: ${formatTimer(this.efficiencyBoostTimer)}` : "";
          mineStatus.textContent = `Generating gold (Lv ${this.mineLevel}) • Efficiency: ${mult}x${boost}`;
        }
      }

      const mineSlider = document.getElementById("mineSlider");
      const mineAllocationLabel = document.getElementById("mineAllocationLabel");
      if (mineSlider) {
        mineSlider.disabled = this.mineLevel === 0;
        mineSlider.max = MINE_MAX_BOTS;
        if (parseInt(mineSlider.value, 10) !== this.mineAllocationTarget && document.activeElement !== mineSlider) {
            mineSlider.value = this.mineAllocationTarget;
        }
      }
      if (mineAllocationLabel) {
        mineAllocationLabel.textContent = this.mineAllocationTarget;
      }

      const goodsSlider = document.getElementById("goodsSlider");
      const goodsAllocationLabel = document.getElementById("goodsAllocationLabel");
      if (goodsSlider) {
        goodsSlider.max = 10;
        if (parseInt(goodsSlider.value, 10) !== this.goodsAllocationTarget && document.activeElement !== goodsSlider) {
            goodsSlider.value = this.goodsAllocationTarget;
        }
      }
      if (goodsAllocationLabel) goodsAllocationLabel.textContent = this.goodsAllocationTarget;

      if (goodsPanel) goodsPanel.style.display = this.goodsUnlocked ? "block" : "none";
      if (goodsStatus) goodsStatus.style.display = this.goodsUnlocked ? "none" : "block";
      if (unlockGoods) {
          unlockGoods.style.display = this.goodsUnlocked ? "none" : "inline-block";
          unlockGoods.disabled = this.money < 20000;
      }
      if (goodsTypeWood) goodsTypeWood.className = this.goodsType === "wood" ? "btn btn--blue" : "btn btn--ghost";
      if (goodsTypeStone) goodsTypeStone.className = this.goodsType === "stone" ? "btn btn--blue" : "btn btn--ghost";
      if (portGoodsWood) portGoodsWood.textContent = `${Math.floor(this.portStorage.goodsWood)} Processed`;
      if (portGoodsStone) portGoodsStone.textContent = `${Math.floor(this.portStorage.goodsStone)} Processed`;

      if (statusLine) statusLine.textContent = this.statusText;

      if (toggleWood) {
        toggleWood.textContent = this.shipFilterWood ? "ON" : "OFF";
        toggleWood.style.background = this.shipFilterWood ? "#22c55e" : "#ef4444";
      }
      if (toggleStone) {
        toggleStone.textContent = this.shipFilterStone ? "ON" : "OFF";
        toggleStone.style.background = this.shipFilterStone ? "#22c55e" : "#ef4444";
      }

      const fBar = document.getElementById("factoryBar");
      const fBarInner = document.getElementById("factoryBarInner");
      if (fBar && fBarInner && this.goodsUnlocked && this.truck.state === "PROCESSING") {
          fBar.style.display = "block";
          const pct = clamp(1 - (this.truck.timer / 10), 0, 1) * 100;
          fBarInner.style.width = `${pct}%`;
          const vec = new THREE.Vector3(80, 80, 80).project(this.visual.camera);
          const rect = this.visual.containerEl.getBoundingClientRect();
          const x = (vec.x * 0.5 + 0.5) * rect.width + window.scrollX + rect.left;
          const y = (vec.y * -0.5 + 0.5) * rect.height + window.scrollY + rect.top;
          fBar.style.left = `${x - 30}px`;
          fBar.style.top = `${y - 10}px`;
      } else if (fBar) {
          fBar.style.display = "none";
      }

      chipMoney.textContent = formatMoney(this.money);
      chipGems.textContent = String(Math.floor(this.gems));
      chipGold.textContent = String(Math.floor(this.gold));
      chipBots.textContent = String(this.botCount);
      chipShip.textContent = `${this.shipCount} Ships (Lv ${this.shipCapacityLevel})`;
      chipStorage.textContent = `${Math.floor(this.portStorage.wood)}W ${Math.floor(this.portStorage.stone)}S`;
    }
  }

  function main() {
    const stageEl = document.getElementById("stage3d");
    const statusLine = document.getElementById("statusLine");
    try {
      const ui = {
        buyBot: document.getElementById("buyBot"),
        buyBotCost: document.getElementById("buyBotCost"),
        buyShip: document.getElementById("buyShip"),
        buyShipCost: document.getElementById("buyShipCost"),
        upgradeShip: document.getElementById("upgradeShip"),
        upgradeShipCost: document.getElementById("upgradeShipCost"),

        mineStatus: document.getElementById("mineStatus"),
        unlockMine: document.getElementById("unlockMine"),
        boostEfficiency: document.getElementById("boostEfficiency"),
        sellGold: document.getElementById("sellGold"),

        unlockGoods: document.getElementById("unlockGoods"),
        goodsPanel: document.getElementById("goodsPanel"),
        goodsStatus: document.getElementById("goodsStatus"),
        goodsTypeWood: document.getElementById("goodsTypeWood"),
        goodsTypeStone: document.getElementById("goodsTypeStone"),

        portWood: document.getElementById("portWood"),
        portStone: document.getElementById("portStone"),
        portGoodsWood: document.getElementById("portGoodsWood"),
        portGoodsStone: document.getElementById("portGoodsStone"),
        toggleWood: document.getElementById("toggleWood"),
        toggleStone: document.getElementById("toggleStone"),

        shipState: document.getElementById("shipState"),
        shipTimer: document.getElementById("shipTimer"),
        shipLoad: document.getElementById("shipLoad"),
        shipMeta: document.getElementById("shipMeta"),
        
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
