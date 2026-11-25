/* Presentación de Diseños — visor 3D de cocinas, placares y vanitorys, con las cotas de SketchUp.
   Dos modos:
     • Taller (sin ?p= en la dirección): se carga el modelo desde los archivos y se publica el link.
     • Cliente (…/?p=<id>): se baja la propuesta publicada y solo se mira. */
(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Enganchar un botón que no existe no tiene que tumbar toda la página (pasa si quedó mezclada
// una versión vieja de index.html con una nueva de app.js).
const on = (sel, ev, fn) => {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.addEventListener(ev, fn);
  else console.warn('No está en la página:', sel);
};
// Número de versión, visible en Ajustes. Subilo junto con el CACHE de sw.js al publicar:
// sirve para saber de un vistazo si el navegador está corriendo la versión nueva o una vieja.
const APP_VER = 'v17';
const FACT = { mm: 1, cm: 10, m: 1000, in: 25.4 };     // unidad del archivo → mm
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Medida en mm escrita según la preferencia de la propuesta.
let fmtMode = 'mm';
function medida(mm, texto) {
  if (fmtMode === 'sketchup' && texto) return texto;
  if (fmtMode === 'cm') return nf(mm / 10, mm % 10 ? 1 : 0) + ' cm';
  if (fmtMode === 'm') return nf(mm / 1000, 2) + ' m';
  return String(Math.round(mm));   // en mm, sin punto de miles: 1583, no 1.583
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ───────────── Guardado en este dispositivo (IndexedDB) ───────────── */

const DB_NAME = 'presentacion-disenos';
let dbp = null;
function openDB() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('proyectos', { keyPath: 'id' });
        r.result.createObjectStore('files', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const store = {
  list: () => tx('proyectos', 'readonly', (s) => s.getAll()),
  get: (id) => tx('proyectos', 'readonly', (s) => s.get(id)),
  put: (p) => tx('proyectos', 'readwrite', (s) => s.put(p)),
  getFile: (id) => tx('files', 'readonly', (s) => s.get(id)),
  putFile: (id, blob) => tx('files', 'readwrite', (s) => s.put({ id, blob })),
  getTex: (id) => tx('files', 'readonly', (s) => s.get(id + '/tex')),
  putTex: (id, tex) => tx('files', 'readwrite', (s) => s.put({ id: id + '/tex', tex })),
  async del(id) {
    await tx('proyectos', 'readwrite', (s) => s.delete(id));
    await tx('files', 'readwrite', (s) => s.delete(id));
    await tx('files', 'readwrite', (s) => s.delete(id + '/tex'));
  },
};

/* ───────────── Servidor (Supabase) ─────────────
   La propuesta publicada va al bucket público "pd-modelos", adentro de una carpeta con un número
   al azar: solo llega quien recibe el link. Guardar ahí pide la cuenta de administrador, una sola
   vez por computadora (la sesión queda guardada y se renueva sola). El cliente no necesita nada:
   solo lee, y no hay forma de que cambie nada desde el visor. */

const CFG = window.SUPABASE_CONFIG || {};
const cloudOn = !!(CFG.url && CFG.anonKey && window.supabase);
const T_PROY = 'pd_proyectos', BUCKET = 'pd-modelos';
// Sin sesión de ningún tipo: la página entra siempre como invitada. Lo que se puede y lo que
// no lo deciden las reglas del servidor, no una cuenta. Por eso nunca pide contraseña.
const sb = cloudOn ? window.supabase.createClient(CFG.url, CFG.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null;
const pubUrl = (path) => `${CFG.url}/storage/v1/object/public/${BUCKET}/${path}`;
const clientLink = (id) => `${location.origin}${location.pathname}?p=${id}`;

const TEX_RE = /\.(png|jpe?g|gif|bmp|webp|tga)$/i;
const texKey = (name) => {
  let n = String(name).split(/[\\/]/).pop();
  try { n = decodeURIComponent(n); } catch (e) { /* nombre con % suelto */ }
  return n.replace(/[^\w.\-]+/g, '_').toLowerCase();
};

/* ───────────── Visor 3D ───────────── */

const viewerEl = $('#viewer');
const labelsEl = document.createElement('div');
labelsEl.id = 'labels';
labelsEl.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
$('#stage').appendChild(labelsEl);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
// Los cargadores pasan colores y texturas a espacio lineal para calcular la luz; acá se vuelven a
// sRGB al mostrarlos. Sin esto todo se ve más oscuro y apagado que en SketchUp.
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Curva de exposición de cámara de fotos: los blancos de la melamina no se "queman" y los brillos
// de los frentes tienen degradé en vez de una mancha blanca.
// La curva se aplica en la última pasada (ver pasadaFinal), no acá: todo el dibujo pasa por el
// compositor y recién al final se convierte a los colores de la pantalla.
renderer.toneMapping = THREE.NoToneMapping;
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
viewerEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Fondo: degradé suave de estudio (también queda en la foto que se descarga).
scene.background = (() => {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#f2f5f8'); g.addColorStop(0.5, '#dde3ea'); g.addColorStop(1, '#b7c0cb');
  const x = c.getContext('2d');
  x.fillStyle = g; x.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
})();

// Luz del ambiente: un "estudio" de verdad (paredes, techo con dos paneles de luz y una ventana
// grande de costado), difuminado con PMREM. Es lo que hace que la melamina tenga el degradé suave
// de un ambiente real en vez del brillo plano de siempre, y que los cantos se recorten.
const envTex = (() => {
  const s = new THREE.Scene();
  const caja = new THREE.BoxGeometry(1, 1, 1);
  const panel = (color, fuerza, pos, escala, rot) => {
    const m = new THREE.Mesh(caja, new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: fuerza, side: THREE.DoubleSide,
    }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(escala[0], escala[1], escala[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    s.add(m);
    return m;
  };
  // Cuarto: paredes claras, piso más oscuro (así lo de abajo del mueble no se ve lavado).
  const cuarto = new THREE.Mesh(caja, new THREE.MeshStandardMaterial({ color: 0xcfd4da, side: THREE.BackSide, roughness: 1 }));
  cuarto.scale.set(16, 10, 16);
  cuarto.position.y = 3;
  s.add(cuarto);
  panel(0x6b7076, 1, [0, -1.9, 0], [16, 0.1, 16]);          // piso gris
  panel(0xffffff, 3, [0, 7.4, 0], [7, 0.1, 5]);             // plafón principal
  panel(0xffffff, 2, [3.5, 7.4, 3.5], [3, 0.1, 3]);         // segundo plafón
  panel(0xfff4e6, 4.5, [-7.4, 3.2, 1], [0.1, 5, 7]);        // ventana lateral, luz cálida
  panel(0xdfe6ee, 1.8, [7.4, 3.0, -1], [0.1, 4, 6]);        // rebote frío del otro lado
  const pm = new THREE.PMREMGenerator(renderer);
  pm.compileEquirectangularShader();
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  s.traverse((o) => { if (o.material) o.material.dispose(); });
  caja.dispose();
  return env;
})();
scene.environment = envTex;

scene.add(new THREE.HemisphereLight(0xffffff, 0xbfc6cf, 0.12));
// Luz principal: acompaña a la cámara, así la cara que se mira nunca queda en sombra.
// Va floja a propósito: con la luz principal fuerte, la cara que mirás se quema y la textura
// pierde color (una melamina roble se iba a beige lavado). El grueso de la luz lo pone el
// ambiente, que viene de todas las direcciones y no mancha.
const key = new THREE.DirectionalLight(0xfff4e8, 0.70);   // luz principal, apenas cálida
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xe4edf8, 0.15);   // relleno frío, como el rebote de una pared
scene.add(fill);
// Sol fijo: es el único que tira sombra, para que la sombra del piso no gire al mover la vista.
const sun = new THREE.DirectionalLight(0xffffff, 0.45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const camP = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
const camO = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
let camera = camP;
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 0.05;
controls.zoomSpeed = 0.9;

// Piso que solo recibe la sombra (no se ve el plano, solo la sombra).
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.2 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

let modelRoot = null;       // raíz del modelo tal como la devuelve el cargador
let pickMeshes = [];        // mallas para el clic / medición
let lineMats = [];          // materiales de línea (necesitan el tamaño del visor)
let edgeGroupVisible = true;
let dirty = true;
const requestRender = () => { dirty = true; };

/* ───────────── Compositor: sombras de rincón y curva de exposición ─────────────
   Todo se dibuja primero en una imagen interna; ahí se calculan las sombras suaves de los
   rincones (lo que más "arma" un render de muebles) y al final se pasa a la pantalla con la
   curva de una cámara de fotos. */

// Última pasada: curva ACES (como la de un render) + colores de pantalla. Va a mano porque el
// compositor dibuja en espacio lineal y el motor no la aplica solo.
const pasadaFinalShader = {
  uniforms: { tDiffuse: { value: null }, exposicion: { value: 1.24 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposicion;
    varying vec2 vUv;
    vec3 rrt(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 c) {
      const mat3 ent = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 sal = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      return clamp(sal * rrt(ent * c), 0.0, 1.0);
    }
    vec3 aSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c));
    }
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(aSRGB(aces(t.rgb * exposicion)), t.a);
    }`,
};

let composer = null, renderPass = null, ssaoPass = null, pasadaFinal = null;
let realista = true;   // sombras de rincón + materiales con brillo de estudio

function armarCompositor() {
  const w = Math.max(1, viewerEl.clientWidth), h = Math.max(1, viewerEl.clientHeight);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });  // bordes sin escalera
  composer = new THREE.EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  renderPass = new THREE.RenderPass(scene, camera);
  ssaoPass = new THREE.SSAOPass(scene, camera, w, h);
  ssaoPass.beautyRenderTarget.samples = 4;
  // Las líneas gruesas de los bordes no se pueden dibujar con el material plano que usa el
  // cálculo de rincones (son geometría instanciada): se esconden solo durante ese paso.
  const original = ssaoPass.renderOverride.bind(ssaoPass);
  ssaoPass.renderOverride = (r, mat, target, cc, ca) => {
    const ocultos = [];
    scene.traverse((o) => { if ((o.isLineSegments2 || o.isLine) && o.visible) { o.visible = false; ocultos.push(o); } });
    try { original(r, mat, target, cc, ca); } finally { ocultos.forEach((o) => { o.visible = true; }); }
  };
  pasadaFinal = new THREE.ShaderPass(pasadaFinalShader);
  pasadaFinal.renderToScreen = true;
  armarPasadas();
}

function armarPasadas() {
  if (!composer) return;
  composer.passes.length = 0;
  // Con rincones, SSAOPass dibuja la escena él mismo: no hace falta la pasada normal.
  composer.addPass(realista ? ssaoPass : renderPass);
  composer.addPass(pasadaFinal);
  requestRender();
}

// Hasta dónde llega la sombra de un rincón, en metros: en una cocina, el encuentro de dos placas
// oscurece unos pocos centímetros alrededor.
let radioAO = 0.07;
function ajustarAO(span) {
  radioAO = Math.min(0.30, Math.max(0.08, span * 0.035));
}

/* Planos de corte pegados al mueble. Con el rango enorme de antes (de 1 cm a 280 m) la medida de
   profundidad perdía toda la resolución y el cálculo de rincones daba siempre "sin sombra".
   Acá se ajustan a lo que realmente ocupa el mueble en pantalla, que es lo que se está mirando. */
function ajustarPlanos() {
  if (modelBox.isEmpty()) return;
  const r = (modelBox.getSize(new THREE.Vector3()).length() * 0.5) || 1;
  const d = camera.position.distanceTo(controls.target) || r;
  camP.near = Math.max(d - r * 1.25, r * 0.004);
  camP.far = d + r * 4;
  camP.updateProjectionMatrix();
  camO.near = -r * 4;
  camO.far = d + r * 4;
  camO.updateProjectionMatrix();
}

function dibujar() {
  ajustarPlanos();
  if (composer) {
    renderPass.camera = camera;
    ssaoPass.camera = camera;
    // El radio va en metros, pero los dos límites van en profundidad normalizada (0 a 1 entre los
    // planos de la cámara), que cambia al acercarse o alejarse: se recalculan en cada dibujo.
    const rango = Math.max(0.001, camera.far - camera.near);
    ssaoPass.kernelRadius = radioAO;
    ssaoPass.minDistance = 0.0015 / rango;   // 1,5 mm: evita que una cara se sombree a sí misma
    ssaoPass.maxDistance = 0.30 / rango;     // 30 cm: más lejos ya no es un rincón
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

const lineRes = new THREE.Vector2(1, 1);
function resize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  lineRes.set(w, h);
  lineMats.forEach((m) => m.resolution.copy(lineRes));
  camP.aspect = w / h;
  camP.updateProjectionMatrix();
  syncOrtho();
  requestRender();
}
new ResizeObserver(resize).observe(viewerEl);

// La cámara ortogonal encuadra lo mismo que la de perspectiva a la distancia actual.
function syncOrtho() {
  const d = camO.position.distanceTo(controls.target) || 1;
  const h = 2 * Math.tan((camP.fov * Math.PI) / 360) * d;
  const w = h * (camP.aspect || 1);
  camO.left = -w / 2; camO.right = w / 2; camO.top = h / 2; camO.bottom = -h / 2;
  camO.updateProjectionMatrix();
}

function tick() {
  requestAnimationFrame(tick);
  const moved = controls.update();
  if (!moved && !dirty) return;
  dirty = false;
  if (camera === camO) syncOrtho();
  placeLights();
  dibujar();
  drawLabels();
}
requestAnimationFrame(tick);

// La luz principal acompaña a la cámara, apenas arriba y a la izquierda: los costados quedan un
// poco más oscuros que el frente y nada se va a negro.
const _r = new THREE.Vector3(), _u = new THREE.Vector3();
function placeLights() {
  const dist = camera.position.distanceTo(controls.target) || 1;
  _r.setFromMatrixColumn(camera.matrixWorld, 0);
  _u.setFromMatrixColumn(camera.matrixWorld, 1);
  key.position.copy(camera.position).addScaledVector(_r, -0.5 * dist).addScaledVector(_u, 0.75 * dist);
  key.target.position.copy(controls.target);
  fill.position.copy(camera.position).addScaledVector(_r, 0.8 * dist).addScaledVector(_u, -0.2 * dist);
}

const dumpCam = () => { camera.updateMatrixWorld(); camera.updateProjectionMatrix(); };

function setOrtho(on) {
  const next = on ? camO : camP;
  if (next === camera) return;
  next.position.copy(camera.position);
  next.quaternion.copy(camera.quaternion);
  next.up.copy(camera.up);
  camera = next;
  controls.object = camera;
  controls.update();
  syncOrtho();
  dumpCam();
  // El cálculo de rincones usa una fórmula distinta según el tipo de cámara.
  if (ssaoPass) {
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    [ssaoPass.ssaoMaterial, ssaoPass.depthRenderMaterial].forEach((m) => {
      if (!m || !m.defines) return;
      m.defines.PERSPECTIVE_CAMERA = persp;
      m.needsUpdate = true;
    });
  }
  requestRender();
}

let modelBox = new THREE.Box3();   // solo el mueble (las medidas generales salen de acá)
let fitBox = new THREE.Box3();     // el mueble + las cotas, para que al encuadrar entre todo
function fitCamera(dir) {
  if (fitBox.isEmpty()) return;
  const size = fitBox.getSize(new THREE.Vector3());
  const center = fitBox.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 1;
  const d = (dir || new THREE.Vector3(0.75, 0.5, 1)).clone().normalize();
  const dist = r * 2.1;
  camP.near = r / 500; camP.far = r * 60;
  camP.updateProjectionMatrix();
  camera.position.copy(center).addScaledVector(d, dist);
  camera.up.set(0, 1, 0);
  if (Math.abs(d.y) > 0.98) camera.up.set(0, 0, -1); // vista en planta
  controls.target.copy(center);
  controls.update();
  syncOrtho();
  requestRender();
}

const VIEWS = {
  iso: [0.75, 0.5, 1], front: [0, 0, 1], back: [0, 0, -1],
  left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0],
};

function clearScene() {
  if (!modelRoot) return;
  scene.remove(modelRoot);
  modelRoot.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  modelRoot = null;
  pickMeshes = [];
  lineMats = [];
  cotas = [];
  modulos = [];
  materiales = [];
  pararAperturas();
  clearMeasures();
  labelsEl.textContent = '';
}

/* ───────────── Lectura del modelo ───────────── */

// SketchUp llama "instance_0", "instance_1"… a las instancias sin nombre y deja el nombre del
// componente solo en <library_nodes>; ColladaLoader lo pierde. Se lo devolvemos a la instancia,
// así los módulos aparecen con su nombre.
function patchDaeNames(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return text;
  const defNames = new Map();
  const lib = doc.getElementsByTagName('library_nodes')[0];
  if (lib) for (const n of lib.getElementsByTagName('node')) defNames.set(n.getAttribute('id'), n.getAttribute('name') || '');
  for (const inst of [...doc.getElementsByTagName('instance_node')]) {
    const node = inst.parentNode;
    if (!node || node.localName !== 'node') continue;
    const def = defNames.get((inst.getAttribute('url') || '').replace(/^#/, ''));
    const own = node.getAttribute('name') || '';
    if (!usable(own) && usable(def)) node.setAttribute('name', def);
  }
  return new XMLSerializer().serializeToString(doc);
}

const whitePixel = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1);
  return c.toDataURL();
})();

let texUrls = [];
let texMissing = 0;
function texManager(tex) {
  texUrls.forEach((u) => URL.revokeObjectURL(u));
  texUrls = [];
  texMissing = 0;
  const urls = {};
  Object.entries(tex || {}).forEach(([k, blob]) => { urls[k] = URL.createObjectURL(blob); texUrls.push(urls[k]); });
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob|data):/i.test(url)) return url;
    const hit = urls[texKey(url)];
    if (!hit) { texMissing++; console.warn('Falta la textura:', url); }
    return hit || whitePixel;
  });
  manager.onLoad = () => { relieveDeLasTexturas(modelRoot); requestRender(); };
  manager.onError = () => {};
  return manager;
}

async function parseModel(blob, ext, tex) {
  const manager = texManager(tex);
  if (ext === 'dae') return new THREE.ColladaLoader(manager).parse(patchDaeNames(await blob.text()), '').scene;
  if (ext === 'obj') return new THREE.OBJLoader(manager).parse(await blob.text());
  if (ext === 'glb' || ext === 'gltf') {
    const buf = await blob.arrayBuffer();
    return new Promise((res, rej) => new THREE.GLTFLoader(manager).parse(buf, '', (g) => res(g.scene), rej));
  }
  throw new Error('No se puede abrir un archivo .' + ext);
}

const GENERIC = /^(skp_camera.*|sketchup_instance_?\d*|instance_?\d*|group_?\d*|id\d+|geometry\d*|mesh\d*|node\d*|object\d*|default|scene|sketchup|collada visual scene group|material\d*)$/i;
const usable = (n) => !!n && !GENERIC.test(String(n).trim());
const cleanName = (n) => String(n).trim().replace(/#\d+$/, '').replace(/\.\d{3}$/, '').replace(/_+/g, ' ').trim() || 'Pieza';
const isModelMesh = (o) => o.isMesh && !o.isLineSegments2;
const hasMesh = (o) => { let f = false; o.traverse((c) => { if (isModelMesh(c)) f = true; }); return f; };

// Texturas como las ve SketchUp: se repiten, con mipmaps y filtro en diagonal (anisotropía).
// Sin esto las vetas de la madera se ven borrosas o con "escalera" al mirar de costado.
function tuneMap(map) {
  if (!map || map.userData.tuned) return map;
  map.userData.tuned = true;
  map.anisotropy = maxAniso;
  map.encoding = THREE.sRGBEncoding;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/* ───────────── Relieve de las superficies ─────────────
   En SketchUp la melamina es un color liso, sin textura. Sin relieve la luz le pega plana y se
   ve como plástico. Acá se arman de una vez unos mapas de relieve (poro de melamina, veta de
   madera) que se aplican a todos los materiales en su medida real. */

const ruido = new THREE.SimplexNoise();

// Ruido que cierra bien al repetirse (se muestrea sobre un toro): sin esto se ven las junturas
// del dibujo cada vez que se repite.
function ruidoCiclico(u, v, fu, fv) {
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  return ruido.noise4d(Math.cos(a) * fu, Math.sin(a) * fu, Math.cos(b) * fv, Math.sin(b) * fv);
}

// Pasa un mapa de alturas a mapa de normales (el formato que entiende el motor para el relieve).
function normalDesdeAlturas(w, h, alt, fuerza) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const at = (x, y) => alt[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * fuerza;
      const dy = (at(x, y + 1) - at(x, y - 1)) * fuerza;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

function mapaDeRelieve(size, altura, fuerza) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = altura(x / size, y / size);
  return normalDesdeAlturas(size, size, h, fuerza);
}

/* Relieve sacado de la propia textura: lo oscuro de la imagen se hunde y lo claro sobresale. Es
   lo que hace que la veta de una madera o el grano de un granito se vean con profundidad en vez
   de parecer una calcomanía pegada sobre una tabla lisa. */
function relieveDeTextura(map) {
  const img = map.image;
  const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height);
  if (!iw || !ih) return null;
  const esc = Math.min(1, 512 / Math.max(iw, ih));
  const w = Math.max(2, Math.round(iw * esc)), h = Math.max(2, Math.round(ih * esc));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let d;
  try { d = ctx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
  const alt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alt[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  const t = normalDesdeAlturas(w, h, alt, 1.6);
  // El relieve tiene que caer exactamente sobre el dibujo de la textura.
  t.wrapS = map.wrapS; t.wrapT = map.wrapT;
  t.repeat.copy(map.repeat); t.offset.copy(map.offset);
  t.center.copy(map.center); t.rotation = map.rotation;
  t.matrixAutoUpdate = map.matrixAutoUpdate;
  return t;
}

// Cuando terminan de cargarse las imágenes, cada material con textura recibe su relieve.
function relieveDeLasTexturas(root) {
  if (!root) return;
  root.traverse((o) => {
    if (!isModelMesh(o)) return;
    (o.userData.mats || []).forEach((e) => {
      const m = e.mat;
      if (!m.map || m.userData.relieveHecho || m.metalness > 0.5) return;
      m.userData.relieveHecho = true;
      const n = relieveDeTextura(m.map);
      if (!n) { m.userData.relieveHecho = false; return; }
      m.normalMap = n;
      m.normalScale = new THREE.Vector2(0.6, 0.6);
      m.needsUpdate = true;
    });
  });
  requestRender();
}

// Poro fino de melamina: granito muy chico, apenas perceptible, pero es lo que corta el aspecto
// de plástico cuando la luz pasa por encima.
const relievePoro = mapaDeRelieve(256, (u, v) => (
  ruidoCiclico(u, v, 40, 40) * 0.6 + ruidoCiclico(u, v, 90, 90) * 0.4
), 1.1);

/* El mismo poro, más chico, para las superficies lisas. Una melamina blanca sin foto encima es
   el caso más difícil: la luz le pega pareja y dos puertas pegadas parecen una sola plancha.
   Necesita bastante poro para despegarse, pero con el dibujo grande se vería como una pared
   revocada; achicándolo queda la piel mate de la melamina. */
const relievePoroFino = relievePoro.clone();
relievePoroFino.repeat.set(2.6, 2.6);
relievePoroFino.needsUpdate = true;

// Veta de madera: estirada en el largo de la pieza, con líneas finas atravesadas.
const relieveVeta = mapaDeRelieve(512, (u, v) => {
  const base = ruidoCiclico(u, v, 2, 26);
  const fino = ruidoCiclico(u, v, 5, 70) * 0.35;
  return Math.sin((v * 18 + base * 2.2) * Math.PI) * 0.5 + fino;
}, 2.2);

/* Coordenadas de textura: SketchUp no las exporta en las caras pintadas con un color liso, y sin
   ellas el relieve no se puede aplicar. Se generan por proyección plana según hacia dónde mira
   cada cara, en metros reales, así el poro mide lo mismo en todas las piezas del mueble. */
const BALDOSA = 0.22;   // metros que ocupa un "azulejo" del relieve

function asegurarUV(mesh, metrosPorUnidad) {
  let geo = mesh.geometry;
  if (geo.attributes.uv) return;
  if (geo.index) { geo = geo.toNonIndexed(); mesh.geometry = geo; }
  const pos = geo.attributes.position;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const k = metrosPorUnidad / BALDOSA;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), nor = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    nor.copy(c).sub(b).cross(ab.copy(a).sub(b));
    const ax = Math.abs(nor.x), ay = Math.abs(nor.y), az = Math.abs(nor.z);
    const eje = ax > ay && ax > az ? 0 : ay > az ? 1 : 2;   // hacia dónde mira la cara
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? a : j === 1 ? b : c;
      uv[(i + j) * 2] = (eje === 0 ? v.y : v.x) * k;
      uv[(i + j) * 2 + 1] = (eje === 2 ? v.y : v.z) * k;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* Acabado según el nombre del material de SketchUp. Es lo que diferencia una melamina mate de un
   frente laqueado o de una mesada de granito: el tamaño y la nitidez del reflejo. */
// Ojo con los pedazos de palabra: "placa" contiene "laca" y "material" contiene "mate". Por eso
// cada acabado va con límite de palabra (\b), si no las placas salían laqueadas y brillantes.
const ACABADOS = [
  { re: /\b(espejo|mirror)/i,                                              rug: 0.03, met: 1.0 },
  { re: /\b(vidrio|glass|cristal|transparente)/i,                          rug: 0.05, met: 0.0, vidrio: true },
  { re: /\b(acero|inox|alumin|metal|cromo|n[ií]quel|bronce|hierro)/i,      rug: 0.28, met: 0.92 },
  { re: /\b(granito|m[áa]rmol|marmol|silestone|cuarzo|piedra|porcelan)/i,  rug: 0.16, met: 0.0, barniz: 0.55 },
  { re: /\b(laca|laquead|brillante|gloss|acr[íi]lic|poliuretano)/i,        rug: 0.10, met: 0.0, barniz: 0.85 },
  { re: /\b(madera|roble|nogal|cedro|pino|wood|petiribi|para[íi]so|guatambu|haya|olmo|teca|cerezo|fresno)/i,
                                                                           rug: 0.52, met: 0.0, veta: true },
  { re: /\b(tela|textil|cortina|tapiz|lino|pa[ñn]o)/i,                     rug: 0.96, met: 0.0 },
  { re: /\b(pl[áa]stic|pvc|abs)\b/i,                                       rug: 0.42, met: 0.0 },
  { re: /\b(melamina|mdf|aglomer|mate|filo|canto|tapacanto|borde|placa)\b/i, rug: 0.70, met: 0.0 },
];

function acabadoDe(nombre) {
  const n = String(nombre || '').replace(/_/g, ' ');
  return ACABADOS.find((a) => a.re.test(n)) || { rug: 0.62, met: 0.0 };
}

// Los cargadores devuelven materiales Phong (brillo plano). Para la presentación se pasan a
// Standard/Physical: la luz del ambiente se refleja suave y los frentes se ven como en un render.
/* ¿El archivo trae cada cara dos veces?

   SketchUp exporta el .dae con las caras por duplicado: una copia con el material del frente y
   otra con el del dorso, pegadas en el mismo lugar. Cuando pintás sólo del lado que se ve, la
   copia de atrás queda con el celeste de "sin pintar" (#a2b7c6). Dibujando las dos caras de cada
   triángulo, esa copia celeste tapaba a la pintada y la cocina entera se veía celeste.

   Si el modelo trae los pares, se dibuja una sola cara de cada triángulo: cada lado muestra lo
   suyo y no hay dos copias peleando. Si no los trae (un .obj, un .glb, o un .dae exportado sin
   doble cara), se siguen dibujando las dos, que es lo que evita que aparezcan agujeros. */
function caraDuplicada(root) {
  let total = 0, pares = 0;
  root.traverse((o) => {
    if (!isModelMesh(o)) return;
    total++;
    const g = o.geometry.groups;
    if (g && g.length === 2 && g[0].count === g[1].count) pares++;
  });
  return pares >= 8 && pares / total > 0.3;
}

function toStandard(mat, unaCara) {
  const map = tuneMap(mat.map);
  const nm = String(mat.name || '');
  const ac = acabadoDe(nm);
  const vidrio = ac.vidrio || (mat.transparent && mat.opacity < 0.92);
  const datos = {
    name: mat.name,
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    map: map || null,
    side: unaCara ? THREE.FrontSide : THREE.DoubleSide,
    transparent: !!mat.transparent,
    opacity: mat.opacity != null ? mat.opacity : 1,
    roughness: vidrio ? 0.05 : ac.rug,
    metalness: ac.met,
    envMapIntensity: 1.35,   // el ambiente pone la mayor parte de la luz (ver la luz principal)
  };
  const m = ac.barniz ? new THREE.MeshPhysicalMaterial({ ...datos, clearcoat: ac.barniz, clearcoatRoughness: 0.06 })
                      : new THREE.MeshStandardMaterial(datos);
  // Relieve: veta para las maderas, poro fino para el resto (el metal y el vidrio van lisos).
  if (!vidrio && ac.met < 0.5) {
    // Una melamina blanca lisa, sin foto encima, es lo que peor se ve: la luz le pega pareja y
    // dos puertas pegadas parecen una sola plancha. A esas se les carga más el poro, que es lo
    // que les da piel y las despega entre sí. Donde hay textura el poro va suave, para no
    // ensuciar el dibujo de la madera.
    const liso = !map;
    const claro = (datos.color.r + datos.color.g + datos.color.b) / 3 > 0.45;
    m.normalMap = ac.veta ? relieveVeta : liso ? relievePoroFino : relievePoro;
    const poro = ac.veta ? 0.45 : liso && claro ? 0.45 : liso ? 0.30 : 0.18;
    m.normalScale = new THREE.Vector2(poro, poro);
  }
  if (vidrio) { m.opacity = Math.min(m.opacity, 0.28); m.transparent = true; m.depthWrite = false; }
  // Las caras van un poquito "atrás" para que las líneas de los bordes se dibujen por encima.
  m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
  m.userData.relievePropio = !!m.normalMap;
  return m;
}

const EDGE_COLOR = 0x3b4350;
function prepareMaterials(root, ext) {
  const unaCara = caraDuplicada(root);
  const meshes = [];
  root.traverse((o) => { if (isModelMesh(o)) meshes.push(o); });
  root.updateMatrixWorld(true);
  const esc = new THREE.Vector3();
  meshes.forEach((m) => {
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    // Medida real de la pieza, para que el poro de la melamina tenga el mismo tamaño en todas.
    m.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), esc);
    asegurarUV(m, Math.abs(esc.x) || 1);
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
      const c = toStandard(mat, unaCara);
      if (ext === 'obj' && !c.map) c.color.copy(lin(0xd9b98a));
      return c;
    });
    m.material = Array.isArray(m.material) ? list : list[0];
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.mats = list.map((mat) => ({ mat, color: mat.color.clone(), opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite }));

    const lineGeo = new THREE.LineSegmentsGeometry().setPositions(buildEdges(m.geometry, 25, unaCara).attributes.position.array);
    // Sobre melamina blanca la línea del borde es lo único que separa una puerta de la de al
    // lado, sobre todo en el celular, donde el cálculo de rincones arranca apagado. Antes era
    // tan suave que el mueble parecía una plancha sola.
    const lineMat = new THREE.LineMaterial({ color: EDGE_COLOR, linewidth: 1.35, transparent: true, opacity: 0.78, resolution: lineRes.clone() });
    lineMats.push(lineMat);
    const edges = new THREE.LineSegments2(lineGeo, lineMat);
    edges.raycast = () => {};
    edges.renderOrder = 1;
    edges.userData.isEdges = true;
    m.add(edges);
    m.userData.edges = edges;
  });
}

// Como THREE.EdgesGeometry, pero ignora las caras "de atrás" que exporta SketchUp: la cara
// delantera y la trasera comparten la diagonal de cada rectángulo y aparecía como una arista.
function buildEdges(geo, thresholdDeg, dobles) {
  const pos = geo.attributes.position, index = geo.index;
  const count = index ? index.count : pos.count;
  const vi = (i) => (index ? index.getX(i) : i);
  const key2 = (v) => `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
  const edges = new Map();
  const ab = new THREE.Vector3(), cb = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const v = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, vi(i + j)));
    const n = cb.subVectors(v[2], v[1]).cross(ab.subVectors(v[0], v[1]));
    if (n.lengthSq() === 0) continue;
    const normal = n.clone().normalize();
    const k = v.map(key2);
    for (let j = 0; j < 3; j++) {
      const a = k[j], b = k[(j + 1) % 3];
      const ek = a < b ? a + '|' + b : b + '|' + a;
      let e = edges.get(ek);
      if (!e) edges.set(ek, (e = { p: v[j], q: v[(j + 1) % 3], normals: [] }));
      e.normals.push(normal);
    }
  }
  const cosThr = Math.cos((thresholdDeg * Math.PI) / 180);
  const out = [];
  /* Con la exportación de doble cara, cada triángulo viene repetido al revés, así que las
     normales de un borde llegan de a pares opuestos. Juntándolas por dirección se puede volver a
     contar cuántas caras de verdad se tocan ahí:
       · una sola dirección y dos triángulos  → es el borde del panel  → se dibuja
       · una sola dirección y cuatro          → es la diagonal con que se parte la cara → no
       · dos direcciones                      → dos caras en ángulo → se dibuja si abre bastante
     Sin esto, un frente plano se quedaba sin contorno y dos puertas blancas pegadas parecían una
     sola plancha. */
  edges.forEach((e) => {
    let draw;
    if (dobles) {
      const dirs = [];
      e.normals.forEach((n) => { if (!dirs.some((d) => Math.abs(d.dot(n)) > 0.9998)) dirs.push(n); });
      draw = dirs.length === 1
        ? e.normals.length <= 2
        : dirs.some((a, x) => dirs.slice(x + 1).some((b) => Math.abs(a.dot(b)) < cosThr));
    } else {
      draw = e.normals.length === 1;
      for (let x = 0; x < e.normals.length && !draw; x++) {
        for (let y = x + 1; y < e.normals.length; y++) {
          const d = e.normals[x].dot(e.normals[y]);
          if (d < cosThr && d > -0.9998) { draw = true; break; }
        }
      }
    }
    if (draw) out.push(e.p.x, e.p.y, e.p.z, e.q.x, e.q.y, e.q.z);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

/* ───────────── Módulos y materiales (para el panel de medidas) ───────────── */

let modulos = [], materiales = [], selMod = null, selMat = null;

// Módulo = primer grupo o componente con nombre bajando desde la raíz (bajo mesada, alacena,
// cajonera…). Los que se repiten iguales se muestran juntos con la cantidad.
function extractModulos(root) {
  const found = [];
  const walk = (node, depth) => {
    for (const c of node.children) {
      if (c.userData.isEdges || !hasMesh(c)) continue;
      if (usable(c.name)) {
        const box = new THREE.Box3().setFromObject(c);
        if (!box.isEmpty()) { found.push({ name: cleanName(c.name), node: c, box }); continue; }
      }
      if (depth < 6) walk(c, depth + 1);
    }
  };
  root.updateMatrixWorld(true);
  walk(root, 0);

  const map = new Map();
  found.forEach((f) => {
    const s = f.box.getSize(new THREE.Vector3());
    const k = [f.name, ...[s.x, s.y, s.z].map((v) => Math.round(v * 1000))].join('|');
    if (!map.has(k)) map.set(k, { name: f.name, nodes: [], box: new THREE.Box3(), size: s });
    const g = map.get(k);
    g.nodes.push(f.node);
    g.box.union(f.box);
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

function extractMateriales(root) {
  const map = new Map();
  root.traverse((o) => {
    if (!isModelMesh(o)) return;
    (o.userData.mats || []).forEach((e) => {
      const nm = usable(e.mat.name) ? cleanName(e.mat.name) : 'Sin nombre';
      if (!map.has(nm)) map.set(nm, { name: nm, mat: e.mat, meshes: new Set() });
      map.get(nm).meshes.add(o);
    });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

// Muestra del material: la textura si tiene, o el color.
function swatch(m) {
  const img = m.mat.map && m.mat.map.image;
  if (img && (img.width || img.naturalWidth)) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      c.getContext('2d').drawImage(img, 0, 0, 32, 32);
      return `background-image:url(${c.toDataURL()});background-size:cover`;
    } catch (e) { /* textura de otro origen */ }
  }
  return 'background:' + '#' + m.mat.color.clone().convertLinearToSRGB().getHexString();
}

/* ───────────── Puertas y cajones ─────────────
   Igual que en Control de piezas: se reconocen por el nombre del grupo en SketchUp. "Puerta…"
   gira 90° sobre la bisagra, "Frente…" o "Cajón…" sale 30 cm, y lo que diga "fijo", "portahorno"
   o "zócalo" no se mueve. Se mueve el grupo entero, así la manija y el interior del cajón van con él.
   Doble clic (o doble toque) sobre una puerta la abre; el botón "Abrir" las mueve todas.

   El sentido lo decide la bisagra del lado de afuera del módulo. Si sale al revés, el que arma la
   propuesta lo corrige y queda guardado en la propuesta (proj.puertas), así el cliente lo ve bien. */

let aperturas = [], seguidores = [], candidatas = [], todoAbierto = false;
const DOOR_RE = /\bpuerta/i;
const DRAWER_RE = /\bfrente|\bcaj[oó]n/i;
// Nada de esto se mueve, aunque el nombre diga "puerta" ("Division Isla lado puertas" es un
// divisor, no una puerta).
const FIXED_RE = /\bfij[oa]s?\b|porta\s*horno|z[oó]calo|divisi[oó]n|division|divisor|tabique|separador/i;
// Partes del cajón: viajan con el frente, pero ninguna es "el frente".
const DRAWER_PART_RE = /costado|lateral|fondo|faja|contrafrente|gu[ií]a|trasera|piso|base|tapa/i;
// Piezas fijas del mueble: no se enganchan a un cajón aunque queden justo detrás del frente.
const FIXED_PART_RE = /estante|tapa|base|piso|techo|z[oó]calo|travesa|regrueso|puerta|frente|faja|barra|riel|costado|fondo|lateral/i;
const UP_V = new THREE.Vector3(0, 1, 0);
const LADOS = { izq: 'Izquierda', der: 'Derecha', arriba: 'Arriba', abajo: 'Abajo', adelante: 'Adelante', atras: 'Atrás', no: 'No se mueve' };

function tipoApertura(n) {
  if (FIXED_RE.test(n)) return '';
  if (DOOR_RE.test(n)) return 'puerta';
  if (DRAWER_RE.test(n) && !DRAWER_PART_RE.test(n)) return 'cajon';
  return '';
}
const salidaCajon = () => 300 / FACT[unitOf(proj)];   // los cajones salen 30 cm

// Una puerta o un frente es siempre una tabla: finita contra lo que mide de ancho y de alto.
// Esto es lo que evita que un grupo llamado "ALACENA 2 PUERTAS" gire como si fuera una puerta.
function esTabla(size) {
  const grueso = Math.min(size.x, size.z);
  const largo = Math.max(size.x, size.y, size.z);
  return largo > 0 && grueso / largo < 0.25;
}
const tieneNombreAdentro = (n) => {
  let hay = false;
  n.traverse((c) => { if (c !== n && !c.userData.isEdges && usable(c.name) && hasMesh(c)) hay = true; });
  return hay;
};

/* Recorre el modelo y separa lo que se mueve de lo que no. Un grupo con nombre de puerta o de
   frente se toma entero (así la manija y el interior del cajón van con él). Si adentro tiene
   piezas con nombre propio — un despiece, donde cada tabla es su propio grupo — se entra y se
   clasifica tabla por tabla. Lo que no es puerta ni frente queda como candidato a viajar con un
   cajón (los costados, el fondo, las guías). */
/* Marcas de apertura del Generador de Muebles.

   Sobre cada puerta el generador dibuja una "V" con dos líneas. La parte abierta de la V apoya
   en la bisagra y la punta señala hacia dónde abre: se ve clarísimo en una alacena de dos
   puertas, donde las dos puntas se juntan en el medio y las bases quedan en los bordes de afuera,
   que es justo donde van las bisagras.

   Es la forma más confiable de encontrar las puertas: en estos modelos los paneles no tienen
   nombre propio (son todos "SketchUp_Instance_43"), así que por nombre no hay con qué agarrarse.
   Y de paso dice de qué lado va cada bisagra, sin tener que adivinarlo. */
function marcasDeApertura(root) {
  const marcas = [];
  const tmp = new THREE.Vector3();
  root.traverse((o) => {
    if (!/^apertura\b/i.test(cleanName(o.name || ''))) return;
    // La marca es una indicación de taller: sirve para saber de qué lado abre, pero en la
    // presentación al cliente afea. Se lee y se esconde.
    o.visible = false;
    const pts = [];
    o.traverse((x) => {
      const at = x.geometry && x.geometry.attributes && x.geometry.attributes.position;
      if (!at || x.isMesh) return;
      x.updateWorldMatrix(true, false);
      for (let i = 0; i < at.count; i++) pts.push(tmp.fromBufferAttribute(at, i).applyMatrix4(x.matrixWorld).clone());
    });
    // Cada V son cuatro puntos seguidos: la punta viene repetida y los otros dos son los
    // extremos del borde de la bisagra.
    for (let i = 0; i + 3 < pts.length; i += 4) {
      const c = pts.slice(i, i + 4);
      let punta = null; const base = [];
      for (const p of c) {
        const repetido = c.filter((q) => q.distanceTo(p) < 0.004).length > 1;
        if (repetido) { if (!punta) punta = p.clone(); } else base.push(p);
      }
      if (!punta || base.length !== 2) continue;
      const medioBisagra = base[0].clone().add(base[1]).multiplyScalar(0.5);
      marcas.push({
        punta,
        bisagra: medioBisagra,
        eje: base[1].clone().sub(base[0]).normalize(),
        centro: medioBisagra.clone().add(punta).multiplyScalar(0.5),
        largo: Math.max(base[0].distanceTo(base[1]), punta.distanceTo(medioBisagra)),
      });
    }
  });
  return marcas;
}

function extractAperturas(root) {
  const hallados = [], sueltas = [], piezas = [];
  // Un grupo que adentro tiene otros grupos con piezas es un mueble, no una pieza: hay que entrar.
  // Un módulo se llama "15-1 PUERTA" y no es una puerta; la puerta está adentro.
  const tieneSubGrupos = (n) => n.children.some((c) => !c.userData.isEdges && !c.isMesh && hasMesh(c));
  const walk = (node, depth) => {
    for (const c of node.children) {
      if (c.userData.isEdges || !hasMesh(c)) continue;
      const nombre = usable(c.name) ? cleanName(c.name) : '';
      const box = new THREE.Box3().setFromObject(c);
      if (box.isEmpty()) continue;
      const tabla = esTabla(box.getSize(new THREE.Vector3()));
      const kind = nombre ? tipoApertura(nombre) : '';
      // Una puerta con nombre y forma de tabla se toma entera, aunque adentro tenga la manija.
      if (kind && tabla) { hallados.push({ name: nombre, node: c, box, kind }); continue; }
      if (depth < 8 && tieneSubGrupos(c)) { walk(c, depth + 1); continue; }
      if (nombre) { sueltas.push({ name: nombre, node: c, box }); piezas.push({ name: nombre, node: c, box }); }
      else piezas.push({ name: '', node: c, box });   // sin nombre: igual puede ser una puerta
    }
  };
  root.updateMatrixWorld(true);
  walk(root, 0);

  /* Cada marca busca el panel que tiene debajo: el más cercano a su centro, del tamaño de la
     marca. Ese panel es la puerta, y la marca le dice dónde va la bisagra. */
  marcasDeApertura(root).forEach((m) => {
    let mejor = null, mejorD = Infinity;
    const mirar = (p) => {
      const s = p.box.getSize(new THREE.Vector3());
      if (!esTabla(s)) return;
      const largo = Math.max(s.x, s.y, s.z);
      if (largo < m.largo * 0.7 || largo > m.largo * 1.8) return;   // no es del tamaño de la marca
      const d = p.box.getCenter(new THREE.Vector3()).distanceTo(m.centro);
      if (d < mejorD) { mejorD = d; mejor = p; }
    };
    hallados.forEach(mirar);   // la puerta puede estar ya encontrada por su nombre
    piezas.forEach(mirar);
    if (!mejor || mejorD > 0.09) return;   // la marca va apoyada sobre la puerta, no lejos
    if (hallados.includes(mejor)) { mejor.kind = 'puerta'; mejor.marca = m; return; }
    hallados.push({ name: mejor.name || 'Puerta', node: mejor.node, box: mejor.box, kind: 'puerta', marca: m });
    const i = sueltas.findIndex((s) => s.node === mejor.node);
    if (i >= 0) sueltas.splice(i, 1);
  });
  // Nombre + número de repetición: el mismo modelo da siempre la misma clave, así el sentido
  // que se guardó la vez pasada vuelve a caer en la misma puerta.
  const vistos = new Map();
  hallados.forEach((a) => {
    const n = (vistos.get(a.name) || 0) + 1;
    vistos.set(a.name, n);
    a.key = a.name + '#' + n;
    a.open = 0;
    a.anim = 0;
    a.base = a.node.matrix.clone();
    a.node.matrixAutoUpdate = false;
  });
  candidatas = sueltas;
  return hallados;
}

/* Qué piezas forman cada cajón, para que salgan con el frente. Primero por geometría: lo que está
   justo detrás del frente, adentro de su ancho y su alto, hasta 75 cm de profundidad. Las piezas
   fijas del mueble quedan afuera por nombre, salvo que digan "caj". Después, por nombre: las que
   comparten la palabra que sigue a "Caj" ("Frente Cajon Inf" ↔ "cajon1 costado"). */
function agruparCajones() {
  seguidores.forEach((s) => { s.node.matrixAutoUpdate = true; });
  seguidores = [];
  const mm = FACT[unitOf(proj)];
  const maxProf = 750 / mm, tol = 40 / mm, eps = 6 / mm;
  const frentes = aperturas.filter((a) => a.kind === 'cajon' && a.out);
  if (!frentes.length || !candidatas.length) return;
  const tomadas = new Set();
  const inter = (box, eje, signo) => (signo > 0
    ? [box.min.getComponent(eje), box.max.getComponent(eje)]
    : [-box.max.getComponent(eje), -box.min.getComponent(eje)]);

  frentes.forEach((f) => {
    const eje = Math.abs(f.out.x) > 0.5 ? 0 : Math.abs(f.out.z) > 0.5 ? 2 : 1;
    const signo = f.out.getComponent(eje) >= 0 ? 1 : -1;
    const otros = [0, 1, 2].filter((i) => i !== eje);
    const fi = inter(f.box, eje, signo);
    const fu = inter(f.box, otros[0], 1), fv = inter(f.box, otros[1], 1);
    candidatas.forEach((c) => {
      if (tomadas.has(c)) return;
      const porNombre = /caj/i.test(c.name);
      if (!porNombre && FIXED_PART_RE.test(c.name)) return;
      const ci = inter(c.box, eje, signo);
      if (ci[1] > fi[0] + eps) return;        // no está detrás del frente
      if (ci[0] < fi[0] - maxProf) return;    // demasiado adentro: es otra cosa
      const cu = inter(c.box, otros[0], 1), cv = inter(c.box, otros[1], 1);
      if (cu[0] < fu[0] - tol || cu[1] > fu[1] + tol) return;
      if (cv[0] < fv[0] - tol || cv[1] > fv[1] + tol) return;
      tomadas.add(c);
      seguidores.push({ node: c.node, follow: f });
    });
  });

  // Segundo criterio: por nombre, dentro del mismo módulo ("7-Frente Caj Inf" ↔ "7-Costado Caj Inf").
  const etiqueta = (nombre) => {
    const t = String(nombre).toLowerCase().split(/[^a-z0-9áéíóúñ]+/i).filter(Boolean);
    const i = t.findIndex((x) => /^caj/.test(x));
    if (i < 0) return null;
    const mod = (String(nombre).match(/\d+/) || [''])[0];   // el número de módulo que abre el nombre
    return mod + '|' + t.slice(i + 1).join(' ');
  };
  const porTag = new Map();
  frentes.forEach((f) => { const e = etiqueta(f.name); if (e) porTag.set(e, f); });
  candidatas.forEach((c) => {
    if (tomadas.has(c)) return;
    const e = etiqueta(c.name);
    const f = e && porTag.get(e);
    if (f) { tomadas.add(c); seguidores.push({ node: c.node, follow: f }); }
  });

  seguidores.forEach((s) => { s.base = s.node.matrix.clone(); s.node.matrixAutoUpdate = false; });
}

// Centro del módulo que contiene la puerta: dice cuál es el lado de afuera. Si la puerta no está
// adentro de ningún módulo con nombre, se usa el centro del mueble entero.
function centroDeReferencia(a, centroModelo) {
  for (let p = a.node.parent; p; p = p.parent) {
    const m = modulos.find((mm) => mm.nodes.includes(p));
    if (m) return m.box.getCenter(new THREE.Vector3());
  }
  return centroModelo.clone();
}

function configurarAperturas() {
  if (!aperturas.length) return;
  const centroModelo = modelBox.getCenter(new THREE.Vector3());
  const fijados = (proj && proj.puertas) || {};
  aperturas.forEach((a) => {
    const size = a.box.getSize(new THREE.Vector3());
    const centro = a.box.getCenter(new THREE.Vector3());
    const ref = centroDeReferencia(a, centroModelo);
    // Eje del espesor (hacia dónde mira la puerta): el más finito entre ancho y profundidad.
    const t = size.x <= size.z ? 0 : 2;
    const w = t === 0 ? 2 : 0;
    const tdir = new THREE.Vector3().setComponent(t, 1);
    const wdir = new THREE.Vector3().setComponent(w, 1);
    const cfg = fijados[a.key];
    a.fijo = !!(cfg && cfg.lado === 'no');   // lo marcaste como que no se mueve
    if (a.fijo) { a.open = 0; a.lado = 'no'; a.auto = false; return; }

    let relT = centro.getComponent(t) - ref.getComponent(t);
    if (Math.abs(relT) < 1e-6) relT = centro.getComponent(t) - centroModelo.getComponent(t);
    const out = tdir.clone().multiplyScalar(relT >= 0 ? 1 : -1);

    if (a.kind === 'cajon') {
      a.lado = cfg && cfg.lado === 'atras' ? 'atras' : 'adelante';
      a.out = a.lado === 'atras' ? out.negate() : out;
      a.auto = !cfg;
      return;
    }

    a.out = out;
    const izqV = new THREE.Vector3().crossVectors(out, UP_V);   // izquierda del que mira la puerta de frente
    let lado = cfg && (cfg.lado === 'izq' || cfg.lado === 'der' || cfg.lado === 'arriba' || cfg.lado === 'abajo') ? cfg.lado : '';
    a.auto = !lado;

    // Si la puerta trae su marca dibujada, la bisagra sale de ahí y no hay nada que adivinar.
    if (!lado && a.marca) {
      a.hinge = a.marca.bisagra.clone();
      a.axis = a.marca.eje.clone();
      const haciaLaPunta = a.marca.punta.clone().sub(a.marca.bisagra);
      a.lado = Math.abs(a.marca.eje.y) > 0.7
        ? (haciaLaPunta.dot(izqV) >= 0 ? 'der' : 'izq')   // la bisagra está del lado opuesto a la punta
        : (haciaLaPunta.y <= 0 ? 'arriba' : 'abajo');
      const prueba = a.marca.punta.clone().sub(a.hinge).applyAxisAngle(a.axis, Math.PI / 2).add(a.hinge).sub(a.marca.punta);
      a.angle = (prueba.dot(out) >= 0 ? 1 : -1) * Math.PI / 2;
      return;
    }

    if (!lado) {
      let relW = centro.getComponent(w) - ref.getComponent(w);
      if (Math.abs(relW) < 1e-6) relW = centro.getComponent(w) - centroModelo.getComponent(w);
      const borde = wdir.clone().multiplyScalar(relW >= 0 ? 1 : -1);
      lado = borde.dot(izqV) >= 0 ? 'izq' : 'der';
    }
    a.lado = lado;

    // Borde donde va la bisagra: el del ancho (izq/der) o el del alto (arriba/abajo).
    const vertical = lado === 'izq' || lado === 'der';
    const quiero = lado === 'izq' ? izqV : lado === 'der' ? izqV.clone().negate() : lado === 'arriba' ? UP_V.clone() : UP_V.clone().negate();
    const ejeBorde = vertical ? w : 1;
    const dirBorde = new THREE.Vector3().setComponent(ejeBorde, 1);
    const signo = dirBorde.dot(quiero) >= 0 ? 1 : -1;
    a.hinge = centro.clone();
    a.hinge.setComponent(ejeBorde, centro.getComponent(ejeBorde) + signo * size.getComponent(ejeBorde) / 2);
    a.axis = vertical ? UP_V.clone() : wdir.clone();
    // El giro tiene que sacar el borde libre hacia afuera del módulo, no para adentro.
    const libre = centro.clone();
    libre.setComponent(ejeBorde, centro.getComponent(ejeBorde) - signo * size.getComponent(ejeBorde) / 2);
    const prueba = libre.clone().sub(a.hinge).applyAxisAngle(a.axis, Math.PI / 2).add(a.hinge).sub(libre);
    a.angle = (prueba.dot(out) >= 0 ? 1 : -1) * Math.PI / 2;
  });
}

// Con ?debug=1 en la dirección, para revisar qué reconoció y de qué lado quedó cada bisagra.
if (/[?&]debug=1/.test(location.search)) {
  window.__pdPuertas = () => ({
    aperturas: aperturas.map((a) => `${a.name} [${a.kind}] ${LADOS[a.lado] || '?'}${a.auto ? ' (auto)' : ''}`),
    seguidores: seguidores.map((s) => `${cleanName(s.node.name)} → ${s.follow.name}`),
    conMarca: aperturas.filter((a) => a.marca).length,
    sinUsar: candidatas.filter((c) => !seguidores.some((s) => s.node === c.node)).map((c) => c.name),
  });
  // Perillas de la luz y los materiales, para probar cambios sin recargar.
  window.__pdLuz = () => ({ scene, renderer, camera, key, fill, sun, pasadaFinal, ssaoPass, modelRoot, THREE, requestRender });
  // En qué punto de la pantalla cae cada puerta (para probar el doble clic).
  window.__pdPantalla = () => {
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    return aperturas.map((a) => {
      a.box.getCenter(v).project(camera);
      return { key: a.key, x: Math.round(r.left + (v.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - v.y) / 2 * r.height) };
    });
  };
  // Dónde quedó cada pieza ahora mismo, para comparar cerrado contra abierto.
  window.__pdDonde = () => {
    const m = {};
    modelRoot.updateMatrixWorld(true);
    const centro = (n) => new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()).toArray().map((x) => +x.toFixed(4));
    aperturas.forEach((a, i) => { m['A' + i + ':' + a.key] = centro(a.node); });
    seguidores.forEach((s, i) => { m['S' + i + ':' + cleanName(s.node.name) + '→' + s.follow.key] = centro(s.node); });
    return m;
  };
}

const _Wm = new THREE.Matrix4(), _Rm = new THREE.Matrix4(), _Tm = new THREE.Matrix4();
const _Mw = new THREE.Matrix4(), _invM = new THREE.Matrix4(), _offV = new THREE.Vector3();
function aplicarAperturas() {
  if (!modelRoot || !aperturas.length) return;
  const dist = salidaCajon();
  // La cuenta va en el mundo; la matriz local de la pieza es padre⁻¹ · (mundo · padre · base).
  const mover = (nodo, base, a, u) => {
    _Wm.identity();
    if (u > 0) {
      if (a.kind === 'puerta' && a.hinge) {
        _Wm.makeTranslation(a.hinge.x, a.hinge.y, a.hinge.z)
          .multiply(_Rm.makeRotationAxis(a.axis, a.angle * u))
          .multiply(_Tm.makeTranslation(-a.hinge.x, -a.hinge.y, -a.hinge.z));
      } else if (a.out) {
        _offV.copy(a.out).multiplyScalar(dist * u);
        _Wm.makeTranslation(_offV.x, _offV.y, _offV.z);
      }
    }
    const padre = nodo.parent;
    if (!padre) return;
    padre.updateWorldMatrix(true, false);
    _Mw.multiplyMatrices(padre.matrixWorld, base).premultiply(_Wm);
    _invM.copy(padre.matrixWorld).invert();
    nodo.matrix.multiplyMatrices(_invM, _Mw);
  };
  aperturas.forEach((a) => mover(a.node, a.base, a, a.fijo ? 0 : a.open || 0));
  seguidores.forEach((s) => mover(s.node, s.base, s.follow, s.follow.fijo ? 0 : s.follow.open || 0));
  modelRoot.updateMatrixWorld(true);
  requestRender();
}

// De 0 a 1 (o al revés) con un temporizador: la puerta termina de abrirse aunque la pestaña
// quede un rato en segundo plano.
function animarApertura(a, destino) {
  const desde = a.open || 0, t0 = performance.now();
  clearInterval(a.anim);
  a.anim = setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / 450);
    a.open = desde + (destino - desde) * (1 - Math.pow(1 - u, 3));
    aplicarAperturas();
    if (u >= 1) { clearInterval(a.anim); a.anim = 0; }
  }, 16);
}

function pararAperturas() {
  aperturas.forEach((a) => { if (a.anim) clearInterval(a.anim); });
  aperturas = [];
  seguidores = [];
  candidatas = [];
  todoAbierto = false;
  const b = $('#btnPuertas');
  if (b) { b.classList.remove('on'); b.hidden = true; b.textContent = 'Abrir'; }
  const m = $('#puertaMenu');
  if (m) m.hidden = true;
}

const laQueToque = (obj) => aperturas.find((a) => isAncestor(a.node, obj));

function abrirOCerrar(a) {
  if (!a.fijo) animarApertura(a, (a.open || 0) > 0.5 ? 0 : 1);
  mostrarBisagra(a);   // aunque esté marcada como fija: así se puede volver atrás
}

/* Elegir el sentido. Solo lo ve quien arma la propuesta: el cliente abre y cierra, nada más. */
function mostrarBisagra(a) {
  const el = $('#puertaMenu');
  if (!el || document.body.classList.contains('cliente')) return;
  const opts = (a.kind === 'puerta' ? ['izq', 'der', 'arriba', 'abajo'] : ['adelante', 'atras']).concat('no');
  const titulo = a.kind === 'puerta' ? 'Bisagra' : 'Sale hacia';
  el.innerHTML = `<p class="pm-nom">${esc(a.name)}</p>
    <p class="pm-tit">${titulo}${a.auto ? ' <span class="pm-auto">(automático)</span>' : ''}</p>
    <div class="pm-lados">${opts.map((o) => `<button data-lado="${o}"${a.lado === o ? ' class="on"' : ''}>${LADOS[o]}</button>`).join('')}</div>
    <button class="pm-x" data-cerrar="1">Cerrar</button>`;
  el.dataset.key = a.key;
  el.hidden = false;
}

on('#puertaMenu', 'click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cerrar) { $('#puertaMenu').hidden = true; return; }
  const a = aperturas.find((x) => x.key === $('#puertaMenu').dataset.key);
  if (!a || !proj) return;
  proj.puertas = { ...(proj.puertas || {}), [a.key]: { lado: b.dataset.lado } };
  proj.sucio = true;
  await store.put(proj);
  configurarAperturas();
  agruparCajones();
  aplicarAperturas();
  mostrarBisagra(a);
  toast('Guardado. Tocá "Link para el cliente" para que lo vea así.');
});

on('#btnPuertas', 'click', () => {
  if (!aperturas.length) return;
  todoAbierto = !todoAbierto;
  $('#btnPuertas').classList.toggle('on', todoAbierto);
  $('#btnPuertas').textContent = todoAbierto ? 'Cerrar' : 'Abrir';
  $('#puertaMenu').hidden = true;
  aperturas.forEach((a) => { if (!a.fijo) animarApertura(a, todoAbierto ? 1 : 0); });
});

/* ───────────── Cotas ─────────────
   Vienen de SketchUp en milímetros y en los ejes de SketchUp (X derecha, Y fondo, Z arriba).
   El grupo de cotas se cuelga de la raíz del modelo: así hereda el giro y la escala que el
   cargador le aplica al archivo y cada cota cae exactamente sobre su pieza. */

let cotas = [], cotasGroup = null, cotasOn = true, capasOff = new Set(), selCota = null;

function cotaScale(root, bboxMm) {
  const unit = Math.abs(root.scale.x) || 1;     // metros por unidad del archivo
  const k = 0.001 / unit;                        // mm → unidades del archivo
  if (!bboxMm) return k;
  // Red de seguridad para una escala equivocada (que el archivo venga en cm o en metros donde se
  // esperaban milímetros): solo corrige diferencias grandes, no las de las cotas que sobresalen.
  const mm = [bboxMm.ancho, bboxMm.alto, bboxMm.prof].map(Number).filter((x) => x > 0).sort((a, b) => b - a);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!isModelMesh(o)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  if (box.isEmpty() || !mm.length) return k;
  const loc = box.getSize(new THREE.Vector3()).toArray().map(Math.abs).sort((a, b) => b - a);
  const r = loc[0] / mm[0];
  if (r > 0 && (r / k > 2 || r / k < 0.5)) {
    console.warn('Cotas: escala corregida por el tamaño del modelo', { esperada: k, usada: r });
    return r;
  }
  return k;
}

// Qué mide la cota, según hacia dónde va (en los ejes de SketchUp: X ancho, Y fondo, Z alto).
function ejeDe(p1, p2) {
  if (!p1 || !p2) return 'Cota';
  const d = [0, 1, 2].map((i) => Math.abs((p2[i] || 0) - (p1[i] || 0)));
  const max = Math.max(...d);
  if (!max) return 'Cota';
  const i = d.indexOf(max);
  return max / (d.reduce((a, b) => a + b, 0) || 1) < 0.8 ? 'Diagonal' : ['Ancho', 'Profundidad', 'Alto'][i];
}

function buildCotas(root, data, bboxMm) {
  cotasGroup = new THREE.Group();
  cotasGroup.name = 'cotas';
  root.add(cotasGroup);
  const k = cotaScale(root, bboxMm);
  cotasGroup.scale.setScalar(k);
  const size = Math.max(...modelBox.getSize(new THREE.Vector3()).toArray()) || 1;
  // Largo de las puntas de flecha, 1,2 % del mueble, en las unidades del grupo de cotas.
  // Una unidad del grupo mide k * (metros por unidad del archivo) metros: hay que dividir por eso,
  // no solo por k, o la flecha sale decenas de veces más chica y no se ve.
  const porUnidad = k * (Math.abs(root.scale.x) || 1);
  const tick = (size * 0.012) / (porUnidad || 0.001);

  cotas = (data || []).map((c, i) => {
    const nota = c.tipo === 'nota';
    const p1 = new THREE.Vector3().fromArray(c.p1);
    const p2 = new THREE.Vector3().fromArray(c.p2 || c.p1);
    const off = new THREE.Vector3().fromArray(c.off || [0, 0, 0]);
    const a1 = p1.clone().add(off), a2 = p2.clone().add(off);
    const mm = c.mm != null ? c.mm : p1.distanceTo(p2);
    const pts = [];
    const seg = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    // Punta de flecha como la de SketchUp: apoya en el extremo de la cota y las barbas se abren
    // hacia adentro. Es lo que hace que de un vistazo se vea de dónde a dónde mide.
    const flecha = (punta, adentro, perp, largo) => {
      const base = punta.clone().add(adentro.clone().multiplyScalar(largo));
      const ala = perp.clone().multiplyScalar(largo * 0.32);
      seg(punta, base.clone().add(ala));
      seg(punta, base.clone().sub(ala));
      seg(base.clone().add(ala), base.clone().sub(ala));
    };
    if (nota) {
      // Texto con flecha: la línea desde el mueble hasta el cartelito, con la punta en el mueble.
      if (off.lengthSq()) {
        seg(p1, a1);
        const d = a1.clone().sub(p1).normalize();
        const aux = Math.abs(d.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const perp = new THREE.Vector3().crossVectors(d, aux).normalize();
        flecha(p1, d, perp, tick * 1.3);
      }
    } else {
      const d = a2.clone().sub(a1);
      const len = d.length() || 1;
      d.divideScalar(len);
      const u = off.lengthSq() ? off.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const ext = u.clone().multiplyScalar(tick * 0.6);   // la línea de referencia pasa un poco de largo
      const largo = Math.min(tick * 1.5, len * 0.25);    // en una cota corta la flecha se achica
      seg(a1, a2);
      if (off.lengthSq()) { seg(p1, a1.clone().add(ext)); seg(p2, a2.clone().add(ext)); }
      flecha(a1, d, u, largo);
      flecha(a2, d.clone().negate(), u, largo);
    }

    if (!pts.length) seg(p1, p1);
    const geo = new THREE.LineSegmentsGeometry().setPositions(pts);
    const mat = new THREE.LineMaterial({ color: 0x15191e, linewidth: 1.4, resolution: lineRes.clone(), transparent: true, opacity: 0.95 });
    mat.depthTest = false;       // la cota se ve siempre, aunque quede detrás de una puerta
    lineMats.push(mat);
    const obj = new THREE.LineSegments2(geo, mat);
    obj.raycast = () => {};
    obj.renderOrder = 20;
    obj.frustumCulled = false;
    cotasGroup.add(obj);

    const lbl = document.createElement('div');
    lbl.className = 'cota-lbl';
    labelsEl.appendChild(lbl);
    return {
      i, texto: c.texto || '', mm, capa: c.capa || (nota ? 'Notas' : 'Cotas'), tipo: c.tipo || 'lineal',
      eje: nota ? '' : ejeDe(c.p1, c.p2),
      mid: nota ? a1 : a1.clone().add(a2).multiplyScalar(0.5), obj, mat, lbl,
    };
  });
  refreshCotaText();
  buildCapasMenu();
  applyCotaVis();
}

const cotaText = (c) => (c.tipo === 'nota' ? c.texto : medida(c.mm, c.texto));
const refreshCotaText = () => cotas.forEach((c) => {
  c.lbl.textContent = cotaText(c);
  c.lbl.classList.toggle('nota', c.tipo === 'nota');
});

const capas = () => [...new Set(cotas.map((c) => c.capa))].sort((a, b) => a.localeCompare(b, 'es'));

function buildCapasMenu() {
  const list = capas();
  $('#btnCotasMenu').hidden = list.length < 2;
  $('#cotasMenu').innerHTML = list.map((n) => `<label><input type="checkbox" data-capa="${esc(n)}" ${capasOff.has(n) ? '' : 'checked'}> ${esc(n)}</label>`).join('');
}

function cotaVisible(c) {
  return cotasOn && !capasOff.has(c.capa);
}
function applyCotaVis() {
  cotas.forEach((c) => {
    const v = cotaVisible(c);
    c.obj.visible = v;
    c.lbl.style.display = v ? '' : 'none';
    c.mat.color.set(selCota === c.i ? 0x0f766e : 0x15191e);
    c.mat.linewidth = selCota === c.i ? 2.4 : 1.4;
    c.lbl.classList.toggle('on', selCota === c.i);
  });
  requestRender();
}

// Las etiquetas son HTML: se proyecta el punto medio de cada cota a la pantalla en cada dibujo.
const _v = new THREE.Vector3();
function drawLabels() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  const put = (lbl, pos, parent) => {
    _v.copy(pos);
    if (parent) _v.applyMatrix4(parent.matrixWorld);
    _v.project(camera);
    const vis = _v.z < 1 && _v.x > -1.15 && _v.x < 1.15 && _v.y > -1.15 && _v.y < 1.15;
    lbl.style.visibility = vis ? '' : 'hidden';
    if (!vis) return;
    lbl.style.left = ((_v.x + 1) / 2) * w + 'px';
    lbl.style.top = ((1 - _v.y) / 2) * h + 'px';
  };
  cotas.forEach((c) => { if (cotaVisible(c)) put(c.lbl, c.mid, cotasGroup); });
  measures.forEach((m) => put(m.lbl, m.mid, null));
}

/* ───────────── Medir (dos puntos) ───────────── */

let measuring = false, measures = [], measurePts = [], measureGroup = new THREE.Group();
scene.add(measureGroup);

function clearMeasures() {
  measures.forEach((m) => { m.lbl.remove(); m.obj.geometry.dispose(); m.obj.material.dispose(); measureGroup.remove(m.obj); });
  measures = [];
  measurePts = [];
  requestRender();
}

function addMeasure(a, b) {
  const geo = new THREE.LineSegmentsGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
  const mat = new THREE.LineMaterial({ color: 0x1d4ed8, linewidth: 2.2, resolution: lineRes.clone(), transparent: true });
  mat.depthTest = false;
  lineMats.push(mat);
  const obj = new THREE.LineSegments2(geo, mat);
  obj.raycast = () => {};
  obj.renderOrder = 25;
  obj.frustumCulled = false;
  measureGroup.add(obj);
  const lbl = document.createElement('div');
  lbl.className = 'cota-lbl med';
  lbl.textContent = medida(a.distanceTo(b) * FACT[unitOf(proj)]);
  labelsEl.appendChild(lbl);
  measures.push({ obj, lbl, mid: a.clone().add(b).multiplyScalar(0.5) });
  requestRender();
}

// Se "pega" al vértice más cercano de la cara tocada (esquina de la pieza): así la medida es exacta.
function snapPoint(hit) {
  const p = hit.point.clone();
  const f = hit.face;
  if (!f || !hit.object.geometry.attributes.position) return p;
  const pos = hit.object.geometry.attributes.position;
  let best = null, bd = Infinity;
  [f.a, f.b, f.c].forEach((i) => {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
    const d = v.distanceTo(p);
    if (d < bd) { bd = d; best = v; }
  });
  const size = Math.max(...modelBox.getSize(new THREE.Vector3()).toArray()) || 1;
  return best && bd < size * 0.05 ? best : p;
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickMeshes, false);
  return hits.length ? hits[0] : null;
}

let down = null, esperaClic = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;  // fue un giro, no un clic
  down = null;
  if (!modelRoot) return;
  const hit = pickAt(e);
  if (measuring) {
    if (!hit) return;
    measurePts.push(snapPoint(hit));
    if (measurePts.length === 2) { addMeasure(measurePts[0], measurePts[1]); measurePts = []; }
    return;
  }
  const elegirModulo = () => {
    if (!hit) { selectMod(null); return; }
    const i = modulos.findIndex((m) => m.nodes.some((n) => isAncestor(n, hit.object)));
    selectMod(i < 0 ? null : i);
  };
  // Doble clic (o doble toque) sobre una puerta o un cajón: lo abre o lo cierra. Sobre una puerta
  // la selección del módulo espera un momento: si no, el primer clic ya mueve la cámara y el
  // segundo cae en otra pieza.
  const puerta = hit && laQueToque(hit.object);
  if (puerta) {
    if (esperaClic) { clearTimeout(esperaClic); esperaClic = 0; abrirOCerrar(puerta); return; }
    esperaClic = setTimeout(() => { esperaClic = 0; elegirModulo(); }, 260);
    return;
  }
  if (esperaClic) { clearTimeout(esperaClic); esperaClic = 0; }
  elegirModulo();
});

const isAncestor = (anc, o) => { for (let p = o; p; p = p.parent) if (p === anc) return true; return false; };

/* ───────────── Resaltado ───────────── */

function applyHighlight() {
  const sel = selMod != null ? modulos[selMod] : null;
  const mats = selMat != null ? materiales[selMat] : null;
  const anySel = !!(sel || mats);
  pickMeshes.forEach((m) => {
    const inSel = !anySel || (sel && sel.nodes.some((n) => isAncestor(n, m))) || (mats && mats.meshes.has(m));
    (m.userData.mats || []).forEach((e) => {
      e.mat.opacity = inSel ? e.opacity : 0.12;
      e.mat.transparent = inSel ? e.transparent : true;
      e.mat.depthWrite = inSel ? e.depthWrite : false;
      e.mat.needsUpdate = true;
    });
    if (m.userData.edges) m.userData.edges.visible = edgeGroupVisible && inSel;
  });
  requestRender();
}

function selectMod(i) {
  selMod = i;
  selMat = null;
  renderPanel();
  applyHighlight();
  if (i != null) focusBox(modulos[i].box);
}
function selectMat(i) {
  selMat = selMat === i ? null : i;
  selMod = null;
  renderPanel();
  applyHighlight();
}

function focusBox(box) {
  const c = box.getCenter(new THREE.Vector3());
  const d = camera.position.clone().sub(controls.target);
  controls.target.copy(c);
  camera.position.copy(c).add(d);
  controls.update();
  requestRender();
}

/* ───────────── Panel de medidas ───────────── */

const unitOf = (p) => (p && p.unidad && p.unidad !== 'auto' ? p.unidad : p && p.ext === 'obj' ? 'mm' : 'm');

function renderTotals() {
  const f = FACT[unitOf(proj)];
  const s = modelBox.getSize(new THREE.Vector3());
  const tot = [['Ancho', s.x * f], ['Alto', s.y * f], ['Profundidad', s.z * f]];
  $('#totals').innerHTML = modelBox.isEmpty() ? '' : tot.map(([n, mm]) => `<div class="tot"><b>${esc(medida(mm))}</b><span>${n}</span></div>`).join('');
}

function renderPanel() {
  renderTotals();
  $('#notes').textContent = (proj && proj.notas) || '';

  const byCapa = new Map();
  cotas.forEach((c) => { if (!byCapa.has(c.capa)) byCapa.set(c.capa, []); byCapa.get(c.capa).push(c); });
  $('#paneCotas').innerHTML = !cotas.length
    ? `<p class="empty">Esta propuesta no trae cotas. En SketchUp poné las cotas con la herramienta Acotar y volvé a enviarla, o usá <b>Medir</b> acá.</p>`
    : [...byCapa.entries()].map(([capa, list]) => `
        ${byCapa.size > 1 ? `<div class="group-hd">${esc(capa)}</div>` : ''}
        ${list.map((c) => `<button class="row ${selCota === c.i ? 'on' : ''}" data-cota="${c.i}">
            <span class="nm">${esc(c.tipo === 'nota' ? c.texto : c.eje)}${byCapa.size > 1 ? '' : `<span class="sub">${esc(capa)}</span>`}</span>
            <span class="vl">${c.tipo === 'nota' ? '' : esc(medida(c.mm, c.texto))}</span></button>`).join('')}`).join('');

  const f = FACT[unitOf(proj)];
  $('#paneMods').innerHTML = !modulos.length
    ? `<p class="empty">No se encontraron módulos con nombre. En SketchUp conviene que cada módulo sea un grupo o componente con su nombre.</p>`
    : modulos.map((m, i) => {
        const s = m.size;
        return `<button class="row ${selMod === i ? 'on' : ''}" data-mod="${i}">
          <span class="nm">${esc(m.name)}${m.nodes.length > 1 ? ` <b>×${m.nodes.length}</b>` : ''}<span class="sub">ancho × alto × prof.</span></span>
          <span class="vl">${esc(medida(s.x * f))} × ${esc(medida(s.y * f))} × ${esc(medida(s.z * f))}</span></button>`;
      }).join('');

  $('#paneMats').innerHTML = !materiales.length
    ? `<p class="empty">El modelo no trae materiales con nombre.</p>`
    : materiales.map((m, i) => `<button class="row ${selMat === i ? 'on' : ''}" data-mat="${i}">
        <span class="sw" style="${swatch(m)}"></span>
        <span class="nm">${esc(m.name)}<span class="sub">${m.meshes.size} ${m.meshes.size === 1 ? 'pieza' : 'piezas'}</span></span></button>`).join('');
}

on('#paneCotas', 'click', (e) => {
  const b = e.target.closest('[data-cota]');
  if (!b) return;
  const i = +b.dataset.cota;
  selCota = selCota === i ? null : i;
  if (selCota != null) {
    const c = cotas[selCota];
    if (capasOff.has(c.capa)) { capasOff.delete(c.capa); buildCapasMenu(); }
    if (!cotasOn) { cotasOn = true; $('#btnCotas').classList.add('on'); }
  }
  applyCotaVis();
  renderPanel();
});
on('#paneMods', 'click', (e) => {
  const b = e.target.closest('[data-mod]');
  if (b) selectMod(selMod === +b.dataset.mod ? null : +b.dataset.mod);
});
on('#paneMats', 'click', (e) => {
  const b = e.target.closest('[data-mat]');
  if (b) selectMat(+b.dataset.mat);
});
$$('.panel-tabs .tab').forEach((t) => t.addEventListener('click', () => {
  $$('.panel-tabs .tab').forEach((x) => x.classList.toggle('on', x === t));
  ['cotas', 'mods', 'mats'].forEach((p) => { $('#pane' + p[0].toUpperCase() + p.slice(1)).hidden = p !== t.dataset.pane; });
}));

/* ───────────── Armado de la propuesta ───────────── */

let proj = null;   // { id, nombre, cliente, notas, ext, unidad, fmt, cotas, bbox }

// `recursos` viene cargado solo cuando el diseño está incrustado en un archivo .html mandado al
// cliente: ahí no se toca el guardado del navegador, todo viaja adentro del archivo.
async function buildProject(p, recursos) {
  proj = p;
  fmtMode = p.fmt || 'mm';
  let modelo, tex;
  if (recursos) {
    modelo = recursos.blob;
    tex = recursos.tex || {};
  } else {
    const rec = await store.getFile(p.id);
    if (!rec) throw new Error('No se encontró el archivo del modelo en este dispositivo.');
    const texRec = await store.getTex(p.id);
    modelo = rec.blob;
    tex = (texRec && texRec.tex) || {};
  }
  const root = await parseModel(modelo, p.ext, tex);
  prepareMaterials(root, p.ext);
  root.updateMatrixWorld(true);

  clearScene();
  modelRoot = root;
  scene.add(root);
  root.updateMatrixWorld(true);
  modelBox = new THREE.Box3().setFromObject(root);
  pickMeshes = [];
  root.traverse((o) => { if (isModelMesh(o)) pickMeshes.push(o); });
  modulos = extractModulos(root);
  materiales = extractMateriales(root);
  aperturas = extractAperturas(root);

  // Piso y sombra al nivel de la base del mueble.
  const size = modelBox.getSize(new THREE.Vector3());
  const center = modelBox.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  floor.scale.setScalar(span * 6);
  floor.position.set(center.x, modelBox.min.y - span * 0.0015, center.z);
  ajustarAO(span);
  sun.position.copy(center).add(new THREE.Vector3(-0.45, 1.25, 0.6).multiplyScalar(span));
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
  sc.near = span * 0.05; sc.far = span * 6;
  sc.updateProjectionMatrix();

  relieveDeLasTexturas(root);   // por si las imágenes ya estaban listas antes de armar la escena
  buildCotas(root, p.cotas || [], p.bbox);
  configurarAperturas();
  agruparCajones();
  $('#btnPuertas').hidden = !aperturas.some((a) => !a.fijo);
  fitBox = modelBox.clone();
  if (cotas.length) {
    cotasGroup.updateMatrixWorld(true);
    cotas.forEach((c) => fitBox.expandByPoint(c.mid.clone().applyMatrix4(cotasGroup.matrixWorld)));
  }
  selMod = selMat = selCota = null;
  applyHighlight();
  renderPanel();
  fitCamera(new THREE.Vector3(...VIEWS.iso));
  $('#emptyMsg').hidden = true;
  if (texMissing) toast(`Faltan ${texMissing} ${texMissing === 1 ? 'textura' : 'texturas'}: esas caras se ven con su color.`);
  hdr();
}

function hdr() {
  $('#hdrName').textContent = proj ? proj.nombre : 'Presentación de Diseños';
  $('#hdrClient').textContent = proj && proj.cliente ? proj.cliente : '';
  document.title = proj ? proj.nombre + ' — Presentación de Diseños' : 'Presentación de Diseños';
}

const busy = (txt) => { $('#loadingTxt').textContent = txt || 'Cargando el diseño…'; $('#loading').hidden = false; };
const idle = () => { $('#loading').hidden = true; };

/* ───────────── Archivos que entran (modelo + texturas + cotas.json) ───────────── */

const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();
const MODEL_RE = /\.(dae|obj|glb|gltf)$/i;

async function readCotasJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (Array.isArray(data)) return { cotas: data, bbox: null, id: '', nombre: '', cliente: '', notas: '' };
    return {
      cotas: data.cotas || [], bbox: data.bbox_mm || null, id: data.id || '',
      nombre: data.nombre || '', cliente: data.cliente || '', notas: data.notas || '',
    };
  } catch (e) {
    console.warn('cotas.json:', e);
    return null;
  }
}

