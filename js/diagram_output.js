// =========================================================================
// 1. 🌍 全域參數與變數 (Global Params)
// =========================================================================
const url = new URL(location.href);
const line_kind = url.searchParams.get('lineKind'); // 例如: LINE_Alishan, thsr, 林鐵
const formattedDate = url.searchParams.get('formattedDate');
const loadRealtimeParam = url.searchParams.get('realtime');
const scrollToCurrentTimeParam = url.searchParams.get('scrollToCurrentTime');

// 公用變數
let date = null;
let circle_blink = null;
let scrollToCurrentTime = scrollToCurrentTimeParam === 'true';

// 定義基本檔案相依性
const dependencies = [
    'js/svg.js/svg.min.js',
    'js/config.js',
    'js/util.js',
    'js/time_space.js',
    'js/diagram.js'
];

// 開始程式流程
loadDependencies();

// =========================================================================
// 2. 🎛️ 中央控制面板 (Config) - 請在這裡改檔名！
// =========================================================================
const staticSchedules = {
    // 🌲 林鐵：全車次單一檔案
    "林鐵": [
        // 🟢 第一個時段：1月 (舊班表)
        { 
            file: "data/林鐵_20260110~20261231.json" 
        }
    ],
    
    // 高鐵：星期分流 (自動拼湊 "高鐵_一_...")
        "thsr": [
            {
                // 改成我們剛剛抓下來的後綴！
                fileSuffix: "20260202~20261231.json" 
            }
        ]
};

// =========================================================================
// 3. 🧠 核心邏輯區 (Core Logic)
// =========================================================================

// 下載相依檔案並初始化
async function loadDependencies() {
    try {
        for (const dep of dependencies) {
            await loadScript(dep);
        }
        await initial_data();
    } catch (err) {
        console.error("載入腳本時發生錯誤:", err);
    }
}

// 載入腳本工具
function loadScript(file) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = file;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// 安全讀取 JSON (防呆)
async function safeReadJSONFile(fileUrl) {
    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
            console.warn(`❌ 找不到檔案 (404): ${fileUrl}`);
            return null;
        }
        console.log(`✅ 載入成功: ${fileUrl}`);
        return await response.json();
    } catch (error) {
        console.error(`❌ 讀取錯誤: ${fileUrl}`, error);
        return null;
    }
}

// 日期轉星期幾
function getWeekdayStr(dateString) {
    const year = parseInt(dateString.substring(0, 4));
    const month = parseInt(dateString.substring(4, 6)) - 1; 
    const day = parseInt(dateString.substring(6, 8));
    const dateObj = new Date(year, month, day);
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"]; 
    return weekdays[dateObj.getDay()];
}

// ✨ 檔名日期解析器 (Magic Parser)
function parseDateRange(filename) {
    const match = filename.match(/(\d{8})~(\d{8})/);
    if (match) {
        return { start: match[1], end: match[2] };
    }
    return null;
}

// 🚦 智慧路由器 (決定抓哪個檔案) - 關鍵修復在這裡！
function getTargetFile(lineKind, targetDate) {
    
    // 🌲 林鐵模式 (包含 LINE_Alishan)
    // 👇 這裡修復了您的問題：加入了 || lineKind === "LINE_Alishan"
    if (lineKind === "林鐵" || lineKind === "lintie" || lineKind === "LINE_Alishan") {
        for (let config of staticSchedules["林鐵"]) {
            const range = parseDateRange(config.file);
            
            if (range && targetDate >= range.start && targetDate <= range.end) {
                console.log(`🌲 林鐵 (${lineKind}) | 日期命中 [${range.start}~${range.end}] | 讀取 ${config.file}`);
                return config.file;
            }
        }
        console.warn(`⛔ 林鐵 | 日期 ${targetDate} 超出設定範圍`);
        return null;
    }
    
    // 🚅 高鐵模式
    else if (lineKind === "thsr" || lineKind === "高鐵") {
        const weekday = getWeekdayStr(targetDate);
        for (let config of staticSchedules["thsr"]) {
            const range = parseDateRange(config.fileSuffix);
            
            if (range && targetDate >= range.start && targetDate <= range.end) {
                const fullPath = `data/高鐵_${weekday}_${config.fileSuffix}`;
                console.log(`🚅 高鐵 | 星期${weekday} | 日期命中 | 讀取 ${fullPath}`);
                return fullPath;
            }
        }
        console.warn(`⛔ 高鐵 | 日期 ${targetDate} 超出設定範圍`);
        return null;
    }
    
    // 🚂 台鐵模式 (預設)
    console.log(`🚂 台鐵 | 動態讀取 data/${targetDate}.json`);
    return `data/${targetDate}.json`;
}

