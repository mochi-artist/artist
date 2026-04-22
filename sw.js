// ★ 升級為 v4，並將快取分為「靜態保險箱」與「動態暫存區」
const STATIC_CACHE = 'railway-static-v4';
const DYNAMIC_CACHE = 'railway-dynamic-v4';

// ★ 設定動態資料的容量上限 (例如 60 個檔案，約保留幾天份的各線資料，可自行調整)
const MAX_DYNAMIC_ITEMS = 60; 

// 靜態保險箱名單：包含首頁、所有畫圖工具(JS)與靜態圖片
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

// 【魔法函數】限制快取數量的清理器
const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size) {
        // 如果超過數量限制，就刪除最舊的那個檔案 (陣列的第一個)，然後重複檢查
        cache.delete(keys[0]).then(() => limitCacheSize(name, size));
      }
    });
  });
};

// 安裝階段：將靜態工具放入保險箱
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('正在下載靜態核心檔案...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 啟動階段：清理舊版本的快取 (這會把您之前 v3 佔用的龐大空間清掉)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          // 只要不是目前的 v4 版本，通通刪除
          if (cache !== STATIC_CACHE && cache !== DYNAMIC_CACHE) {
            console.log('清除舊快取釋放空間:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// 攔截請求：網路優先 + 自動管理暫存區容量
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 有網路時：抓到新資料，存入「動態暫存區」
        const clonedResponse = response.clone();
        caches.open(DYNAMIC_CACHE).then(cache => {
          cache.put(event.request, clonedResponse);
          // ⚠️ 存入新檔案後，呼叫清理器，超過上限就自動丟掉最舊的檔案
          limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
        });
        return response;
      })
      .catch(() => {
        // 沒網路時：從所有快取 (包含靜態與動態) 中尋找資料，無視網址問號
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});
