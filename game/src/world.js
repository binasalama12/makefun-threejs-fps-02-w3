// Frostline Depot — the map: a snowbound rail depot built from boxes,
// cylinders and one very cold fuel silo. Two rail lanes run south to
// north, wagons and an ice warehouse break the sightlines, and the silo
// at the north end is where the Frostwardens plant their charge.
// Palette throughout: pale ice blue, snow white, weathered grey.

import * as THREE from 'three';

export const MAP = {
  halfX: 30,
  halfZ: 24,
  siloPos: new THREE.Vector3(0, 0, -17),
  siloRadius: 3.4,
  playerSpawn: new THREE.Vector3(0, 0, 19),
};

const MAT = {
  snow: new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.95 }),
  packedSnow: new THREE.MeshStandardMaterial({ color: 0xc9d8e6, roughness: 0.9 }),
  railSteel: new THREE.MeshStandardMaterial({ color: 0x8b98a5, roughness: 0.45, metalness: 0.7 }),
  sleeper: new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.9 }),
  wagonBlue: new THREE.MeshStandardMaterial({ color: 0x7fa8c9, roughness: 0.7, metalness: 0.25 }),
  wagonGrey: new THREE.MeshStandardMaterial({ color: 0x9aa7b1, roughness: 0.8, metalness: 0.2 }),
  wagonPale: new THREE.MeshStandardMaterial({ color: 0xc7d6e2, roughness: 0.75, metalness: 0.2 }),
  warehouse: new THREE.MeshStandardMaterial({ color: 0xa9bfd2, roughness: 0.85 }),
  warehouseRoof: new THREE.MeshStandardMaterial({ color: 0xe8f1f8, roughness: 0.95 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xb9c9d6, roughness: 0.9 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x6f93b5, roughness: 0.6, metalness: 0.4 }),
  silo: new THREE.MeshStandardMaterial({ color: 0xd4e4ef, roughness: 0.35, metalness: 0.55 }),
  siloBand: new THREE.MeshStandardMaterial({ color: 0x4e7ba6, roughness: 0.5, metalness: 0.5 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xffdf8a, emissiveIntensity: 1.6 }),
  charge: new THREE.MeshStandardMaterial({ color: 0x35506b, emissive: 0x66d9ff, emissiveIntensity: 0.7, roughness: 0.5 }),
};

// Patrol / push routes shared by both crews. Each route is a loop of
// ground points; bots walk them until they see or hear trouble.
export const WAYPOINTS = {
  westLane: [[-14, 14], [-14, 2], [-10, -8], [-6, -14], [-2, -15]],
  eastLane: [[14, 14], [14, 2], [10, -8], [6, -14], [2, -15]],
  yard: [[-4, 8], [4, 6], [6, -4], [0, -10], [-6, -4]],
  holdNorth: [[-6, -13], [0, -12], [6, -13], [3, -18], [-3, -18]],
};

