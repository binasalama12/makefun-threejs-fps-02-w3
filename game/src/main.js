// Frostline Depot — entry point and simulation core.
// A fixed 60 Hz simulation (rounds, movement, bots, ballistics) is kept
// apart from rendering: the render loop only draws the state the last
// step produced. One match is an endless series of short rounds —
// buy, fight, plant or perish, scoreboard, buy again.
//
// Screenshot mode: ?shot=start|play|end&seed=N stages one still,
// representative frame (buy menu over the depot / a mid-round firefight
// / the end-of-round scoreboard), renders it and sets
// window.__shotReady once the first frame is on screen.

import * as THREE from 'three';
import { WEAPONS, GRENADE, SMOKE, ECONOMY, ROUND, TEAM_PLAYER, TEAM_ENEMY } from './config.js';
import { MAP, createWorld, collide } from './world.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed * 7919 + 13);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaebfd2);
scene.fog = new THREE.Fog(0xb9c9da, 26, 78);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
// Filled in once the grenades module exists (below): a live smoke
// cloud blocks bot sight lines just as it blocks the player's view.
const vision = { blocksVision: null };
const bots = createBots(scene, world, rng, vision);
const audio = createAudio();

// ---------- view-model weapon ----------
const gunGroup = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33414f, roughness: 0.45, metalness: 0.55 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x66d9ff, roughness: 0.4, metalness: 0.3, emissive: 0x1c4b61 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), bodyMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), bodyMat);
  barrel.position.set(0, 0.03, -0.38);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.03, 0.3), accentMat);
  stripe.position.set(0, -0.03, -0.05);
  gunGroup.add(body, barrel, stripe);
  gunGroup.position.set(0.26, -0.24, -0.5);
  camera.add(gunGroup);
}
const muzzle = new THREE.PointLight(0xbfe6ff, 0, 9, 2);
muzzle.position.set(0.26, -0.18, -1.1);
camera.add(muzzle);
let muzzleTime = -1;

// ---------- tracers (pooled lines, no per-shot allocation) ----------
const tracerPool = [];
for (let i = 0; i < 28; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push({ line, until: 0 });
}
let tracerIdx = 0;
function tracer(from, to, team, _hit) {
  const slot = tracerPool[tracerIdx % tracerPool.length];
  tracerIdx += 1;
  const arr = slot.line.geometry.attributes.position.array;
  arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
  arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
  slot.line.geometry.attributes.position.needsUpdate = true;
  slot.line.material.color.set(team === 'ally' || team === 'player' ? 0x9fdcff : 0xffc98a);
  slot.line.material.opacity = 0.9;
  slot.until = simTime + 0.07;
}

// ---------- match state ----------
const S = {
  phase: 'buy', // buy | live | end
  round: 1,
  scoreA: 0,
  scoreB: 0,
  money: ECONOMY.startMoney,
  kills: 0,
  timeLeft: ROUND.liveSeconds,
  phaseTimer: 0,
  planted: false,
  fuse: 0,
  plantProgress: 0,
  defuseProgress: 0,
  grenades: 1,
  smokes: 1,
  owned: ['nixie'],
  current: 'nixie',
  ammo: {}, // weaponId -> {mag, reserve}
  bloom: 0,
  nextShot: 0,
  reloadingUntil: 0,
  frozen: !!shotMode,
};
for (const w of WEAPONS) S.ammo[w.id] = { mag: w.mag, reserve: w.reserve };
const weaponDef = () => WEAPONS.find((w) => w.id === S.current);

// ---------- player body ----------
const player = {
  pos: MAP.playerSpawn.clone(),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  hp: 100, alive: true,
  eye: 1.62, crouching: false, grounded: true,
  speed: 0,
  recoilPitch: 0,
};
const playerFeet = player.pos; // bots read this vector directly

