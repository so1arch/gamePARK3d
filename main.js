import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---------- Рендер в стиле N64: низкое разрешение, без сглаживания ----------
const RES_H = 240;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
document.getElementById('game').appendChild(renderer.domElement);

// Градиентная канвас-текстура (сверху вниз) и "пиксельная" обёртка
function gradCanvas(w, h, stops) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  return c;
}
function pixTex(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const scene = new THREE.Scene();
scene.background = pixTex(gradCanvas(2, 48, [[0, '#2a62d0'], [0.6, '#7ec0ff'], [1, '#d4eeff']])); // градиентное небо
scene.fog = new THREE.Fog(0xa6d4ff, 24, 150);
const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 250);
camera.rotation.order = 'YXZ';
camera.position.set(0, 4.5, 8);
scene.add(camera);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(5, 10, 6);
scene.add(sun);

// ---------- Динамический ambient occlusion (SSAO) ----------
// Если затемнение слишком слабое/сильное — меняйте kernelRadius и maxDistance
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssao = new SSAOPass(scene, camera, 320, RES_H);
ssao.kernelRadius = 2.5;
ssao.minDistance = 0.0005;
ssao.maxDistance = 0.012;
composer.addPass(ssao);
composer.addPass(new OutputPass());

function resize() {
  const w = Math.round(RES_H * innerWidth / innerHeight);
  renderer.setSize(w, RES_H, false);
  composer.setSize(w, RES_H);
  camera.aspect = w / RES_H;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// ---------- Уровень ----------
const gradTex = pixTex(gradCanvas(4, 16, [[0, '#ffffff'], [1, '#6a6a6a']])); // градиент на платформах
const boxes = [];
const COLORS = [0x4caf50, 0xff9800, 0x42a5f5, 0xe91e63, 0xffeb3b];
const LEVEL = [
  [0, 0, 0, 8, 8], [0, 0.5, -8, 4, 4], [3, 1.2, -13, 3, 3], [-1, 2, -18, 3, 3],
  [-5, 2.5, -23, 3, 3], [-5, 3.5, -28, 2.5, 2.5], [0, 4.2, -30, 3, 3], [5, 5, -32, 3, 3],
  [10, 6, -36, 2.5, 2.5], [10, 6.5, -42, 1.5, 6], [10, 7.5, -50, 6, 6],
];
LEVEL.forEach(([x, y, z, w, d], i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat(COLORS[i % COLORS.length], { map: gradTex }));
  m.position.set(x, y - 0.5, z);
  scene.add(m);
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - 1, maxY: y, minZ: z - d / 2, maxZ: z + d / 2 });
});

const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8).rotateX(Math.PI / 2);
LEVEL.slice(1, 10).forEach(([x, y, z]) => {
  const c = new THREE.Mesh(coinGeo, mat(0xffd800, { emissive: 0x665500 }));
  c.position.set(x, y + 1.3, z);
  scene.add(c); coins.push(c);
});
const goalPos = LEVEL[LEVEL.length - 1];
const goal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), mat(0xfff176, { emissive: 0x887700 }));
goal.position.set(goalPos[0], goalPos[1] + 1.6, goalPos[2]);
scene.add(goal);

// ---------- Игрок ----------
const player = new THREE.Group();
const box = (parent, w, h, d, m, x, y, z) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); parent.add(o); return o;
};
box(player, 0.6, 0.4, 0.35, mat(0x1565c0), 0, 0.2, 0);
box(player, 0.7, 0.6, 0.4, mat(0xd32f2f), 0, 0.7, 0);
box(player, 0.45, 0.45, 0.45, mat(0xffcc99), 0, 1.25, 0);
box(player, 0.5, 0.15, 0.5, mat(0xd32f2f), 0, 1.55, 0);
scene.add(player);

const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
);
scene.add(shadow);