// =========================================================================
// 4. 🚀 主程式入口 (Main Execution)
// =========================================================================
async function initial_data() {
    try {
        date = formattedDate ? formattedDate : getTodayFormattedDate('nodash');

        // 取得目標檔案路徑
        const targetFile = getTargetFile(line_kind, date);

        // 讀取底圖設定
        const baseFiles = [
            readJSONFile(file1),
            readJSONFile(file2),
            readJSONFile(file3),
            readJSONFile(file4),
            readJSONFile(file5)
        ];

        const baseResults = await Promise.all(baseFiles);
        Route = baseResults[0];
        SVG_X_Axis = baseResults[1];
        initial_line_data(baseResults[2]);
        OperationLines = baseResults[3];
        CarKind = baseResults[4];

        // 讀取時刻表
        let scheduleData = null;
        if (targetFile) {
            scheduleData = await safeReadJSONFile(targetFile);
        }

        // 畫圖或顯示空白
        if (!scheduleData) {
            console.warn(`⚠️ 無資料，顯示空白圖`);
            const emptyData = { TrainInfos: [] };
            execute(emptyData, null, date);
        } else {
            execute(scheduleData, null, date);
        }

    } catch (err) {
        console.error("初始化錯誤:", err);
    }
}

// =========================================================================
// 5. 🎨 繪圖與 UI 處理 (Rendering & UI)
// =========================================================================

function execute(json_data, live_json_data, date) {
    // 清除已有的運行圖    
    const svg = document.querySelectorAll("svg");
    svg.forEach(function (svg) {
        svg.remove();
    });

    try {
        const all_trains_data = json_to_trains_data(json_data, '', line_kind);  // 將JSON轉換成時間空間資料
        let realtime_trains = null

        draw_diagram_background(line_kind, date);                         // 繪製運行圖底圖
        draw_train_path(all_trains_data, realtime_trains);          // 繪製每一個車次線
        set_user_styles();

        if (realtime_trains) {
            // 開始閃動效果
            circle_blink = document.getElementsByTagName("circle");
            for (const iterator of circle_blink) {
                iterator.setAttribute("opacity", "1");
            }
            setInterval(blink, 500);
        }
    }
    catch (error) {
        console.log(error);
    }
    finally {
        finish_draw();
    }
}

function finish_draw() {
    // 移除讀取中的文字標示
    let popup = document.getElementById("popup");
    if (popup && popup.parentNode) {
        popup.parentNode.removeChild(popup);
    }

    // 依照現在的時間，將視窗滾動到整點時間，方便使用者閱讀
    if (scrollToCurrentTime) {
        scroll_current_time();
    }
}

// 設定使用者自訂色系
function set_user_styles() {
    const user_data = JSON.parse(localStorage.getItem("user_styles"));

    if (user_data != null) {
        Object.entries(user_data).forEach(([key, value]) => {
            Object.entries(value).forEach(([k, v]) => {
                const elements = document.getElementsByClassName(k);
                for (const iterator of elements) {
                    if (key == "fills")
                        iterator.style.fill = v[1];
                    else if (key == "strokes")
                        iterator.style.stroke = v[1];
                }

            })
        })
    }
}

// 列車位置閃動
function blink() {
    for (const iterator of circle_blink) {
        if (iterator.getAttribute("opacity") === "0") {
            iterator.setAttribute("opacity", "1");
        } else if (iterator.getAttribute("opacity") === "1") {
            iterator.setAttribute("opacity", "0");
        }
    }
}

// 捲動圖片到現在的時間
function scroll_current_time() {
    let now = new Date();
    let min = screen.width >= 1000 ? 0 : (now.getMinutes() - 10) / 60;
    let hour_position = now.getHours() + Math.round(min * 100) / 100 - 4;
    if (hour_position > 0) {
        hour_position *= 1200;
        window.scrollTo(hour_position, 0);
    }
}