// ---------- HUD ----------
const hud = createHud({
  onBuy: (id) => buyWeapon(id),
  onBuyGrenade: () => buyGrenade(),
  onBuySmoke: () => buySmoke(),
  onDeploy: () => deploy(),
});
function refreshHud() {
  const w = weaponDef();
  const a = S.ammo[S.current];
  hud.setHp(player.hp);
  hud.setMoney(S.money);
  hud.setScore(S.scoreA, S.scoreB);
  hud.setAmmo(a.mag, a.reserve, w.name);
  hud.setGrenades(S.grenades, S.smokes);
  hud.setRound(S.round, S.phase === 'buy' ? 'BUY PHASE' : S.phase === 'end' ? 'ROUND OVER' : S.planted ? 'CHARGE PLANTED' : 'LIVE');
  hud.setAlive(bots.allies.filter((b) => b.alive).length + (player.alive ? 1 : 0), bots.enemies.filter((b) => b.alive).length);
}

// ---------- economy ----------
function buyWeapon(id) {
  const w = WEAPONS.find((x) => x.id === id);
  if (!w || S.owned.includes(id) || S.money < w.price) { audio.denied(); return; }
  S.money -= w.price;
  S.owned.push(id);
  S.current = id;
  S.ammo[id] = { mag: w.mag, reserve: w.reserve };
  audio.buy();
  hud.feed(`Bought ${w.name} for $${w.price}`);
  hud.renderBuy(S);
  refreshHud();
}
function buyGrenade() {
  if (S.money < GRENADE.price) { audio.denied(); return; }
  S.money -= GRENADE.price;
  S.grenades += 1;
  audio.buy();
  hud.renderBuy(S);
  refreshHud();
}
function buySmoke() {
  if (S.money < SMOKE.price) { audio.denied(); return; }
  S.money -= SMOKE.price;
  S.smokes += 1;
  audio.buy();
  hud.renderBuy(S);
  refreshHud();
}

// ---------- input ----------
const keys = new Set();
let firing = false;
let firePressed = false;
let locked = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  keys.add(e.code);
  if (shotMode) return;
  if (S.phase === 'buy') {
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (idx >= 0) buyWeapon(WEAPONS[idx].id);
    if (e.code === 'Digit6') buyGrenade();
    if (e.code === 'Digit7') buySmoke();
    if (e.code === 'Enter') deploy();
    return;
  }
  if (S.phase !== 'live') return;
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (idx >= 0 && S.owned.includes(WEAPONS[idx].id)) { S.current = WEAPONS[idx].id; refreshHud(); }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyH') throwSmoke();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
renderer.domElement.addEventListener('mousedown', (e) => {
  if (shotMode) return;
  if (S.phase === 'buy') { deploy(); return; }
  if (!locked) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) { firing = true; firePressed = true; }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) audio.unlock();
});
window.addEventListener('mousemove', (e) => {
  if (!locked || shotMode) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch -= e.movementY * 0.0021;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
});

function deploy() {
  if (shotMode || S.phase !== 'buy') return;
  hud.hideBuy();
  renderer.domElement.requestPointerLock();
  startLive();
}