// ---------- Руки от первого лица ----------
const hands = new THREE.Group();
camera.add(hands);
function makeArm(side) {
  const g = new THREE.Group();
  box(g, 0.16, 0.16, 0.42, mat(0xd32f2f), 0, 0, -0.21); // рукав
  box(g, 0.12, 0.12, 0.2, mat(0xffcc99), 0, 0, -0.5);   // запястье
  box(g, 0.2, 0.2, 0.2, mat(0xffffff), 0, 0, -0.68);    // перчатка-кулак
  g.position.set(side * 0.36, -0.5, -0.15);
  g.rotation.y = -side * 0.1;
  hands.add(g);
  return g;
}
const armL = makeArm(-1), armR = makeArm(1);

// ---------- Драконы: чешуя + блеск на солнце ----------
const scaleC = document.createElement('canvas'); scaleC.width = scaleC.height = 32;
{
  const g = scaleC.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, 32, 32);
  for (let y = 0; y < 8; y++) for (let x = -1; x < 8; x++) {
    const px = x * 4 + (y % 2) * 2, py = y * 4;
    const gr = g.createLinearGradient(0, py, 0, py + 3);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#8a8a8a');
    g.fillStyle = gr; g.fillRect(px, py, 3, 3);
  }
}
const glitC = document.createElement('canvas'); glitC.width = glitC.height = 32;
{
  const g = glitC.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fff';
  for (let i = 0; i < 28; i++) g.fillRect((Math.random() * 32) | 0, (Math.random() * 32) | 0, 1, 1);
}
const scaleTex = pixTex(scaleC, true); scaleTex.repeat.set(3, 2);
const glitter = pixTex(glitC, true); glitter.repeat.set(2, 2); // бегущие блики

const sparkleMats = [];
const mk = (color, extra = {}) => {
  const m = new THREE.MeshPhongMaterial({
    color, map: scaleTex, specular: 0xffffff, shininess: 90, flatShading: true,
    emissive: 0xfff2b0, emissiveMap: glitter, emissiveIntensity: 0.5, ...extra,
  });
  sparkleMats.push(m); return m;
};

function wingGeo(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.1, uv.getY(i) * 0.1);
  return g;
}
const innerG = wingGeo([[0, -1], [9, -2], [9, 6], [4, 7], [0, 5]]);
const outerG = wingGeo([[0, -2], [13, -5], [11, 1], [8, 4], [4, 3], [0, 6]]);
const ball = new THREE.SphereGeometry(1, 7, 5);
const spikeG = new THREE.ConeGeometry(0.3, 0.9, 4);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffee00 });
const CX = 2, CZ = -25;
const dragons = [];

function makeDragon(color, rx, rz, y0, w, ph) {
  const body = mk(color);
  const dark = mk(new THREE.Color(color).multiplyScalar(0.6), { side: THREE.DoubleSide });
  const bone = mk(0xe8dcc0);
  const d = { rx, rz, y0, w, a: ph, ph, gap: 3.4 / ((rx + rz) / 2), segs: [], wings: [] };
  for (let i = 0; i < 20; i++) {
    const r = 2.4 * (1 - i / 24) + 0.3;
    const s = new THREE.Mesh(ball, body);
    s.scale.set(r, r * 0.9, r * 1.6);
    const sp = new THREE.Mesh(spikeG, bone);
    sp.position.y = 1.05; s.add(sp);
    scene.add(s); d.segs.push(s);
  }
  d.head = new THREE.Group();
  box(d.head, 2.6, 2, 3.2, body, 0, 0, 0);
  box(d.head, 1.7, 1.1, 2.4, body, 0, -0.35, 2.5);
  for (const sd of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.6, 5), bone);
    h.position.set(sd * 1, 1.3, -0.8); h.rotation.x = -1; d.head.add(h);
    box(d.head, 0.3, 0.4, 0.6, eyeMat, sd * 1.32, 0.5, 0.8);
  }
  scene.add(d.head);
  d.shoulder = new THREE.Group();
  for (const side of [1, -1]) {
    const inner = new THREE.Group(); inner.position.set(side * 2.2, 1.2, 0); inner.scale.x = side;
    inner.add(new THREE.Mesh(innerG, dark));
    const outer = new THREE.Group(); outer.position.x = 9;
    outer.add(new THREE.Mesh(outerG, dark));
    inner.add(outer); d.shoulder.add(inner);
    d.wings.push([inner, outer, side]);
  }
  scene.add(d.shoulder);
  dragons.push(d);
}
makeDragon(0x2e9b4a, 55, 75, 24, 0.17, 0);
makeDragon(0xc0392b, 38, 50, 33, -0.22, 2);
makeDragon(0x7b3fc9, 70, 95, 19, 0.13, 4);