function splitFiles(files) {
  const list = [...files];
  return {
    model: list.find((f) => MODEL_RE.test(f.name)) || null,
    texs: list.filter((f) => TEX_RE.test(f.name)),
    json: list.find((f) => /\.json$/i.test(f.name)) || null,
  };
}

// Lee lo que se soltó sobre el visor: una carpeta entera o archivos sueltos.
// Las entradas hay que pedirlas antes de cualquier espera, si no el navegador las descarta.
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry, depth) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory && depth < 4) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, depth + 1);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, 0);
  return out;
}

async function saveTextures(id, files, add) {
  if (!files.length && !add) return 0;
  const rec = await store.getTex(id);
  const tex = add && rec ? rec.tex : {};
  files.forEach((f) => { tex[texKey(f.name)] = f; });
  await store.putTex(id, tex);
  return Object.keys(tex).length;
}

async function createLocal({ nombre, cliente, notas, unidad, files }) {
  const { model, texs, json } = splitFiles(files);
  if (!model) throw new Error('No encontré el modelo (.dae, .obj, .glb o .gltf) entre los archivos.');
  const extra = json ? await readCotasJson(json) : null;
  // Si el cotas.json trae el número del modelo de SketchUp, se actualiza la misma propuesta:
  // el link que ya tiene el cliente sigue funcionando y ve la versión nueva.
  const previo = extra && extra.id ? await store.get(extra.id) : null;
  const id = (extra && extra.id) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const p = {
    id, nombre: nombre || (extra && extra.nombre) || model.name.replace(MODEL_RE, ''),
    cliente: cliente || (extra && extra.cliente) || (previo && previo.cliente) || '',
    notas: notas || (extra && extra.notas) || (previo && previo.notas) || '',
    ext: extOf(model.name), unidad: unidad || 'auto', fmt: (previo && previo.fmt) || 'mm',
    cotas: (extra && extra.cotas) || [], bbox: (extra && extra.bbox) || null,
    creada: new Date().toISOString(),
    cloud: !!(previo && previo.cloud),
    sucio: true,   // hay cambios sin guardar en el servidor
  };
  await store.putFile(id, model);
  await saveTextures(id, texs, false);
  await store.put(p);
  p.actualizada = !!previo;
  return p;
}

