// Frostline Depot — the crews. Each bot is a small state machine:
// patrol a waypoint loop, hold each waypoint a moment to watch the
// lane ahead, and when it has line of sight on a foe it stops,
// strafes a little and fires short bursts. Bots also hear: gunfire
// and explosions in earshot turn them toward the sound and send them
// to investigate the spot. Bots hear the charge get planted and the
// whole Soot Syndicate rushes the silo to defuse.

import * as THREE from 'three';
import { ALLY_NAMES, ENEMY_NAMES } from './config.js';
import { WAYPOINTS, collide } from './world.js';

const ALLY_MAT = {
  suit: new THREE.MeshStandardMaterial({ color: 0x9fc6e8, roughness: 0.8 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xe8f1f8, roughness: 0.8 }),
};
const ENEMY_MAT = {
  suit: new THREE.MeshStandardMaterial({ color: 0x4a4643, roughness: 0.85 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xc96f2e, roughness: 0.8 }),
};
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.5, metalness: 0.5 });

function buildFigure(scene, mats) {
  const group = new THREE.Group();
  const hitMeshes = [];
  function part(geo, mat, x, y, z, kind) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.userData.part = kind;
    group.add(mesh);
    hitMeshes.push(mesh);
    return mesh;
  }
  part(new THREE.BoxGeometry(0.56, 0.75, 0.3), mats.suit, 0, 0.42, 0, 'legs');
  part(new THREE.BoxGeometry(0.66, 0.72, 0.36), mats.suit, 0, 1.16, 0, 'body');
  part(new THREE.BoxGeometry(0.68, 0.14, 0.38), mats.trim, 0, 1.5, 0, 'body');
  part(new THREE.BoxGeometry(0.34, 0.36, 0.34), mats.trim, 0, 1.78, 0, 'head');
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85), GUN_MAT);
  gun.position.set(0.3, 1.22, -0.45);
  group.add(gun);
  scene.add(group);
  return { group, hitMeshes, gun };
}