// ---------- rounds ----------
function startBuy() {
  S.phase = 'buy';
  S.planted = false;
  S.fuse = 0;
  S.plantProgress = 0;
  S.defuseProgress = 0;
  world.chargeMesh.visible = false;
  player.hp = 100;
  player.alive = true;
  player.pos.copy(MAP.playerSpawn);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = 0;
  bots.reset();
  grenades.clear();
  for (const w of WEAPONS) if (S.owned.includes(w.id)) S.ammo[w.id] = { mag: w.mag, reserve: w.reserve };
  hud.hideEnd();
  hud.showBuy();
  hud.renderBuy(S);
  hud.message('', '');
  hud.setObjective('Plant the charge at the fuel silo');
  refreshHud();
}
function startLive() {
  S.phase = 'live';
  S.timeLeft = ROUND.liveSeconds;
  hud.hideBuy();
  hud.message(`Round ${S.round}`, 'Wipe the Soot Syndicate — or plant at the silo');
  setTimeout(() => { if (S.phase === 'live') hud.message('', ''); }, 2600);
  refreshHud();
}
function endRound(won, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'end';
  S.phaseTimer = ROUND.endSeconds;
  if (won) { S.scoreA += 1; S.money = Math.min(ECONOMY.maxMoney, S.money + ECONOMY.winReward); audio.roundWin(); }
  else { S.scoreB += 1; S.money = Math.min(ECONOMY.maxMoney, S.money + ECONOMY.lossReward); audio.roundLose(); }
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showEnd({
    title: won ? `${TEAM_PLAYER} take the round` : `${TEAM_ENEMY} take the round`,
    reason, scoreA: S.scoreA, scoreB: S.scoreB, kills: S.kills, money: S.money,
  });
  refreshHud();
}

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _from = new THREE.Vector3();
const _burstPos = new THREE.Vector3();
function currentSpread() {
  const w = weaponDef();
  let factor = 1 + player.speed * 0.38; // moving opens the cone up
  if (player.crouching) factor *= 0.55; // crouched and planted = tight
  if (!player.grounded) factor *= 1.6;
  if (keys.has('ShiftLeft')) factor *= 1.25;
  return w.spread * factor + S.bloom;
}
function startReload() {
  const w = weaponDef();
  const a = S.ammo[S.current];
  if (a.mag >= w.mag || a.reserve <= 0 || simTime < S.reloadingUntil) return;
  S.reloadingUntil = simTime + w.reloadMs / 1000;
  audio.reloadStart();
}
function finishReload() {
  const w = weaponDef();
  const a = S.ammo[S.current];
  const take = Math.min(w.mag - a.mag, a.reserve);
  a.mag += take;
  a.reserve -= take;
  audio.reloadEnd();
  refreshHud();
}
const botKillCtx = {
  onKill(bot) {
    S.money = Math.min(ECONOMY.maxMoney, S.money + ECONOMY.killReward);
    hud.feed(`An ally dropped ${bot.name} · +$${ECONOMY.killReward}`);
    refreshHud();
    checkElimination();
  },
};
function playerShoot() {
  const w = weaponDef();
  const a = S.ammo[S.current];
  if (simTime < S.reloadingUntil) return;
  if (a.mag <= 0) { audio.dryFire(); S.nextShot = simTime + 0.3; startReload(); return; }
  a.mag -= 1;
  S.nextShot = simTime + w.interval;
  S.bloom = Math.min(0.045, S.bloom + w.spread * 0.9);
  audio.shot(1);
  muzzle.intensity = 26;
  muzzleTime = simTime;
  gunGroup.position.z = -0.42;
  player.recoilPitch += w.kick * (0.85 + rng() * 0.3);
  player.pitch += w.kick * 0.55;
  camera.getWorldDirection(_dir);
  _origin.copy(camera.position);
  for (let pellet = 0; pellet < w.pellets; pellet += 1) {
    const spread = currentSpread();
    const d = _dir.clone();
    d.x += (rng() * 2 - 1) * spread;
    d.y += (rng() * 2 - 1) * spread;
    d.z += (rng() * 2 - 1) * spread;
    d.normalize();
    raycaster.set(_origin, d);
    raycaster.far = w.range;
    const hits = raycaster.intersectObjects([...world.shootables, ...bots.hitMeshes], false);
    for (const hit of hits) {
      const bot = hit.object.userData.bot;
      if (bot && !bot.alive) continue; // corpses don't block bullets
      const end = hit.point.clone();
      _from.set(_origin.x, _origin.y - 0.12, _origin.z);
      tracer(_from, end, 'player', !!bot);
      if (bot) {
        const part = hit.object.userData.part;
        const isHead = part === 'head';
        const dmg = w.damage * (isHead ? w.headMult : part === 'legs' ? 0.7 : 1);
        const wasAlive = bot.alive;
        bots.damageBot(bot, dmg, null);
        hud.hitmark(!bot.alive, isHead);
        audio.hit(!bot.alive, isHead);
        if (wasAlive && !bot.alive && bot.team === 'enemy') {
          S.kills += 1;
          S.money = Math.min(ECONOMY.maxMoney, S.money + ECONOMY.killReward);
          hud.feed(isHead
            ? `Headshot — you dropped ${bot.name} · +$${ECONOMY.killReward}`
            : `You dropped ${bot.name} · +$${ECONOMY.killReward}`);
          checkElimination();
        }
      }
      break;
    }
    if (hits.length === 0) {
      _from.set(_origin.x, _origin.y - 0.12, _origin.z);
      tracer(_from, _origin.clone().add(d.multiplyScalar(w.range)), 'player', false);
    }
  }
  refreshHud();
}
function checkElimination() {
  if (S.phase !== 'live') return;
  if (bots.enemies.every((b) => !b.alive)) endRound(true, 'The Soot Syndicate was wiped out in the snow.');
  else if (!player.alive && bots.allies.every((b) => !b.alive) && !S.planted) endRound(false, 'The Frostwardens were wiped out.');
}