/* ───────────── Botonera del visor ───────────── */

$$('[data-view]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
  const v = VIEWS[b.dataset.view];
  if (b.dataset.view !== 'iso' && camera !== camO) { setOrtho(true); $('#btnOrtho').classList.add('on'); }
  fitCamera(new THREE.Vector3(...v));
}));
on('#btnFit', 'click', () => fitCamera(camera.position.clone().sub(controls.target)));
on('#btnOrtho', 'click', () => {
  const on = camera !== camO;
  setOrtho(on);
  $('#btnOrtho').classList.toggle('on', on);
});
on('#btnCotas', 'click', () => {
  cotasOn = !cotasOn;
  $('#btnCotas').classList.toggle('on', cotasOn);
  applyCotaVis();
});
on('#btnCotasMenu', 'click', () => { $('#cotasMenu').hidden = !$('#cotasMenu').hidden; });
on('#cotasMenu', 'change', (e) => {
  const cb = e.target.closest('[data-capa]');
  if (!cb) return;
  if (cb.checked) capasOff.delete(cb.dataset.capa); else capasOff.add(cb.dataset.capa);
  applyCotaVis();
});
on('#btnLines', 'click', () => {
  edgeGroupVisible = !edgeGroupVisible;
  $('#btnLines').classList.toggle('on', edgeGroupVisible);
  applyHighlight();
});
on('#btnShadow', 'click', () => {
  floor.visible = !floor.visible;
  $('#btnShadow').classList.toggle('on', floor.visible);
  requestRender();
});
on('#btnReal', 'click', () => {
  realista = !realista;
  $('#btnReal').classList.toggle('on', realista);
  armarPasadas();
  toast(realista ? 'Realista: sombras en los rincones y brillo de estudio.' : 'Modo liviano: sin sombras de rincón.');
});
on('#btnMeasure', 'click', () => {
  measuring = !measuring;
  measurePts = [];
  $('#btnMeasure').classList.toggle('on', measuring);
  $('#measureHint').hidden = !measuring;
  renderer.domElement.style.cursor = measuring ? 'crosshair' : '';
});
on('#btnMeasureClear', 'click', clearMeasures);
on('#btnFull', 'click', () => {
  const el = $('#stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen();
});
// Foto de la vista, con las cotas dibujadas encima (las etiquetas son HTML, así que se copian
// a mano sobre la imagen para que la foto salga igual a lo que se ve en pantalla).
on('#btnShot', 'click', () => {
  if (!modelRoot) return;
  dibujar();
  drawLabels();
  const gl = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = gl.width; c.height = gl.height;
  const x = c.getContext('2d');
  x.drawImage(gl, 0, 0);
  const k = gl.width / (viewerEl.clientWidth || 1);
  x.font = `700 ${Math.round(13 * k)}px system-ui, "Segoe UI", Roboto, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  [...labelsEl.children].forEach((lbl) => {
    if (lbl.style.display === 'none' || lbl.style.visibility === 'hidden' || !lbl.style.left) return;
    const px = parseFloat(lbl.style.left) * k, py = parseFloat(lbl.style.top) * k;
    const txt = lbl.textContent;
    // Mismo dibujo que en pantalla: el número apoyado sobre la línea, sin globo ni borde.
    const w = x.measureText(txt).width + 8 * k, h = 17 * k;
    const med = lbl.classList.contains('med');
    const nota = lbl.classList.contains('nota');
    x.fillStyle = 'rgba(255,255,255,.88)';
    x.beginPath();
    if (x.roundRect) x.roundRect(px - w / 2, py - h / 2, w, h, 2 * k);
    else x.rect(px - w / 2, py - h / 2, w, h);
    x.fill();
    if (nota) {
      x.strokeStyle = 'rgba(0,0,0,.14)';
      x.lineWidth = Math.max(1, k);
      x.stroke();
    }
    x.fillStyle = med ? '#1d4ed8' : '#15191e';
    x.fillText(txt, px, py + k);
  });
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ((proj && proj.nombre) || 'diseño') + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
  toast('La foto se guardó en Descargas.');
});
on('#btnPanel', 'click', () => document.body.classList.toggle('panel-open'));
on('#btnPanelClose', 'click', () => document.body.classList.remove('panel-open'));

/* ───────────── Diálogos ───────────── */

const dlgNew = $('#dlgNew');
// Lo elegido, venga de donde venga: de la carpeta entera, de los tres campos o de arrastrar.
let elegido = { model: null, texs: [], json: null };
const pendientes = () => [elegido.model, ...elegido.texs, elegido.json].filter(Boolean);

async function setPending(files, reemplazarTodo) {
  const { model, texs, json } = splitFiles(files);
  if (reemplazarTodo) elegido = { model: null, texs: [], json: null };
  if (model) elegido.model = model;
  if (texs.length) elegido.texs = texs;
  if (json) elegido.json = json;

  const partes = [
    elegido.model ? `modelo <b>${esc(elegido.model.name)}</b>` : '<b>falta el modelo</b> (.dae, .glb u .obj)',
    `${elegido.texs.length} ${elegido.texs.length === 1 ? 'textura' : 'texturas'}`,
  ];
  let extra = null;
  if (elegido.json) {
    extra = await readCotasJson(elegido.json);
    partes.push(extra ? `${extra.cotas.length} ${extra.cotas.length === 1 ? 'cota' : 'cotas'}` : 'cotas.json ilegible');
  } else {
    partes.push('sin cotas');
  }
  $('#newFilesInfo').innerHTML = partes.join(' · ');
  if (extra) {
    if (extra.nombre && !$('#newName').value.trim()) $('#newName').value = extra.nombre;
    if (extra.cliente && !$('#newClient').value.trim()) $('#newClient').value = extra.cliente;
    if (extra.notas && !$('#newNotes').value.trim()) $('#newNotes').value = extra.notas;
    if (extra.id && (await store.get(extra.id))) {
      $('#newMsg').textContent = 'Esta es una versión nueva de una propuesta que ya tenías: se actualiza, y el link del cliente sigue siendo el mismo.';
    }
  }
}

function openNew(files) {
  $('#formNew').reset();
  $('#newMsg').textContent = '';
  elegido = { model: null, texs: [], json: null };
  $('#newFilesInfo').textContent = '';
  dlgNew.showModal();
  if (files && files.length) setPending(files, true);
}
on('#btnNew', 'click', () => openNew());
on('#btnNew2', 'click', () => openNew());
on('#newCancel', 'click', () => dlgNew.close());
on('#newFolder', 'change', (e) => setPending(e.target.files, true));
on('#newModel', 'change', (e) => setPending(e.target.files));
on('#newTex', 'change', (e) => setPending(e.target.files));
on('#newJson', 'change', (e) => setPending(e.target.files));
on('#formNew', 'submit', async (e) => {
  e.preventDefault();
  if (!elegido.model) { $('#newMsg').textContent = 'Falta el modelo: elegí la carpeta entera o el archivo .dae.'; return; }
  busy('Abriendo el diseño…');
  try {
    const p = await createLocal({
      nombre: $('#newName').value.trim(), cliente: $('#newClient').value.trim(),
      notas: $('#newNotes').value.trim(), unidad: $('#newUnit').value, files: pendientes(),
    });
    dlgNew.close();
    await refreshList(p.id);
    await buildProject(p);
    toast(p.actualizada
      ? 'Propuesta actualizada con la versión nueva del diseño.'
      : 'Listo. Cuando esté como querés, tocá "Mandar al cliente".');
  } catch (err) {
    console.error(err);
    $('#newMsg').textContent = err.message || 'No se pudo abrir el archivo.';
  } finally {
    idle();
  }
});

const dlgSet = $('#dlgSettings');
on('#btnSettings', 'click', () => {
  if (!proj) return toast('Primero abrí una propuesta.');
  $('#setName').value = proj.nombre;
  $('#setClient').value = proj.cliente || '';
  $('#setNotes').value = proj.notas || '';
  $('#setUnit').value = proj.unidad || 'auto';
  $('#setFmt').value = proj.fmt || 'mm';
  $('#setFilesInfo').textContent = '';
  $('#setFiles').value = '';
  const ver = $('#setVer');
  if (ver) ver.textContent = 'Versión de la página: ' + APP_VER;
  dlgSet.showModal();
});
on('#setCancel', 'click', () => dlgSet.close());
on('#formSettings', 'submit', async (e) => {
  e.preventDefault();
  const reload = $('#setUnit').value !== (proj.unidad || 'auto') || $('#setFiles').files.length;
  proj.nombre = $('#setName').value.trim() || proj.nombre;
  proj.cliente = $('#setClient').value.trim();
  proj.notas = $('#setNotes').value.trim();
  proj.unidad = $('#setUnit').value;
  proj.fmt = $('#setFmt').value;
  proj.sucio = true;
  fmtMode = proj.fmt;
  const { texs, json } = splitFiles($('#setFiles').files);
  if (texs.length) await saveTextures(proj.id, texs, true);
  if (json) {
    const extra = await readCotasJson(json);
    if (extra) { proj.cotas = extra.cotas; proj.bbox = extra.bbox || proj.bbox; }
  }
  await store.put(proj);
  dlgSet.close();
  await refreshList(proj.id);
  if (reload || json) { busy(); try { await buildProject(proj); } finally { idle(); } }
  else { refreshCotaText(); renderPanel(); hdr(); }
});
on('#btnDelete', 'click', async () => {
  if (!proj || !confirm(`¿Eliminar la propuesta "${proj.nombre}"?\n\nSi ya le mandaste el link a un cliente, el link deja de funcionar.`)) return;
  const id = proj.id, estabaPublicada = proj.cloud;
  dlgSet.close();
  if (estabaPublicada && cloudOn) {
    // Borrar del servidor haría falta una cuenta, y esta página no usa ninguna. Para tumbar el
    // link se pisa la ficha publicada con una marca de baja: el que la abra ve el cartel de
    // "ya no está disponible" y el modelo deja de servir.
    busy('Dando de baja el link…');
    try {
      const baja = new Blob([JSON.stringify({ version: 1, id, baja: true })], { type: 'application/json' });
      const { error } = await sb.storage.from(BUCKET)
        .upload(`${id}/proyecto.json`, baja, { contentType: 'application/json', upsert: true });
      if (error) throw error;
      await sb.storage.from(BUCKET)
        .upload(`${id}/modelo.${proj.ext}`, new Blob([''], { type: 'application/octet-stream' }), { upsert: true });
      toast('Propuesta eliminada. El link que mandaste ya no muestra nada.');
    } catch (err) {
      console.warn(err);
      toast('Se borró de esta computadora, pero el link sigue vivo: ' + (err.message || ''));
    } finally {
      idle();
    }
  }
  await store.del(id);
  proj = null;
  clearScene();
  modelBox = new THREE.Box3();
  fitBox = new THREE.Box3();
  renderPanel();
  hdr();
  $('#emptyMsg').hidden = false;
  const list = await refreshList();
  if (list.length) openProject($('#projSel').value);
});

/* ───────────── Mandar al cliente ─────────────
   El diseño se guarda como UN archivo .html que lleva todo adentro: el visor, el modelo, las
   texturas y las cotas. Se lo mandás por WhatsApp o por correo como archivo y el cliente lo abre
   con doble clic, sin internet, sin cuenta y sin instalar nada. */

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const leerB64 = async (blob) => b64(await blob.arrayBuffer());

// Los archivos del visor se meten adentro del .html para que no dependa de internet.
const VISOR = [
  'vendor/three.min.js', 'vendor/OrbitControls.js', 'vendor/LineSegmentsGeometry.js',
  'vendor/LineMaterial.js', 'vendor/LineSegments2.js', 'vendor/TGALoader.js',
  'vendor/ColladaLoader.js', 'vendor/OBJLoader.js', 'vendor/GLTFLoader.js',
  'vendor/SimplexNoise.js', 'vendor/CopyShader.js', 'vendor/SSAOShader.js',
  'vendor/EffectComposer.js', 'vendor/RenderPass.js', 'vendor/ShaderPass.js',
  'vendor/MaskPass.js', 'vendor/SSAOPass.js', 'app.js',
];

const nombreArchivo = (s) => String(s || 'diseño').replace(/[\\/:*?"<>|]/g, '-').trim() || 'diseño';

/* Trae un archivo del visor. Si la red falla (o no hay internet) usa la copia que el navegador
   ya tiene guardada: el archivo del cliente se puede armar igual, sin conexión. */
async function traerArchivo(ruta) {
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(ruta, { cache: intento ? 'default' : 'no-cache' });
      if (r.ok) return await r.text();
      ultimo = new Error('respuesta ' + r.status);
    } catch (e) {
      ultimo = e;
    }
  }
  if (self.caches) {
    try {
      const hit = await caches.match(new URL(ruta, location.href).href, { ignoreSearch: true });
      if (hit) return await hit.text();
    } catch (e) { /* sin copia guardada */ }
  }
  throw new Error(`No se pudo leer "${ruta}" (${(ultimo && ultimo.message) || 'sin respuesta'}). ` +
                  'Revisá la conexión y probá de nuevo.');
}

async function armarArchivoCliente(p) {
  const traer = traerArchivo;
  busy('Preparando el archivo…');
  const rec = await store.getFile(p.id);
  if (!rec) throw new Error('No se encontró el modelo de esta propuesta.');
  const texRec = await store.getTex(p.id);
  const tex = (texRec && texRec.tex) || {};

  busy('Guardando las texturas…');
  const texturas = {};
  for (const [k, blob] of Object.entries(tex)) {
    texturas[k] = { tipo: blob.type || 'image/jpeg', datos: await leerB64(blob) };
  }

  busy('Guardando el modelo…');
  const datos = {
    nombre: p.nombre, cliente: p.cliente || '', notas: p.notas || '',
    ext: p.ext, unidad: p.unidad || 'auto', fmt: p.fmt || 'mm',
    cotas: p.cotas || [], bbox: p.bbox || null, puertas: p.puertas || null,
    modelo: await leerB64(rec.blob), texturas,
  };

  busy('Armando el visor…');
  const estilo = await traer('style.css');
  const partes = [];
  for (const v of VISOR) partes.push(await traer(v));

  const html = await traer('index.html');
  const cuerpo = html
    .replace(/^[\s\S]*?<body>/i, '')
    .replace(/<script[\s\S]*$/i, '')
    .trim();

  // El visor lee PD_EMBED en vez de ir a buscar los archivos al disco o a internet.
  return new Blob([
    '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n',
    `<title>${esc(p.nombre)}</title>\n<style>\n`, estilo, '\n</style>\n</head>\n<body class="cliente">\n',
    cuerpo,
    '\n<script>window.PD_EMBED = ', JSON.stringify(datos), ';<\/script>\n',
    ...partes.map((t) => '<script>\n' + t + '\n<\/script>\n'),
    '</body>\n</html>\n',
  ], { type: 'text/html' });
}

// Guardar el archivo con todo adentro (está en Ajustes, para cuando el link no sirve).
on('#btnArchivo', 'click', async () => {
  if (!proj) return toast('Primero abrí una propuesta.');
  try {
    const blob = await armarArchivoCliente(proj);
    const nombre = nombreArchivo(proj.nombre) + '.html';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    toast(`Se guardó ${nombre} en Descargas (${(blob.size / 1048576).toFixed(1)} MB). Mandáselo como archivo.`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo armar el archivo.');
  } finally {
    idle();
  }
});

/* ───────────── El link del cliente ─────────────
   Si la propuesta ya está en el servidor y no cambió, el botón no toca nada: copia el link y
   listo. Solo sube cuando es nueva o cuando cargaste una versión corregida. */

const dlgShare = $('#dlgShare');

async function mostrarLink(link, aviso) {
  $('#shareTitulo').textContent = 'Link para el cliente';
  $('#shareOk').hidden = false;
  $('#shareFalta').hidden = true;
  $('#shareUrl').value = link;
  let copiado = false;
  try { await navigator.clipboard.writeText(link); copiado = true; } catch (e) { /* sin permiso */ }
  $('#shareMsg').textContent = (copiado ? 'Link copiado: pegalo y mandalo. ' : '') + aviso;
  if (!dlgShare.open) dlgShare.showModal();
  if (!copiado) $('#shareUrl').select();
}

function avisarFalla(msg) {
  $('#shareTitulo').textContent = 'No se pudo guardar en el servidor';
  $('#shareOk').hidden = true;
  $('#shareFalta').hidden = false;
  $('#shareFaltaMsg').textContent = msg || 'No se pudo guardar la propuesta.';
  if (!dlgShare.open) dlgShare.showModal();
}

// Genera (si hace falta) y copia el link. No pide cuenta ni contraseña: nunca.
async function darLink() {
  const link = clientLink(proj.id);
  if (proj.cloud && !proj.sucio) {
    await mostrarLink(link, 'El cliente lo abre y solo mira: no puede cambiar nada.');
    return true;
  }
  try {
    await publish(proj);
    await mostrarLink(link, 'El cliente ve la versión de ahora, y solo mira.');
    return true;
  } catch (err) {
    console.error(err);
    avisarFalla(err.message || 'No se pudo guardar la propuesta.');
    return false;
  }
}

on('#btnShare', 'click', () => {
  if (!proj) return toast('Primero abrí una propuesta.');
  darLink();
});
on('#shareReintentar', 'click', () => darLink());
on('#shareArchivo', 'click', () => { dlgShare.close(); $('#btnArchivo').click(); });
on('#shareClose2', 'click', () => dlgShare.close());
on('#shareClose', 'click', () => dlgShare.close());
on('#shareCopy', 'click', async () => {
  try { await navigator.clipboard.writeText($('#shareUrl').value); toast('Link copiado.'); }
  catch (e) { $('#shareUrl').select(); toast('Copialo con Ctrl+C.'); }
});
on('#shareWa', 'click', () => {
  const t = `${proj.nombre}${proj.cliente ? ' — ' + proj.cliente : ''}\nMirá el diseño en 3D con las medidas:\n${$('#shareUrl').value}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
});

on('#projSel', 'change', (e) => openProject(e.target.value));

// Arrastrar sobre el visor la carpeta que exportó SketchUp (o sus archivos) abre una propuesta.
const stageEl = $('#stage');
['dragenter', 'dragover'].forEach((ev) => stageEl.addEventListener(ev, (e) => {
  if (document.body.classList.contains('cliente')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  stageEl.classList.add('dropping');
}));
['dragleave', 'dragend'].forEach((ev) => stageEl.addEventListener(ev, (e) => {
  if (e.target === stageEl) stageEl.classList.remove('dropping');
}));
stageEl.addEventListener('drop', async (e) => {
  if (document.body.classList.contains('cliente')) return;
  e.preventDefault();
  stageEl.classList.remove('dropping');
  const files = await filesFromDrop(e.dataTransfer);
  const { model } = splitFiles(files);
  if (!model) return toast('En la carpeta no hay ningún modelo (.dae, .glb u .obj).');
  openNew(files);
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'f' || e.key === 'F') $('#btnFit').click();
  if (e.key === 'c' || e.key === 'C') $('#btnCotas').click();
  if (e.key === 'm' || e.key === 'M') $('#btnMeasure').click();
  if (e.key === 'Escape' && measuring) $('#btnMeasure').click();
});

/* ───────────── Arranque ───────────── */

// Si algo se rompe, que se vea: sin esto la página se queda muda y parece que "no hace nada".
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  toast('Hubo un error: ' + (e.message || 'desconocido'));
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Hubo un error: ' + ((e.reason && e.reason.message) || e.reason));
});

