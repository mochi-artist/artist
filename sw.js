// ★ 核心版本號 v3
const CACHE_NAME = 'railway-app-v3'; 

// 預先下載清單：包含首頁、所有畫圖工具(JS)與靜態圖片
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './diagram_output.html', 
  './lines.html',
  './navbar.html',
  './css/web.css',
  
  // JS 畫圖工具
  './js/config.js',
  './js/diagram.js',
  './js/diagram_output.js',
  './js/time_space.js',
  './js/timer.js',
  './js/url.min.js',
  './js/util.js',

  // 靜態圖片
  './images/browser.png',
  './images/facebook.png',
  './images/github.png',
  './images/gmail.png',
  './images/instagram.png',
  './images/timespan.png'
];

// 安裝階段：將上面的清單強制存入手機
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('正在預先下載核心檔案...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 啟動階段：清理舊版本的快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('清除舊快取:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// 攔截請求：網路優先 (Network First) + 動態收集資料
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 【動態收集】不管抓到什麼(包括資料檔)，都順手存進倉庫
        const clonedResponse = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clonedResponse);
        });
        return response;
      })
      .catch(() => {
        // 【斷網讀取】沒網路時從倉庫拿資料，無視網址的問號參數
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});
