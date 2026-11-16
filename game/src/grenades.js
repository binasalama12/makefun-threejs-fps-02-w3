// Frostline Depot — everything throwable lives in this one module:
// the Frostpulse grenade (a frost burst that slows and chips every foe
// in range) and the Whiteout smokescreen (a chalk charge that blooms
// into a cloud which blocks sight lines — the bots' line of sight
// treats a live cloud as a soft wall, exactly like the player's eyes
// do). Projectiles and clouds are pooled up front; the step loop
// allocates nothing.
//
// The module owns no game state: main.js injects its effects through
// fx (clock, audio, the frost-burst fallout, a noise shout that bots
// can hear) and reads blocksVision() back for bot sight checks.

import * as THREE from 'three';
import { GRENADE, SMOKE } from './config.js';

const FROST_MAT = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x3d9dc9, emissiveIntensity: 1.2 });
const CAN_MAT = new THREE.MeshStandardMaterial({ color: 0xd7dee6, roughness: 0.6, metalness: 0.2 });
const CLOUD_GEO = new THREE.SphereGeometry(1, 14, 10);
// Puff layout inside one cloud: [x, y, z, scale] around the centre, so
// a cloud reads as a billowing whiteout rather than one clean sphere.
const PUFFS = [
  [0, 0, 0, 1.0], [1.6, 0.4, 0.6, 0.75], [-1.5, 0.3, -0.8, 0.8],
  [0.6, 0.5, -1.6, 0.7], [-0.7, 0.6, 1.5, 0.72], [0.2, 1.1, 0.2, 0.6],
];

export function createGrenades(scene, fx) {
  // --- shared explosion flash: frost bursts and the silo detonation ---
  const flashMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0xcdf2ff, transparent: true, opacity: 0 }),
  );
  flashMesh.visible = false;
  scene.add(flashMesh);
  let flashUntil = -1;
  function burst(pos, scale, opacity, seconds) {
    flashMesh.position.copy(pos);
    flashMesh.scale.setScalar(scale);
    flashMesh.material.opacity = opacity;
    flashMesh.visible = true;
    flashUntil = fx.time() + seconds;
  }

  // --- projectiles: one small pool, two kinds ---
  const projectiles = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), FROST_MAT);
    mesh.visible = false;
    scene.add(mesh);
    projectiles.push({ active: false, kind: 'frost', pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, mesh });
  }
  function launch(kind, from, dir) {
    const p = projectiles.find((x) => !x.active);
    if (!p) return false;
    p.kind = kind;
    p.pos.copy(from);
    p.vel.copy(dir).multiplyScalar(15);
    p.vel.y += 3.5;
    p.fuse = kind === 'frost' ? 1.15 : 0.9;
    p.mesh.material = kind === 'frost' ? FROST_MAT : CAN_MAT;
    p.mesh.scale.setScalar(kind === 'frost' ? 1 : 1.25);
    p.mesh.position.copy(p.pos);
    p.active = true;
    p.mesh.visible = true;
    return true;
  }

  // --- smoke clouds ---
  const clouds = [];
  for (let i = 0; i < 4; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0, depthWrite: false });
    const group = new THREE.Group();
    for (const [x, y, z, s] of PUFFS) {
      const puff = new THREE.Mesh(CLOUD_GEO, mat);
      puff.position.set(x, y, z);
      puff.scale.setScalar(s);
      group.add(puff);
    }
    group.visible = false;
    scene.add(group);
    clouds.push({ active: false, pos: new THREE.Vector3(), born: 0, until: 0, group, mat });
  }
  function cloudGrow(cloud) {
    return Math.min(1, (fx.time() - cloud.born) / SMOKE.bloomSeconds);
  }
  function bloom(pos) {
    const cloud = clouds.find((c) => !c.active) || clouds[0];
    cloud.pos.copy(pos).setY(0.4);
    cloud.born = fx.time();
    cloud.until = fx.time() + SMOKE.duration;
    cloud.active = true;
    cloud.group.position.copy(cloud.pos);
    cloud.group.visible = true;
    fx.audio.smoke();
    fx.noiseAt(cloud.pos, 9); // the hiss is audible up close
  }

  const _centre = new THREE.Vector3();
  const _ab = new THREE.Vector3();
  const _ac = new THREE.Vector3();
  // True when the sight segment a->b passes through a bloomed cloud.
  // Distance from the cloud centre to the segment, against the cloud's
  // current (still growing) radius — a half-bloomed cloud only half
  // hides, which reads fairly for both sides.
  function blocksVision(a, b) {
    for (const cloud of clouds) {
      if (!cloud.active) continue;
      const r = SMOKE.radius * cloudGrow(cloud);
      if (r < 0.6) continue;
      _centre.set(cloud.pos.x, 1.3, cloud.pos.z);
      _ab.copy(b).sub(a);
      _ac.copy(_centre).sub(a);
      const lenSq = _ab.lengthSq();
      const t = lenSq > 0 ? Math.max(0, Math.min(1, _ac.dot(_ab) / lenSq)) : 0;
      const dx = _ac.x - _ab.x * t;
      const dy = _ac.y - _ab.y * t;
      const dz = _ac.z - _ab.z * t;
      if (dx * dx + dy * dy + dz * dz < r * r * 0.85) return true;
    }
    return false;
  }

  function explodeFrost(p) {
    fx.audio.grenade();
    _centre.copy(p.pos).setY(1);
    burst(_centre, GRENADE.radius, 0.4, 0.28);
    fx.noiseAt(p.pos, 20);
    fx.frostBurst(p.pos); // main.js applies the slow + chip damage
  }

  function step(dt) {
    const now = fx.time();
    if (flashMesh.visible && now > flashUntil) { flashMesh.visible = false; flashMesh.material.opacity = 0; }
    for (const p of projectiles) {
      if (!p.active) continue;
      p.vel.y -= 18 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.12) { p.pos.y = 0.12; p.vel.set(0, 0, 0); }
      p.mesh.position.copy(p.pos);
      p.fuse -= dt;
      if (p.fuse <= 0) {
        p.active = false;
        p.mesh.visible = false;
        if (p.kind === 'frost') explodeFrost(p);
        else bloom(p.pos);
      }
    }
    for (const cloud of clouds) {
      if (!cloud.active) continue;
      if (now > cloud.until) { cloud.active = false; cloud.group.visible = false; cloud.mat.opacity = 0; continue; }
      const grow = cloudGrow(cloud);
      const fade = Math.min(1, (cloud.until - now) / 1.6);
      const s = 1.8 * (0.3 + 0.7 * grow); // puffs reach ≈ SMOKE.radius at full bloom
      cloud.group.scale.set(s, s * 0.62, s);
      cloud.mat.opacity = 0.52 * Math.min(grow * 1.6, 1) * fade;
    }
  }

  function clear() {
    for (const p of projectiles) { p.active = false; p.mesh.visible = false; }
    for (const cloud of clouds) { cloud.active = false; cloud.group.visible = false; cloud.mat.opacity = 0; }
    flashMesh.visible = false;
    flashMesh.material.opacity = 0;
  }

  return {
    throwFrost: (from, dir) => launch('frost', from, dir),
    throwSmoke: (from, dir) => launch('smoke', from, dir),
    step, blocksVision, burst, clear,
  };
}
