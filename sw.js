const CACHE_NAME = 'sammelbuch-v21';
const APP_SHELL = ['./Sammelbuch.html','./data-model.js','./cloud-store.js','./manifest.json','./icon-192.svg','./icon-512.svg'];
const CDN_URLS = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.9/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js',
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll([...APP_SHELL,...CDN_URLS])));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sammelbuch-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const {request}=event;
  const url=new URL(request.url);
  // Only immutable public dependencies and app files are cached. Never intercept
  // Supabase requests, authenticated requests, or writes (even while offline).
  if(request.method!=='GET'||request.headers.has('Authorization')||url.hostname.endsWith('.supabase.co')) return;
  const isAsset=url.origin===self.location.origin&&APP_SHELL.some(asset=>new URL(asset,self.registration.scope).pathname===url.pathname);
  const isCDN=CDN_URLS.includes(url.href);
  if(!isAsset&&!isCDN) return;
  event.respondWith(cacheFirst(request));
});
async function cacheFirst(request){
  // Match within this release only: never use a previous release's API cache.
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached) return cached;
  try {
    const response=await fetch(request);
    if(response.ok) await cache.put(request,response.clone());
    return response;
  } catch {
    return new Response('Offline – bitte später erneut versuchen.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
}
