import * as THREE from 'three';

// ---------- Рендер в стиле N64: низкое разрешение, без сглаживания ----------
const RES_H = 240;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
document.getElementById('game').appendChild(renderer.domElement);

const SKY = 0x7ec8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 16, 55); // N64 любил густой туман
const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
camera.position.set(0, 4.5, 8);

function resize() {
  const w = Math.round(RES_H * innerWidth / innerHeight);
  renderer.setSize(w, RES_H, false);
  camera.aspect = w / RES_H;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(5, 10, 6);
scene.add(sun);

// Текстура-шашечка 8x8 с фильтром "ближайший пиксель"
const cv = document.createElement('canvas');
cv.width = cv.height = 8;
const cx = cv.getContext('2d');
cx.fillStyle = '#fff'; cx.fillRect(0, 0, 8, 8);
cx.fillStyle = '#c4c4c4'; cx.fillRect(0, 0, 4, 4); cx.fillRect(4, 4, 4, 4);
const baseTex = new THREE.CanvasTexture(cv);
baseTex.magFilter = baseTex.minFilter = THREE.NearestFilter;
baseTex.wrapS = baseTex.wrapT = THREE.RepeatWrapping;
baseTex.colorSpace = THREE.SRGBColorSpace;

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// ---------- Уровень ----------
const boxes = [];
const COLORS = [0x4caf50, 0xff9800, 0x42a5f5, 0xe91e63, 0xffeb3b];
// [x, y верха, z, ширина, глубина]
const LEVEL = [
  [0, 0, 0, 8, 8],
  [0, 0.5, -8, 4, 4],
  [3, 1.2, -13, 3, 3],
  [-1, 2, -18, 3, 3],
  [-5, 2.5, -23, 3, 3],
  [-5, 3.5, -28, 2.5, 2.5],
  [0, 4.2, -30, 3, 3],
  [5, 5, -32, 3, 3],
  [10, 6, -36, 2.5, 2.5],
  [10, 6.5, -42, 1.5, 6],
  [10, 7.5, -50, 6, 6],
];

LEVEL.forEach(([x, y, z, w, d], i) => {
  const tex = baseTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(w / 2, d / 2);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat(COLORS[i % COLORS.length], { map: tex }));
  m.position.set(x, y - 0.5, z);
  scene.add(m);
  boxes.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - 1, maxY: y, minZ: z - d / 2, maxZ: z + d / 2 });
});

// Монеты и звезда-цель
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8).rotateX(Math.PI / 2);
LEVEL.slice(1, 10).forEach(([x, y, z]) => {
  const c = new THREE.Mesh(coinGeo, mat(0xffd800, { emissive: 0x665500 }));
  c.position.set(x, y + 1.3, z);
  scene.add(c);
  coins.push(c);
});
const goalPos = LEVEL[LEVEL.length - 1];
const goal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), mat(0xfff176, { emissive: 0x887700 }));
goal.position.set(goalPos[0], goalPos[1] + 1.6, goalPos[2]);
scene.add(goal);

// ---------- Игрок (кубический человечек) ----------
const player = new THREE.Group();
const part = (w, h, d, color, y) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = y;
  player.add(m);
};
part(0.6, 0.4, 0.35, 0x1565c0, 0.2);   // ноги
part(0.7, 0.6, 0.4, 0xd32f2f, 0.7);    // тело
part(0.45, 0.45, 0.45, 0xffcc99, 1.25); // голова
part(0.5, 0.15, 0.5, 0xd32f2f, 1.55);  // кепка
scene.add(player);

// Круглая "теневая клякса" под ногами, как в играх на N64
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
);
scene.add(shadow);

// ---------- Управление ----------
const keys = {};
let jumpBuf = 0;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { jumpBuf = 0.15; e.preventDefault(); }
  if (e.code === 'KeyR') location.reload();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
let camA = 0;
addEventListener('mousemove', (e) => { if (e.buttons) camA -= e.movementX * 0.008; });

// ---------- Физика ----------
const HW = 0.35, H = 1.6, SPEED = 7, GRAV = 30, JUMP = 11;
const p = new THREE.Vector3(0, 0, 0);
const v = new THREE.Vector3();
let onGround = false, coyote = 0, face = 0, got = 0, time = 0, won = false;

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
    } else if (axis === 'x') {
      p.x = d > 0 ? b.minX - HW : b.maxX + HW;
    } else {
      p.z = d > 0 ? b.minZ - HW : b.maxZ + HW;
    }
  }
}

const hud = document.getElementById('hud');
const msg = document.getElementById('msg');

function update(dt) {
  // камера
  camA += ((keys.ArrowLeft || keys.KeyQ ? 1 : 0) - (keys.ArrowRight || keys.KeyE ? 1 : 0)) * 2 * dt;

  // бег относительно камеры
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let dx = -Math.sin(camA) * f + Math.cos(camA) * r;
  let dz = -Math.cos(camA) * f - Math.sin(camA) * r;
  const len = Math.hypot(dx, dz);
  if (len > 0) { dx /= len; dz /= len; face = Math.atan2(dx, dz); }
  v.x = dx * SPEED;
  v.z = dz * SPEED;

  // прыжок (с "койот-таймом" и буфером нажатия)
  coyote = onGround ? 0.1 : coyote - dt;
  jumpBuf -= dt;
  if (jumpBuf > 0 && coyote > 0) { v.y = JUMP; coyote = 0; jumpBuf = 0; }
  v.y -= GRAV * dt;

  onGround = false;
  move('x', v.x * dt);
  move('z', v.z * dt);
  move('y', v.y * dt);

  if (p.y < -15) { p.set(0, 0, 0); v.set(0, 0, 0); } // упал: на старт

  // монеты и цель
  for (let i = coins.length - 1; i >= 0; i--) {
    coins[i].rotation.y += dt * 4;
    if (coins[i].position.distanceTo(new THREE.Vector3(p.x, p.y + 0.8, p.z)) < 1) {
      scene.remove(coins[i]); coins.splice(i, 1); got++;
    }
  }
  goal.rotation.y += dt * 2;
  if (!won && goal.position.distanceTo(new THREE.Vector3(p.x, p.y + 0.8, p.z)) < 1.4) {
    won = true;
    msg.style.display = 'flex';
    msg.innerHTML = `ЗВЕЗДА!<br>Время: ${time.toFixed(1)} с, монет: ${got}/9<br>R: сыграть ещё`;
  }
  if (!won) time += dt;
  hud.textContent = `МОНЕТЫ ${got}/9   ВРЕМЯ ${time.toFixed(1)}`;

  // модель, тень, камера
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

  const want = new THREE.Vector3(p.x + Math.sin(camA) * 8, p.y + 4.5, p.z + Math.cos(camA) * 8);
  camera.position.lerp(want, 1 - Math.exp(-6 * dt));
  camera.lookAt(p.x, p.y + 1.2, p.z);
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}
loop();