const P = new THREE.Vector3(), Q = new THREE.Vector3();
function updateDragons(dt, time) {
  glitter.offset.x += dt * 0.12;
  glitter.offset.y -= dt * 0.05;
  const tw = 0.5 + 0.4 * Math.sin(time * 5);
  sparkleMats.forEach((m) => (m.emissiveIntensity = tw));
  for (const d of dragons) {
    const s = Math.sign(d.w);
    d.a += d.w * dt;
    const place = (o, a) => {
      P.set(CX + d.rx * Math.cos(a), d.y0 + 3 * Math.sin(2 * a), CZ + d.rz * Math.sin(a));
      a += s * 0.02;
      Q.set(CX + d.rx * Math.cos(a), d.y0 + 3 * Math.sin(2 * a), CZ + d.rz * Math.sin(a));
      o.position.copy(P); o.lookAt(Q);
    };
    place(d.head, d.a);
    d.segs.forEach((seg, i) => place(seg, d.a - s * (i + 1) * d.gap));
    d.shoulder.position.copy(d.segs[3].position);
    d.shoulder.quaternion.copy(d.segs[3].quaternion);
    d.wings.forEach(([inner, outer, side]) => {
      inner.rotation.z = side * Math.sin(time * 4.2 + d.ph) * 0.6;
      outer.rotation.z = Math.sin(time * 4.2 + d.ph - 1) * 0.5;
    });
  }
}

// ---------- Управление ----------
const keys = {};
let jumpBuf = 0, camA = 0, pitch = 0, fpv = false, snapCam = false;
const hud = document.getElementById('hud');
const msg = document.getElementById('msg');

function setView(on) {
  fpv = on;
  camera.fov = on ? 75 : 60;
  camera.updateProjectionMatrix();
  player.visible = !on;
  hands.visible = on;
  if (!on && document.pointerLockElement) document.exitPointerLock();
}
setView(false);

// Сброс прямо в игре, без перезагрузки страницы
function reset() {
  p.set(0, 0, 0); v.set(0, 0, 0);
  got = 0; time = 0; won = false; jumpBuf = 0; coyote = 0;
  coins.forEach((c) => (c.visible = true));
  msg.style.display = 'none';
  snapCam = true;
}

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { jumpBuf = 0.15; e.preventDefault(); }
  if (e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyV') setView(!fpv);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('click', () => {
  if (fpv && !document.pointerLockElement) renderer.domElement.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement || e.buttons) {
    camA -= e.movementX * 0.005;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.005));
  }
});

// ---------- Физика ----------
const HW = 0.35, H = 1.6, SPEED = 7, GRAV = 30, JUMP = 11;
const p = new THREE.Vector3(0, 0, 0);
const v = new THREE.Vector3();
const tmp = new THREE.Vector3();
let onGround = false, coyote = 0, face = 0, got = 0, time = 0, won = false;
let armPhase = 0, armLift = 0, landKick = 0, clockT = 0;

const hits = (b) =>
  p.x + HW > b.minX && p.x - HW < b.maxX &&
  p.y + H > b.minY && p.y < b.maxY &&
  p.z + HW > b.minZ && p.z - HW < b.maxZ;

function move(axis, d) {
  p[axis] += d;
  for (const b of boxes) {
    if (!hits(b)) continue;
    if (axis === 'y') {
      if (d < 0) { p.y = b.maxY; onGround = true; } else p.y = b.minY - H;
      v.y = 0;
    } else if (axis === 'x') p.x = d > 0 ? b.minX - HW : b.maxX + HW;
    else p.z = d > 0 ? b.minZ - HW : b.maxZ + HW;
  }
}