export function createBots(scene, world, rng, vision = null) {
  const raycaster = new THREE.Raycaster();
  const bots = [];
  const hitMeshes = [];

  function makeBot(name, team, spawn, routeName) {
    const mats = team === 'ally' ? ALLY_MAT : ENEMY_MAT;
    const { group, hitMeshes: meshes, gun } = buildFigure(scene, mats);
    const bot = {
      name, team, group, gun,
      hp: 100, alive: true,
      spawn: new THREE.Vector3(spawn[0], 0, spawn[1]),
      route: WAYPOINTS[routeName].map(([x, z]) => new THREE.Vector3(x, 0, z)),
      routeName,
      wpIndex: 0,
      yaw: 0,
      fireTimer: 1 + rng() * 1.5,
      burstLeft: 0,
      burstTimer: 0,
      strafeDir: rng() > 0.5 ? 1 : -1,
      strafeTimer: 0,
      slowUntil: 0,
      holdUntil: 0,
      investigate: { x: 0, z: 0, until: -1, on: false },
      defusing: false,
      speedNow: 0,
      lastSeenAt: -10,
    };
    for (const mesh of meshes) { mesh.userData.bot = bot; hitMeshes.push(mesh); }
    bots.push(bot);
    return bot;
  }

  const allies = [
    makeBot(ALLY_NAMES[0], 'ally', [-2.5, 20], 'westLane'),
    makeBot(ALLY_NAMES[1], 'ally', [2.5, 20], 'eastLane'),
  ];
  const enemies = [
    makeBot(ENEMY_NAMES[0], 'enemy', [-6, -13], 'holdNorth'),
    makeBot(ENEMY_NAMES[1], 'enemy', [6, -13], 'holdNorth'),
    makeBot(ENEMY_NAMES[2], 'enemy', [-4, -19.5], 'yard'),
    makeBot(ENEMY_NAMES[3], 'enemy', [4.5, -19.5], 'yard'),
  ];

  function reset() {
    for (const bot of bots) {
      bot.hp = 100;
      bot.alive = true;
      bot.defusing = false;
      bot.group.visible = true;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.copy(bot.spawn);
      bot.wpIndex = 0;
      bot.fireTimer = 1 + rng() * 1.5;
      bot.burstLeft = 0;
      bot.holdUntil = 0;
      bot.slowUntil = 0;
      bot.investigate.on = false;
    }
  }

  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function hasSight(bot, targetPos) {
    _from.set(bot.group.position.x, 1.6, bot.group.position.z);
    _to.set(targetPos.x, 1.35, targetPos.z);
    const dist = _from.distanceTo(_to);
    if (dist > 38) return false;
    _dir.copy(_to).sub(_from).normalize();
    raycaster.set(_from, _dir);
    raycaster.far = dist - 0.6;
    if (raycaster.intersectObjects(world.blockers, false).length > 0) return false;
    // A live Whiteout cloud is a soft wall: nobody sees through it,
    // so a smoked lane genuinely breaks a held angle.
    if (vision && vision.blocksVision && vision.blocksVision(_from, _to)) return false;
    return true;
  }

  // A loud event in the yard: every bot in earshot snaps toward the
  // sound and marks the spot to investigate on its next steps.
  function noiseAt(pos, radius = 24) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = pos.x - bot.group.position.x;
      const dz = pos.z - bot.group.position.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      bot.investigate.x = pos.x;
      bot.investigate.z = pos.z;
      bot.investigate.until = -1; // armed with a deadline on its next step
      bot.investigate.on = true;
      bot.yaw = Math.atan2(dx, dz);
    }
  }

  function moveToward(bot, target, dt, speed) {
    const pos = bot.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) { bot.speedNow = 0; return dist; }
    const stepLen = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * stepLen;
    pos.z += (dz / dist) * stepLen;
    bot.yaw = Math.atan2(dx, dz);
    bot.speedNow = speed;
    collide(world.colliders, pos, 0.45);
    return dist;
  }

  function face(bot, targetPos) {
    const pos = bot.group.position;
    bot.yaw = Math.atan2(targetPos.x - pos.x, targetPos.z - pos.z);
  }

  function pickTarget(bot, ctx) {
    // Returns {kind:'player'} or {kind:'bot', bot} plus a position.
    if (bot.team === 'enemy') {
      if (ctx.player.alive && hasSight(bot, ctx.player.pos)) return { kind: 'player', pos: ctx.player.pos };
      for (const ally of allies) if (ally.alive && hasSight(bot, ally.group.position)) return { kind: 'bot', bot: ally, pos: ally.group.position };
      return null;
    }
    for (const foe of enemies) if (foe.alive && hasSight(bot, foe.group.position)) return { kind: 'bot', bot: foe, pos: foe.group.position };
    return null;
  }

  function fireAt(bot, target, ctx) {
    // One bullet of a burst. Hit chance falls with range and with how
    // fast (and how low) the target is moving; a frostpulse slow makes
    // the shooter clumsy instead.
    const from = new THREE.Vector3(bot.group.position.x, 1.45, bot.group.position.z);
    const dist = from.distanceTo(target.pos);
    let chance = 0.36 - dist * 0.006;
    if (target.kind === 'player') {
      chance -= ctx.player.speed * 0.028;
      if (ctx.player.crouching) chance -= 0.07;
    } else {
      chance -= (target.bot.speedNow || 0) * 0.02;
    }
    if (ctx.time < bot.slowUntil) chance *= 0.45;
    chance = Math.max(0.04, Math.min(0.5, chance));
    const hitPoint = new THREE.Vector3(target.pos.x, 1.25, target.pos.z);
    if (rng() < chance) {
      ctx.tracer(from, hitPoint, bot.team, true);
      if (target.kind === 'player') ctx.damagePlayer(bot.team === 'enemy' ? 9 : 5);
      else damageBot(target.bot, bot.team === 'enemy' ? 10 : 12, ctx);
    } else {
      hitPoint.x += (rng() - 0.5) * 2.4;
      hitPoint.y += rng() * 0.9;
      hitPoint.z += (rng() - 0.5) * 2.4;
      ctx.tracer(from, hitPoint, bot.team, false);
    }
    ctx.shotSound(dist);
  }

  function damageBot(bot, amount, ctx) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.group.rotation.z = Math.PI / 2;
      bot.group.position.y = -0.55;
      if (ctx && ctx.onKill) ctx.onKill(bot);
      return true;
    }
    return false;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) return;
    bot.defusing = false;
    const slowed = ctx.time < bot.slowUntil;
    const speed = (bot.team === 'enemy' ? 3.1 : 3.4) * (slowed ? 0.45 : 1);

    // Defuse duty outranks everything once the charge is live.
    if (bot.team === 'enemy' && ctx.planted) {
      const dist = moveToward(bot, ctx.siloPos, dt, speed + 0.5);
      if (dist < 4.6) { bot.defusing = true; bot.speedNow = 0; face(bot, ctx.siloPos); }
      const target = pickTarget(bot, ctx);
      if (target && !bot.defusing) engage(bot, target, dt, ctx);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    const target = pickTarget(bot, ctx);
    if (target) {
      bot.lastSeenAt = ctx.time;
      bot.investigate.on = false;
      engage(bot, target, dt, ctx);
    } else if (bot.investigate.on) {
      // Heard something: go and look at where the sound came from,
      // then hold there briefly before falling back to the route.
      if (bot.investigate.until < 0) bot.investigate.until = ctx.time + 5;
      if (ctx.time > bot.investigate.until) {
        bot.investigate.on = false;
      } else {
        const d = moveToward(bot, bot.investigate, dt, speed * 0.92);
        if (d < 1.3) {
          bot.investigate.on = false;
          bot.holdUntil = ctx.time + 1.2 + rng() * 1.4;
        }
      }
    } else if (ctx.time < bot.holdUntil) {
      // Holding the waypoint: stand still and watch the lane toward
      // the next point instead of wandering on immediately.
      bot.speedNow = 0;
      face(bot, bot.route[bot.wpIndex % bot.route.length]);
    } else {
      // Patrol the loop; allies push north, enemies hold the silo end.
      const wp = bot.route[bot.wpIndex % bot.route.length];
      const dist = moveToward(bot, wp, dt, speed * 0.72);
      if (dist < 0.8) {
        bot.wpIndex = (bot.wpIndex + 1) % bot.route.length;
        bot.holdUntil = ctx.time + 1.2 + rng() * 1.8;
      }
    }
    bot.group.rotation.y = bot.yaw;
  }

  function engage(bot, target, dt, ctx) {
    face(bot, target.pos);
    const pos = bot.group.position;
    const dist = Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z);
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) { bot.strafeDir = rng() > 0.5 ? 1 : -1; bot.strafeTimer = 0.7 + rng() * 0.9; }
    // Keep a fighting distance: close in past 16 m, back off under 5 m,
    // otherwise sidestep so a still shooter is not a free target.
    const side = new THREE.Vector3(-(target.pos.z - pos.z), 0, target.pos.x - pos.x).normalize();
    if (dist > 16) moveToward(bot, target.pos, dt, 3.2);
    else if (dist < 5) { side.multiplyScalar(-bot.strafeDir * dt * 1.6); pos.add(side); collide(world.colliders, pos, 0.45); bot.speedNow = 1.6; }
    else { side.multiplyScalar(bot.strafeDir * dt * 1.5); pos.add(side); collide(world.colliders, pos, 0.45); bot.speedNow = 1.5; }

    if (bot.burstLeft > 0) {
      bot.burstTimer -= dt;
      if (bot.burstTimer <= 0) {
        bot.burstTimer = 0.12;
        bot.burstLeft -= 1;
        fireAt(bot, target, ctx);
      }
    } else {
      bot.fireTimer -= dt;
      if (bot.fireTimer <= 0) {
        bot.burstLeft = 2 + Math.floor(rng() * 3);
        bot.burstTimer = 0;
        // Tuned after the first playtest build: bursts paused a touch
        // longer so a player who breaks line of sight gets a real
        // window to reposition instead of eating the next burst.
        bot.fireTimer = (1.05 + rng() * 1.15) * (ctx.time < bot.slowUntil ? 1.8 : 1);
      }
    }
  }

  function step(dt, ctx) {
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  reset();
  return { bots, allies, enemies, hitMeshes, reset, step, damageBot, hasSight, noiseAt };
}
