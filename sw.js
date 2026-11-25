// Service worker: que la página siga abriendo aunque el cliente tenga mala señal.
//
// Primero se pide a internet y recién si no hay conexión se usa la copia guardada. Al revés
// (copia primero) el celular se quedaba con una versión vieja mezclada con una nueva y la página
// dejaba de funcionar. Así, lo que se publica se ve siempre al recargar.
const CACHE = 'presentacion-disenos-v13';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/supabase.js', 'vendor/three.min.js', 'vendor/OrbitControls.js', 'vendor/TGALoader.js',
  'vendor/LineSegmentsGeometry.js', 'vendor/LineMaterial.js', 'vendor/LineSegments2.js',
  'vendor/ColladaLoader.js', 'vendor/OBJLoader.js', 'vendor/GLTFLoader.js',
  'vendor/SimplexNoise.js', 'vendor/CopyShader.js', 'vendor/SSAOShader.js',
  'vendor/EffectComposer.js', 'vendor/RenderPass.js', 'vendor/ShaderPass.js',
  'vendor/MaskPass.js', 'vendor/SSAOPass.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;  // los modelos van directo a la nube
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