function update(dt) {
  clockT += dt;
  camA += ((keys.ArrowLeft || keys.KeyQ ? 1 : 0) - (keys.ArrowRight || keys.KeyE ? 1 : 0)) * 2 * dt;
  if (fpv) pitch = Math.max(-1.4, Math.min(1.4, pitch + ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * 1.5 * dt));

  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let dx = -Math.sin(camA) * f + Math.cos(camA) * r;
  let dz = -Math.cos(camA) * f - Math.sin(camA) * r;
  const len = Math.hypot(dx, dz);
  if (len > 0) { dx /= len; dz /= len; face = Math.atan2(dx, dz); }
  v.x = dx * SPEED; v.z = dz * SPEED;

  coyote = onGround ? 0.1 : coyote - dt;
  jumpBuf -= dt;
  if (jumpBuf > 0 && coyote > 0) { v.y = JUMP; coyote = 0; jumpBuf = 0; }
  v.y -= GRAV * dt;

  const wasGround = onGround, vy = v.y;
  onGround = false;
  move('x', v.x * dt); move('z', v.z * dt); move('y', v.y * dt);
  if (onGround && !wasGround && vy < -6) landKick = Math.min(1, -vy / 20);

  if (p.y < -15) { p.set(0, 0, 0); v.set(0, 0, 0); snapCam = true; }

  tmp.set(p.x, p.y + 0.8, p.z);
  for (const c of coins) {
    if (!c.visible) continue;
    c.rotation.y += dt * 4;
    if (c.position.distanceTo(tmp) < 1) { c.visible = false; got++; }
  }
  goal.rotation.y += dt * 2;
  if (!won && goal.position.distanceTo(tmp) < 1.4) {
    won = true;
    msg.style.display = 'flex';
    msg.innerHTML = `ЗВЕЗДА!<br>Время: ${time.toFixed(1)} с, монет: ${got}/9<br>R: сыграть ещё`;
  }
  if (!won) time += dt;
  hud.textContent = `МОНЕТЫ ${got}/9   ВРЕМЯ ${time.toFixed(1)}`;

  player.position.copy(p);
  player.rotation.y = face;
  let gy = -Infinity;
  for (const b of boxes) {
    if (Math.abs(p.x - (b.minX + b.maxX) / 2) < (b.maxX - b.minX) / 2 + 0.2 &&
        Math.abs(p.z - (b.minZ + b.maxZ) / 2) < (b.maxZ - b.minZ) / 2 + 0.2 &&
        b.maxY <= p.y + 0.05 && b.maxY > gy) gy = b.maxY;
  }
  shadow.visible = gy > -Infinity;
  shadow.position.set(p.x, gy + 0.02, p.z);

  // Анимация рук: качание при беге, подъём в прыжке, "просадка" при приземлении
  const spd = Math.hypot(v.x, v.z) / SPEED;
  armPhase += dt * 11 * spd;
  armLift += ((onGround ? 0 : Math.max(-1, Math.min(1, v.y / JUMP)) * 0.7) - armLift) * (1 - Math.exp(-12 * dt));
  landKick = Math.max(0, landKick - dt * 4);
  const sw = Math.sin(armPhase) * 0.55 * spd;
  armL.rotation.x = 0.15 + sw + armLift;
  armR.rotation.x = 0.15 - sw + armLift;
  hands.position.set(Math.sin(armPhase * 0.5) * 0.02 * spd,
    -Math.abs(Math.sin(armPhase)) * 0.03 * spd - landKick * 0.1 + Math.sin(clockT * 1.6) * 0.006, 0);

  if (fpv) {
    camera.position.set(p.x, p.y + 1.5 + Math.abs(Math.sin(armPhase)) * 0.04 * spd, p.z);
    camera.rotation.set(pitch, camA, 0);
  } else {
    tmp.set(p.x + Math.sin(camA) * 8, p.y + 4.5, p.z + Math.cos(camA) * 8);
    if (snapCam) camera.position.copy(tmp);
    else camera.position.lerp(tmp, 1 - Math.exp(-6 * dt));
    camera.lookAt(p.x, p.y + 1.2, p.z);
  }
  snapCam = false;
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  updateDragons(dt, clockT);
  composer.render();
}
loop();