// ---------- grenades (module: projectiles, frost burst, smoke) ----------
const grenades = createGrenades(scene, {
  audio,
  time: () => simTime,
  noiseAt: (pos, radius) => bots.noiseAt?.(pos, radius),
  frostBurst(pos) {
    for (const foe of bots.enemies) {
      if (!foe.alive) continue;
      if (foe.group.position.distanceTo(pos) < GRENADE.radius) {
        foe.slowUntil = simTime + GRENADE.slowSeconds;
        bots.damageBot(foe, 15, botKillCtx);
        hud.feed(`Frostpulse caught ${foe.name}`);
      }
    }
  },
});
vision.blocksVision = (a, b) => grenades.blocksVision(a, b);
function throwGrenade() {
  if (S.phase !== 'live' || S.grenades <= 0 || !player.alive) return;
  camera.getWorldDirection(_dir);
  if (grenades.throwFrost(camera.position, _dir)) { S.grenades -= 1; refreshHud(); }
}
function throwSmoke() {
  if (S.phase !== 'live' || S.smokes <= 0 || !player.alive) return;
  camera.getWorldDirection(_dir);
  if (grenades.throwSmoke(camera.position, _dir)) { S.smokes -= 1; refreshHud(); }
}

// ---------- bot combat context ----------
function damagePlayer(dmg) {
  if (!player.alive || S.phase !== 'live') return;
  player.hp -= dmg;
  hud.hurt();
  audio.hurt();
  refreshHud();
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    hud.message('You are down', S.planted ? 'Your crew fights on while the fuse burns…' : '');
    if (!S.planted) checkElimination();
  }
}
const botCtx = {
  get time() { return simTime; },
  player: {
    get pos() { return playerFeet; },
    get alive() { return player.alive; },
    get speed() { return player.speed; },
    get crouching() { return player.crouching; },
  },
  get planted() { return S.planted; },
  siloPos: MAP.siloPos,
  damagePlayer,
  tracer,
  shotSound: (dist) => audio.enemyShot(dist),
  onKill(bot) {
    hud.feed(`${bot.name} went down`);
    checkElimination();
  },
};