export function createWorld(scene) {
  const colliders = []; // {minX,maxX,minZ,maxZ} for actors on foot
  const blockers = []; // meshes that stop bullets and sight lines
  const shootables = []; // blockers + ground for impact sparks

  function box(w, h, d, x, y, z, mat, { collide = true, shoot = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    if (shoot) { blockers.push(mesh); shootables.push(mesh); }
    return mesh;
  }

  // Lights: a low blue-grey sky, one cold sun, yard lamps for warmth.
  scene.add(new THREE.HemisphereLight(0xcfe2f2, 0x5f7185, 0.95));
  const sun = new THREE.DirectionalLight(0xf2f7ff, 1.5);
  sun.position.set(-18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  scene.add(sun);

  // Ground: snow field with a packed yard strip down the middle.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.halfX * 2 + 30, MAP.halfZ * 2 + 30), MAT.snow);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootables.push(ground);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(34, MAP.halfZ * 2), MAT.packedSnow);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.02;
  yard.receiveShadow = true;
  scene.add(yard);

  // Perimeter: low ice walls keep everyone in the depot.
  box(MAP.halfX * 2 + 2, 2.6, 1, 0, 1.3, -MAP.halfZ - 0.5, MAT.packedSnow);
  box(MAP.halfX * 2 + 2, 2.6, 1, 0, 1.3, MAP.halfZ + 0.5, MAT.packedSnow);
  box(1, 2.6, MAP.halfZ * 2 + 2, -MAP.halfX - 0.5, 1.3, 0, MAT.packedSnow);
  box(1, 2.6, MAP.halfZ * 2 + 2, MAP.halfX + 0.5, 1.3, 0, MAT.packedSnow);

  // Two rail lanes: steel pairs on sleepers, running the map's length.
  for (const laneX of [-9, 9]) {
    for (const off of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, MAP.halfZ * 2 - 2), MAT.railSteel);
      rail.position.set(laneX + off, 0.08, 0);
      rail.receiveShadow = true;
      scene.add(rail);
    }
    for (let z = -MAP.halfZ + 2; z < MAP.halfZ - 1; z += 1.6) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.07, 0.5), MAT.sleeper);
      tie.position.set(laneX, 0.035, z);
      scene.add(tie);
    }
  }

  // Wagons parked on both lanes — the depot's main cover.
  const wagon = (x, z, len, mat) => {
    box(3, 2.4, len, x, 1.7, z, mat);
    box(3.2, 0.3, len + 0.4, x, 0.45, z, MAT.sleeper);
    for (const dz of [-len / 2 + 1, len / 2 - 1]) for (const dx of [-1.1, 1.1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 14), MAT.railSteel);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x + dx, 0.45, z + dz);
      scene.add(wheel);
    }
  };
  wagon(-9, 6, 9, MAT.wagonBlue);
  wagon(-9, -10, 7, MAT.wagonGrey);
  wagon(9, 0, 10, MAT.wagonPale);
  wagon(9, -13, 6, MAT.wagonBlue);
  wagon(9, 13, 6, MAT.wagonGrey);

  // Ice warehouse on the west side with a snow-loaded roof.
  box(10, 4.6, 12, -23, 2.3, -2, MAT.warehouse);
  box(11, 0.5, 13, -23, 4.85, -2, MAT.warehouseRoof);

  // Crates, barrels and a plough blade scattered as half cover.
  const crate = (x, z, s = 1.3) => box(s, s, s, x, s / 2, z, MAT.crate);
  crate(-3.5, 10); crate(-2.1, 10, 1.1); crate(-3, 8.8, 0.9);
  crate(4.5, -6); crate(4.5, -7.4, 1.0); crate(-5.5, -2);
  crate(13, -6); crate(-14, -14); crate(16, 8); crate(-16, 16, 1.0);
  for (const [x, z] of [[6.5, 12], [7.3, 12.4], [-12, -5], [12.5, 16], [-6, -11]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.25, 14), MAT.barrel);
    barrel.position.set(x, 0.63, z);
    barrel.castShadow = true;
    scene.add(barrel);
    colliders.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55 });
    blockers.push(barrel); shootables.push(barrel);
  }
  const plough = box(5, 1.1, 0.5, 0, 0.55, 6, MAT.wagonGrey);
  plough.rotation.y = 0.5;

  // The fuel silo: plant target at the north end, ringed by a marked zone.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 9, 22), MAT.silo);
  silo.position.set(MAP.siloPos.x, 4.5, MAP.siloPos.z);
  silo.castShadow = true;
  scene.add(silo);
  blockers.push(silo); shootables.push(silo);
  colliders.push({ minX: -2.8, maxX: 2.8, minZ: MAP.siloPos.z - 2.8, maxZ: MAP.siloPos.z + 2.8 });
  for (const y of [2.2, 5.4, 8.2]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.72, 0.35, 22), MAT.siloBand);
    band.position.set(MAP.siloPos.x, y, MAP.siloPos.z);
    scene.add(band);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.silo);
  dome.position.set(MAP.siloPos.x, 9, MAP.siloPos.z);
  scene.add(dome);
  const zone = new THREE.Mesh(new THREE.RingGeometry(MAP.siloRadius - 0.35, MAP.siloRadius, 40),
    new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  zone.rotation.x = -Math.PI / 2;
  zone.position.set(MAP.siloPos.x, 0.06, MAP.siloPos.z);
  scene.add(zone);

  // The charge prop appears on the silo once planting completes.
  const chargeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.3), MAT.charge);
  chargeMesh.position.set(1.9, 0.5, MAP.siloPos.z + 2.2);
  chargeMesh.visible = false;
  scene.add(chargeMesh);

  // Yard lamps on poles.
  for (const [x, z] of [[-16, 10], [16, -2], [-16, -16], [16, 18], [0, -6]]) {
    box(0.18, 4.6, 0.18, x, 2.3, z, MAT.sleeper, { collide: true, shoot: false });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), MAT.lamp);
    head.position.set(x, 4.7, z);
    scene.add(head);
    const light = new THREE.PointLight(0xffe9b0, 12, 15, 1.8);
    light.position.set(x, 4.5, z);
    scene.add(light);
  }

  // Falling snow: one Points cloud, recycled in a box around the camera.
  const SNOW_COUNT = 900;
  const snowPos = new Float32Array(SNOW_COUNT * 3);
  const snowSeed = new Float32Array(SNOW_COUNT);
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    snowPos[i * 3] = (Math.random() - 0.5) * 70;
    snowPos[i * 3 + 1] = Math.random() * 22;
    snowPos[i * 3 + 2] = (Math.random() - 0.5) * 56;
    snowSeed[i] = 0.5 + Math.random();
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.14, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  scene.add(snow);

  function stepSnow(dt, focus) {
    const arr = snowGeo.attributes.position.array;
    for (let i = 0; i < SNOW_COUNT; i += 1) {
      arr[i * 3 + 1] -= dt * (1.6 + snowSeed[i]);
      arr[i * 3] += Math.sin(performance.now() * 0.001 + snowSeed[i] * 9) * dt * 0.35;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 20 + Math.random() * 3;
        arr[i * 3] = focus.x + (Math.random() - 0.5) * 70;
        arr[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 56;
      }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  return { colliders, blockers, shootables, chargeMesh, zone, stepSnow };
}

// Push a ground position (with a body radius) out of every collider box
// and clamp it inside the depot walls.
export function collide(colliders, pos, radius) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(c.maxX, pos.x));
    const nz = Math.max(c.minZ, Math.min(c.maxZ, pos.z));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave through the nearest face.
        const left = pos.x - c.minX; const right = c.maxX - pos.x;
        const near = pos.z - c.minZ; const far = c.maxZ - pos.z;
        const m = Math.min(left, right, near, far);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === near) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
  pos.x = Math.max(-MAP.halfX + radius, Math.min(MAP.halfX - radius, pos.x));
  pos.z = Math.max(-MAP.halfZ + radius, Math.min(MAP.halfZ - radius, pos.z));
}