// Abrir el index.html con doble clic (dirección file:///…) no sirve: el navegador no deja guardar
// nada y no se puede cargar un diseño. Hay que abrir la página publicada.
/* ───────────── Publicar y abrir el link del cliente ───────────── */

function projJson(p, texNames) {
  return {
    version: 1, id: p.id, nombre: p.nombre, cliente: p.cliente || '', notas: p.notas || '',
    modelo: 'modelo.' + p.ext, ext: p.ext, unidad: p.unidad || 'auto', formato_medidas: p.fmt || 'mm',
    texturas: texNames, bbox_mm: p.bbox || null, cotas: p.cotas || [],
    puertas: p.puertas || null,   // el sentido de apertura que fijaste, para que el cliente lo vea igual
    publicada: new Date().toISOString(),
  };
}

// ¿El servidor rechazó por permisos? No debería pasar nunca: las reglas del servidor dejan
// publicar sin cuenta. Si pasa, es que alguien las cambió, y el cartel lo dice en castellano.
const esFaltaDePermiso = (err) => {
  const code = Number(err && (err.statusCode || err.status)) || 0;
  const msg = String((err && err.message) || '');
  return code === 401 || code === 403 ||
    /row-level security|not authorized|unauthorized|forbidden|violates .*policy|jwt/i.test(msg);
};