// ---------- fixed-step simulation ----------
let simTime = 0;
const STEP = 1 / 60;
function step(dt) {
  simTime += dt;
  world.stepSnow(dt, player.pos);
  for (const slot of tracerPool) if (simTime > slot.until) slot.line.material.opacity = 0;
  if (simTime > muzzleTime + 0.05) muzzle.intensity = 0;
  gunGroup.position.z += (-0.5 - gunGroup.position.z) * Math.min(1, dt * 11);
  S.bloom = Math.max(0, S.bloom - dt * 0.05);
  if (S.reloadingUntil && simTime >= S.reloadingUntil) { S.reloadingUntil = 0; finishReload(); }

  if (S.phase === 'end') {
    S.phaseTimer -= dt;
    if (S.phaseTimer <= 0) { S.round += 1; startBuy(); }
    return;
  }
  if (S.phase !== 'live') return;

  // --- player movement: acceleration, crouch, sprint, one small jump ---
  const want = new THREE.Vector3();
  if (player.alive) {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(player.yaw); const cos = Math.cos(player.yaw);
    want.set(-sin * f + cos * r, 0, -cos * f - sin * r);
    if (want.lengthSq() > 0) want.normalize();
  }
  player.crouching = keys.has('ControlLeft') || keys.has('KeyC');
  const maxSpeed = player.crouching ? 2.2 : keys.has('ShiftLeft') ? 6.4 : 4.6;
  const accel = player.grounded ? 26 : 6;
  player.vel.x += want.x * accel * dt;
  player.vel.z += want.z * accel * dt;
  const drag = player.grounded ? Math.max(0, 1 - dt * 9) : Math.max(0, 1 - dt * 0.6);
  if (want.lengthSq() === 0) { player.vel.x *= drag; player.vel.z *= drag; }
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  if (hSpeed > maxSpeed) { player.vel.x *= maxSpeed / hSpeed; player.vel.z *= maxSpeed / hSpeed; }
  if (keys.has('Space') && player.grounded && player.alive) { player.vel.y = 5.2; player.grounded = false; }
  player.vel.y -= 14 * dt;
  player.pos.addScaledVector(player.vel, dt);
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.grounded = true; }
  collide(world.colliders, player.pos, 0.45);
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  const targetEye = player.crouching ? 1.05 : 1.62;
  player.eye += (targetEye - player.eye) * Math.min(1, dt * 12);

  // --- firing ---
  const w = weaponDef();
  if (player.alive && firing && (w.auto || firePressed) && simTime >= S.nextShot) playerShoot();
  firePressed = false;

  // --- bots ---
  bots.step(dt, botCtx);
  grenades.step(dt);

  // --- objective: plant, fuse, defuse ---
  const distSilo = Math.hypot(player.pos.x - MAP.siloPos.x, player.pos.z - MAP.siloPos.z);
  if (!S.planted && player.alive) {
    if (distSilo < MAP.siloRadius + 0.7 && keys.has('KeyE') && player.speed < 0.6) {
      S.plantProgress += dt / ROUND.plantChannelSeconds;
      hud.channel('Planting the charge…', S.plantProgress);
      if (Math.floor(S.plantProgress * 3) !== Math.floor((S.plantProgress - dt / ROUND.plantChannelSeconds) * 3)) audio.plantBeep();
      if (S.plantProgress >= 1) {
        S.planted = true;
        S.fuse = ROUND.fuseSeconds;
        S.money = Math.min(ECONOMY.maxMoney, S.money + ECONOMY.plantReward);
        world.chargeMesh.visible = true;
        audio.plantBeep(true);
        hud.channel(null);
        hud.message('Charge planted', 'Hold the silo — they are coming to defuse it');
        hud.setObjective('Defend the planted charge');
        setTimeout(() => { if (S.phase === 'live') hud.message('', ''); }, 2400);
        refreshHud();
      }
    } else {
      S.plantProgress = Math.max(0, S.plantProgress - dt * 0.8);
      hud.channel(null);
      if (distSilo < MAP.siloRadius + 0.7) hud.setObjective('Hold E (standing still) to plant the charge');
    }
  }
  if (S.planted) {
    S.fuse -= dt;
    const anyDefusing = bots.enemies.some((b) => b.alive && b.defusing);
    if (anyDefusing) {
      S.defuseProgress += dt / ROUND.defuseChannelSeconds;
      hud.channel('The Soot Syndicate is defusing!', S.defuseProgress);
      if (S.defuseProgress >= 1) { endRound(false, 'The charge was defused at the silo.'); return; }
    } else {
      S.defuseProgress = Math.max(0, S.defuseProgress - dt * 0.25);
      hud.channel(null);
    }
    if (Math.ceil(S.fuse) !== Math.ceil(S.fuse + dt)) audio.plantBeep(S.fuse < 2.2);
    hud.setTimer('💥 ' + Math.max(0, S.fuse).toFixed(1), S.fuse < 3);
    if (S.fuse <= 0) {
      audio.detonate();
      grenades.burst(_burstPos.set(MAP.siloPos.x, 3, MAP.siloPos.z), 9, 0.55, 0.5);
      endRound(true, 'The charge blew the fuel silo sky-high.');
      return;
    }
  } else {
    S.timeLeft -= dt;
    const t = Math.max(0, Math.ceil(S.timeLeft));
    hud.setTimer(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, t <= 15);
    if (S.timeLeft <= 0) { endRound(false, 'Time ran out — the silo still stands.'); return; }
  }
  refreshAliveHud();
}
let aliveTick = 0;
function refreshAliveHud() {
  aliveTick += 1;
  if (aliveTick % 20 === 0) refreshHud();
}