// Guarda la propuesta en el servidor. No pide cuenta ni contraseña: nunca.
async function publish(p) {
  if (!cloudOn) throw new Error('Falta el archivo config.js del servidor.');
  busy('Guardando la propuesta…');
  try {
    const rec = await store.getFile(p.id);
    if (!rec) throw new Error('No se encontró el modelo de esta propuesta.');
    const texRec = await store.getTex(p.id);
    const tex = (texRec && texRec.tex) || {};
    const up = async (path, body, type) => {
      const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: type || 'application/octet-stream', upsert: true });
      if (error) throw error;
    };
    await up(`${p.id}/modelo.${p.ext}`, rec.blob);
    const names = Object.keys(tex);
    for (let i = 0; i < names.length; i++) {
      busy(`Subiendo texturas (${i + 1}/${names.length})…`);
      await up(`${p.id}/tex/${names[i]}`, tex[names[i]], tex[names[i]].type);
    }
    busy('Guardando la propuesta…');
    await up(`${p.id}/proyecto.json`, new Blob([JSON.stringify(projJson(p, names))], { type: 'application/json' }), 'application/json');
    const fila = {
      id: p.id, nombre: p.nombre, cliente: p.cliente || '', notas: p.notas || '',
      ext: p.ext, unidad: p.unidad || 'auto', cotas: p.cotas || [],
      meta: { texturas: names, bbox_mm: p.bbox || null, fmt: p.fmt || 'mm' },
      publicada: new Date().toISOString(),
    };
    // Primero se intenta dar de alta. Si ya existía, el servidor avisa "clave repetida" y
    // entonces se corrige la fila. Se hace así, y no con un upsert, para que el servidor no
    // necesite dejar leer la tabla: la lista de clientes y las notas quedan cerradas.
    let { error } = await sb.from(T_PROY).insert(fila);
    if (error && (error.code === '23505' || /duplicate key|already exists/i.test(error.message || ''))) {
      ({ error } = await sb.from(T_PROY).update(fila).eq('id', p.id));
    }
    if (error) throw error;
    p.cloud = true;
    p.sucio = false;
    await store.put(p);
    return true;
  } catch (err) {
    if (esFaltaDePermiso(err)) {
      throw new Error('El servidor no dejó guardar la propuesta. Cambiaron los permisos del proyecto de Supabase: volvé a correr los archivos SACAR-LA-CONTRASEÑA.sql y PASO-2-FALTABA-ESTO.sql.');
    }
    throw err;
  } finally {
    idle();
  }
}

// Modo cliente: baja la propuesta publicada y la deja guardada acá, así la segunda vez abre al
// instante. Es solo lectura: no hay nada en esta pantalla que pueda cambiar el diseño.
async function openPublished(id) {
  const local = await store.get(id);
  if (local && (await store.getFile(id))) {
    try { await buildProject(local); return; } catch (e) { console.warn(e); }
  }
  if (!cloudOn) throw new Error('No se puede abrir el link sin el archivo config.js.');
  busy('Bajando el diseño…');
  const res = await fetch(pubUrl(`${id}/proyecto.json`), { cache: 'no-cache' });
  if (!res.ok) throw new Error('No se encontró esta propuesta. Pedile el link de nuevo a quien te lo mandó.');
  const meta = await res.json();
  if (meta.baja) throw new Error('Esta propuesta ya no está disponible. Pedile el link nuevo a quien te lo mandó.');
  const mres = await fetch(pubUrl(`${id}/${meta.modelo}`));
  if (!mres.ok) throw new Error('No se pudo bajar el diseño.');
  await store.putFile(id, await mres.blob());
  const names = meta.texturas || [];
  const tex = {};
  for (let i = 0; i < names.length; i++) {
    busy(`Bajando texturas (${i + 1}/${names.length})…`);
    try {
      const r = await fetch(pubUrl(`${id}/tex/${names[i]}`));
      if (r.ok) tex[names[i]] = await r.blob();
    } catch (e) { /* si falta una, la cara se ve con su color */ }
  }
  await store.putTex(id, tex);
  const p = {
    id, nombre: meta.nombre, cliente: meta.cliente || '', notas: meta.notas || '',
    ext: meta.ext, unidad: meta.unidad || 'auto', fmt: meta.formato_medidas || 'mm',
    cotas: meta.cotas || [], bbox: meta.bbox_mm || null, puertas: meta.puertas || null,
    cloud: true, creada: meta.publicada,
  };
  await store.put(p);
  busy('Armando el diseño…');
  await buildProject(p);
}