// ---------- camera / render ----------
function syncCamera() {
  const fall = player.alive ? 0 : 0.9;
  camera.position.set(player.pos.x, player.pos.y + player.eye - fall, player.pos.z);
  player.recoilPitch = Math.max(0, player.recoilPitch - 0.0022);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw, player.alive ? 0 : 0.35, 'YXZ');
}
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!S.frozen) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n += 1; }
    if (acc > STEP * 5) acc = 0;
  }
  syncCamera();
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- screenshot staging ----------
function aimCameraAt(x, y, z) {
  const dx = x - camera.position.x;
  const dy = y - (player.pos.y + player.eye);
  const dz = z - camera.position.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.hypot(dx, dy, dz))));
}
function stageShot(mode) {
  hud.hideBuy();
  hud.hideEnd();
  if (mode === 'start') {
    // The buy menu hangs over the depot exactly as a player sees it.
    player.pos.set(1.5, 0, 16.5);
    S.phase = 'buy';
    S.money = 2600;
    aimCameraAt(0, 2.5, -17);
    hud.showBuy();
    hud.renderBuy(S);
    hud.setRound(1, 'BUY PHASE');
  } else if (mode === 'play') {
    // Mid-round: pushed up the east lane, one foe in the open, one ally
    // covering, the silo ahead. Deterministic from the seed.
    S.phase = 'live';
    S.round = 3; S.scoreA = 2; S.scoreB = 1;
    S.money = 3150; player.hp = 76;
    S.owned = ['nixie', 'vela']; S.current = 'vela';
    S.ammo.vela = { mag: 21, reserve: 84 };
    S.grenades = 1;
    S.smokes = 1;
    player.pos.set(4.2, 0, 5.5);
    const [e0, e1, e2, e3] = bots.enemies;
    e0.group.position.set(2.2, 0, -5.5);
    e1.group.position.set(7.5, 0, -9);
    e2.group.position.set(-4, 0, -13);
    e3.group.position.set(0.5, 0, -14.5);
    bots.allies[0].group.position.set(-1.5, 0, 8.5);
    bots.allies[1].group.position.set(9.5, 0, 2);
    for (const b of bots.bots) b.group.lookAt(player.pos.x, 0, player.pos.z);
    syncCamera(); // settle the eye first so the aim below is true
    aimCameraAt(2.2, 1.3, -5.5);
    hud.setTimer('0:47');
    hud.message('', '');
    // One live tracer and a muzzle flash sell the firefight.
    syncCamera();
    const from = new THREE.Vector3();
    camera.getWorldDirection(_dir);
    from.copy(camera.position).addScaledVector(_dir, 0.7); from.y -= 0.12;
    tracer(from, new THREE.Vector3(2.2, 1.25, -5.5), 'player', true);
    for (const slot of tracerPool) slot.until = 1e9;
    muzzle.intensity = 26;
    hud.hitmark(false);
  } else {
    // End: the scoreboard over a depot where the silo charge went off.
    S.phase = 'end';
    S.round = 5; S.scoreA = 3; S.scoreB = 2;
    S.money = 5900; S.kills = 4;
    S.owned = ['nixie', 'vela']; S.current = 'vela';
    player.pos.set(-2.5, 0, 11);
    bots.damageBot(bots.enemies[0], 500, null);
    bots.damageBot(bots.enemies[2], 500, null);
    bots.enemies[1].group.position.set(3, 0, -8);
    world.chargeMesh.visible = true;
    syncCamera();
    aimCameraAt(0, 3, -17);
    hud.showEnd({
      title: `${TEAM_PLAYER} take the round`,
      reason: 'The charge blew the fuel silo sky-high.',
      scoreA: 3, scoreB: 2, kills: 4, money: 5900,
    });
    hud.setTimer('0:00');
  }
  refreshHud();
  syncCamera();
  renderer.render(scene, camera);
  window.__shotReady = true;
}

refreshHud();
if (shotMode) {
  stageShot(shotMode);
  // Keep the staged frame on screen (frozen) for the capture tool.
  (function holdFrame() { requestAnimationFrame(holdFrame); syncCamera(); renderer.render(scene, camera); })();
} else {
  startBuy();
  requestAnimationFrame(frame);
}