/* ───────────── Lista de propuestas de esta computadora ───────────── */

async function refreshList(selectId) {
  const list = (await store.list()).sort((a, b) => String(b.creada || '').localeCompare(String(a.creada || '')));
  const sel = $('#projSel');
  sel.innerHTML = list.length
    ? list.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.cliente ? ' · ' + esc(p.cliente) : ''}</option>`).join('')
    : '<option value="">— sin propuestas —</option>';
  if (selectId) sel.value = selectId;
  sel.disabled = !list.length;
  return list;
}

async function openProject(id) {
  if (!id) return;
  busy();
  try {
    const p = await store.get(id);
    if (!p) throw new Error('No se encontró la propuesta.');
    await buildProject(p);
  } catch (err) {
    console.error(err);
    toast(err.message || 'No se pudo abrir la propuesta.');
    $('#emptyMsg').hidden = false;
  } finally {
    idle();
  }
}

/* ───────────── Diseño incrustado (el archivo que recibe el cliente) ───────────── */

function desdeB64(datos, tipo) {
  const bin = atob(datos);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: tipo || 'application/octet-stream' });
}

async function abrirIncrustado(d) {
  const tex = {};
  Object.entries(d.texturas || {}).forEach(([k, v]) => { tex[k] = desdeB64(v.datos, v.tipo); });
  await buildProject({
    id: 'incrustado', nombre: d.nombre, cliente: d.cliente || '', notas: d.notas || '',
    ext: d.ext, unidad: d.unidad || 'auto', fmt: d.fmt || 'mm',
    cotas: d.cotas || [], bbox: d.bbox || null, puertas: d.puertas || null,
  }, { blob: desdeB64(d.modelo), tex });
}

// Abrir el index.html con doble clic no sirve (el navegador no deja guardar nada). El archivo
// que recibe el cliente sí, porque trae el diseño adentro y no necesita guardar.
function chequearOrigen() {
  if (location.protocol !== 'file:' || window.PD_EMBED) return true;
  $('#emptyMsg').hidden = false;
  $('#emptyMsg').innerHTML = '<h2>Esta no es la página, es el archivo</h2>' +
    '<p>La abriste con doble clic sobre <b>index.html</b> (mirá la dirección: empieza con ' +
    '<b>file:///</b>). Así el navegador no deja cargar ni guardar diseños.</p>' +
    '<p><a class="fakebtn primary" href="https://presentacion-disenos-campi.netlify.app">' +
    'Abrir la página de verdad</a></p>' +
    '<p class="hint">Para la próxima: usá el acceso directo <b>ABRIR LA PAGINA</b> de esa misma ' +
    'carpeta, o guardá la dirección en favoritos.</p>';
  return false;
}

/* ───────────── Instalarla como app ─────────────
   Android y la computadora avisan cuándo se puede instalar: ahí aparece el botón y con un toque
   queda el ícono en la pantalla. El iPhone no avisa nada y no deja instalar desde un botón, así
   que ahí el botón explica los dos pasos a mano. El cliente no lo ve. */
let pedidoDeInstalar = null;
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad se hace pasar por Mac
const yaInstalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function verBotonInstalar() {
  const b = $('#btnInstalar');
  if (!b) return;
  // Se ve siempre, salvo que ya esté instalada o sea la pantalla del cliente. Si el navegador no
  // ofrece instalarla de una, el botón explica los pasos: nunca te deja sin saber cómo.
  b.hidden = !!window.PD_EMBED || yaInstalada() || document.body.classList.contains('cliente');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // el cartel lo mostramos nosotros, cuando toques el botón
  pedidoDeInstalar = e;
  verBotonInstalar();
});
window.addEventListener('appinstalled', () => {
  pedidoDeInstalar = null;
  verBotonInstalar();
  toast('Listo: ya quedó en tu pantalla de inicio.');
});

on('#btnInstalar', 'click', async () => {
  if (pedidoDeInstalar) {
    pedidoDeInstalar.prompt();
    const r = await pedidoDeInstalar.userChoice.catch(() => null);
    pedidoDeInstalar = null;
    verBotonInstalar();
    if (r && r.outcome === 'accepted') toast('Instalando…');
    return;
  }
  if (esIOS) {
    alert('Para dejarla en el iPhone:\n\n' +
          '1. Tocá el botón Compartir (el cuadradito con la flecha para arriba, abajo en el medio).\n' +
          '2. Bajá y tocá "Añadir a pantalla de inicio".\n\n' +
          'Queda el ícono como cualquier otra app.');
    return;
  }
  alert('Para dejarla en este aparato:\n\n' +
        'Android: menú ⋮ del navegador → "Instalar aplicación" (o "Añadir a pantalla de inicio").\n' +
        'Computadora: el ícono de instalar que aparece a la derecha de la dirección.');
});

async function init() {
  resize();
  verBotonInstalar();
  if (!chequearOrigen()) return;
  // En celulares flojos el cálculo de rincones cuesta caro: arranca apagado y se puede prender.
  realista = !/Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 2) >= 6;
  try {
    armarCompositor();
  } catch (err) {
    console.warn('Sin compositor:', err);
    composer = null;
    realista = false;
  }
  $('#btnReal').classList.toggle('on', realista);
  $('#btnReal').hidden = !composer;
  // Link del cliente: solo mirar. No hay nada acá que pueda cambiar el diseño.
  const idLink = new URLSearchParams(location.search).get('p');
  if (idLink) {
    document.body.classList.add('cliente');
    verBotonInstalar();
    busy('Bajando el diseño…');
    try {
      await openPublished(idLink);
    } catch (err) {
      console.error(err);
      $('#emptyMsg').hidden = false;
      const aviso = $('#emptyMsg').querySelector('.client-only');
      if (aviso) aviso.hidden = false;
      toast(err.message || 'No se pudo abrir la propuesta.');
    } finally {
      idle();
    }
    return;
  }
  // Archivo mandado al cliente: trae todo adentro, no toca el disco ni internet.
  if (window.PD_EMBED) {
    document.body.classList.add('cliente');
    busy('Abriendo el diseño…');
    try {
      await abrirIncrustado(window.PD_EMBED);
    } catch (err) {
      console.error(err);
      $('#emptyMsg').hidden = false;
      toast(err.message || 'No se pudo abrir el diseño.');
    } finally {
      idle();
    }
    return;
  }
  const list = await refreshList();
  if (list.length) await openProject($('#projSel').value);
  else $('#emptyMsg').hidden = false;
}

init();


// Service worker + actualización sola.
//
// Antes, al publicar una versión nueva había que acordarse de hacer Ctrl+F5: el navegador seguía
// corriendo el app.js viejo hasta que lo recargaras a mano. Ahora la página busca la versión nueva
// sola (al abrir, al volver a la pestaña y cada 10 minutos) y se recarga cuando la encuentra.
if ('serviceWorker' in navigator && !window.PD_EMBED && location.protocol !== 'file:') {
  const yaControlada = !!navigator.serviceWorker.controller;   // si no, es la primera visita
  let recargando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!yaControlada || recargando) return;   // la primera vez no se recarga: ya es la última
    if (document.querySelector('dialog[open]')) return;   // no cortarte mientras completás algo
    recargando = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { return; }
    const buscar = () => { if (!document.hidden) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', buscar);
    setInterval(buscar, 10 * 60 * 1000);
  });
}
})();
