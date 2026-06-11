// 穿搭管理扩展 v19 - SillyTavern Extension
// ★ v19 改进：
//   1. 合并注入：User+Char穿搭拼成一条文本后统一注入，避免多条system被忽略
//   2. 强化模板：默认模板加入角色扮演指令格式，Gemini/DeepSeek/Claude均能识别
//   3. 默认注入位置改为user（用户消息末尾），Gemini兼容性最佳
//   4. 保留v18全部功能

(function () {

    var SCRIPT_NAME = 'Codex-Outfit';
    var BTN_ID = 'outfit-mgr-ext-btn-v4';
    var DB_NAME = 'codex_outfit_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'data';
    var DATA_KEY = 'main';
    var SHARED_SETTINGS_KEY = 'Codex-Outfit';
    var SHARED_DATA_KEY = 'wardrobeData';
    var MAX_IMG_WIDTH = 800;
    var IMG_QUALITY = 0.75;
    var FAB_ID = 'om-fab-main';

    var dbInstance = null;
    var dataCache = null;
    var darkMode = true; // 默认暗色
    // 获取弹层容器（overlay内部的absolute层，不受overflow:hidden影响因为overlay本身没有overflow）
    function getPopupLayer() {
        // 首选overlay内的slot
        var slot = document.getElementById('om-popup-slot');
        if (slot) return slot;
        // 回退：overlay本身
        var ov = document.querySelector('.om-overlay');
        if (ov) return ov;
        // 最后回退：body
        return document.body;
    }

    // ── SillyTavern shared settings storage ─────────────────────
    // This lives in the server-side settings file, so different browsers
    // connected to the same SillyTavern instance see the same wardrobe.
    function getSTContextSafe() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) return SillyTavern.getContext();
        } catch (e) {}
        return null;
    }

    function getSharedSettingsRoot() {
        try {
            var ctx = getSTContextSafe();
            var settings = (ctx && ctx.extensionSettings) ||
                (typeof SillyTavern !== 'undefined' && SillyTavern.extension_settings);
            if (!settings) return null;
            if (!settings[SHARED_SETTINGS_KEY]) settings[SHARED_SETTINGS_KEY] = {};
            return settings[SHARED_SETTINGS_KEY];
        } catch (e) { return null; }
    }

    function loadFromSharedSettings() {
        var root = getSharedSettingsRoot();
        return root && root[SHARED_DATA_KEY] ? root[SHARED_DATA_KEY] : null;
    }

    function saveToSharedSettings(d) {
        var root = getSharedSettingsRoot();
        if (!root) return false;
        root[SHARED_DATA_KEY] = d;
        try {
            var ctx = getSTContextSafe();
            if (ctx && ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
        } catch (e) {}
        return true;
    }

    function hasWardrobeData(d) {
        return !!(d && (
            (Array.isArray(d.outfits) && d.outfits.length > 0) ||
            (Array.isArray(d.categories) && d.categories.length > 0) ||
            (d.chars && Object.keys(d.chars).length > 0) ||
            (Array.isArray(d.presets) && d.presets.length > 0)
        ));
    }

    // ── IndexedDB ─────────────────────────────────────────────
    function openDB(cb) {
        if (dbInstance) { cb(dbInstance); return; }
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { dbInstance = e.target.result; cb(dbInstance); };
        req.onerror = function () { cb(null); };
    }

    function loadFromDB(cb) {
        if (dataCache) { cb(dataCache); return; }
        var shared = loadFromSharedSettings();
        if (shared) { dataCache = ensureDefaults(shared); cb(dataCache); return; }
        openDB(function (db) {
            if (!db) {
                dataCache = ensureDefaults(loadFromLS());
                if (hasWardrobeData(dataCache)) saveToSharedSettings(dataCache);
                cb(dataCache);
                return;
            }
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(DATA_KEY);
            req.onsuccess = function () {
                var result = req.result;
                if (!hasWardrobeData(result)) {
                    var backup = loadFromLS();
                    if (hasWardrobeData(backup)) { result = backup; saveToDB(result); }
                }
                dataCache = ensureDefaults(result || loadFromLS());
                if (hasWardrobeData(dataCache)) saveToSharedSettings(dataCache);
                cb(dataCache);
            };
            req.onerror = function () {
                dataCache = ensureDefaults(loadFromLS());
                if (hasWardrobeData(dataCache)) saveToSharedSettings(dataCache);
                cb(dataCache);
            };
        });
    }

    function saveToDB(d, cb) {
        dataCache = d;
        saveToSharedSettings(d);
        openDB(function (db) {
            if (!db) { try { localStorage.setItem('outfit_mgr_v4', JSON.stringify(d)); } catch (e) {} if (cb) cb(); return; }
            var tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(d, DATA_KEY);
            tx.oncomplete = function () { try { localStorage.setItem('outfit_mgr_v4_backup', JSON.stringify(d)); } catch (e) {} if (cb) cb(); };
            tx.onerror = function () { if (cb) cb(); };
        });
    }

    function load() {
        if (dataCache) return dataCache;
        dataCache = ensureDefaults(loadFromSharedSettings() || loadFromLS());
        return dataCache;
    }

    function save(d) { dataCache = d; saveToDB(d); try { localStorage.setItem('outfit_mgr_v4_backup', JSON.stringify(d)); } catch (e) {} }

    function loadFromLS() {
        try { var r = localStorage.getItem('outfit_mgr_v4'); if (r) return JSON.parse(r); var b = localStorage.getItem('outfit_mgr_v4_backup'); if (b) return JSON.parse(b); return null; } catch (e) { return null; }
    }

    function ensureDefaults(d) {
        var dd = def();
        if (!d) return dd;
        for (var k in dd) { if (d[k] === undefined) d[k] = dd[k]; }
        if (d.activeId && !d.activeIds) d.activeIds = [d.activeId];
        if (!Array.isArray(d.activeIds)) d.activeIds = [];
        if (!Array.isArray(d.presets)) d.presets = [];
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        if (!d.charNames) d.charNames = [];
        delete d.apiVision;
        delete d.useMainApi;
        // v17→v18迁移：把带owner的穿搭移入chars
        migrateV17(d);
        return d;
    }

    function def() {
        return {
            // User 数据（预设只管这块）
            outfits: [],
            categories: [],
            activeIds: [],
            virtualOutfits: {},  // runtime-only virtual outfits from world book
            presets: [],
            activePresetId: null,
            // Char 数据（独立存储，不受预设影响）
            chars: {},           // { '角色名': { outfits:[], categories:[], activeIds:[] } }
            charNames: [],       // 角色名列表
            charFavorites: [],   // 收藏的角色名（预留）
            charGroups: {},      // 分组（预留）：{ '组名': ['角色名1','角色名2'] }
            // 界面状态
            currentView: 'user',
            currentChar: '',
            showBall: true,
            // 注入配置
            mode: 'text',
            injectPosition: 'user',
            autoRollDisabled: false,  // 关闭自动随机穿搭
            singleTemplate: '[User当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
            multiTemplate: '[User的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
            charSingleTemplate: '[{{charName}}当前穿着]\n{{description}}\n（禁止编造其他服装。严禁集中罗列服装信息，服装细节必须分散融入不同的动作、触感、环境互动中，每次只带出一两个细节。）',
            charMultiTemplate: '[{{charName}}的可选穿搭]\n{{wardrobe}}\n（禁止编造以上之外的服装。根据场景标签匹配穿搭，若回复中出现场景转换则对应切换穿搭。严禁集中罗列服装信息，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。）',
            imagePrompt: '图中为角色当前穿着，禁止编造其他服装。严禁集中罗列，服装细节必须分散融入动作、触感、环境互动中，每次只带出一两个细节。',
            multiImagePrompt: '以上图片为可选穿搭，根据场景标签匹配，场景转换则切换穿搭，禁止编造其他服装。严禁集中罗列，细节分散融入动作和互动中。',            itemSingleTemplate: '[User单品衣柜]\
{{wardrobe}}\
（以上为当前可用的单品库存，禁止编造以上之外的服装单品。）',            itemMultiTemplate: '[User穿搭+单品]\
{{outfits}}\
\
[单品衣柜]\
{{items}}\
（以上为当前穿搭和可用单品库存，禁止编造以上之外的服装。）',
            debug: false
        };
    }

    function parseAutoTagResult(text) {
        var result = { name: '', type: '', style: '', season: '', scene: '', description: '' };
        if (!text || !text.trim()) return result;
        var clean = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s*/gm, '').trim();
        var parts = clean.split(/---+\n*/); var metaPart = parts[0] || '';
        if (parts.length > 1) result.description = parts.slice(1).join('\n').trim();
        else result.description = metaPart;
        function findKey(kp) {
            var m = metaPart.match(new RegExp(kp + '\s*[：:]\s*(.+?)(?:\n|$)', 'im'));
            if (m) return m[1].trim();
            return '';
        }
        result.name = findKey('名称') || findKey('名字');
        if (!result.name) { var fl = metaPart.split('\n')[0].replace(/^[#*\-\s]+/, '').trim(); if (fl && fl.length >= 2 && fl.length <= 30 && fl.indexOf('：') === -1 && fl.indexOf(':') === -1) result.name = fl; }
        var tr = findKey('类型'); if (tr) { if (tr.indexOf('套装') !== -1 || tr.indexOf('搭配') !== -1 || tr.indexOf('整套') !== -1 || tr.indexOf('outfit') !== -1) result.type = 'outfit'; else if (tr.indexOf('单品') !== -1 || tr.indexOf('单件') !== -1 || tr.indexOf('item') !== -1) result.type = 'item'; }
        result.style = findKey('风格');
        result.season = findKey('季节');
        result.scene = findKey('场景');
        if (!result.name && !result.style && !result.season && !result.scene) result.description = text.trim();
        return result;
    }

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

    // ── Char数据访问辅助 ────────────────────────────────────────
    function getCharData(d, charName) {
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        if (!d.chars[charName]) d.chars[charName] = { outfits: [], categories: [], activeIds: [] };
        return d.chars[charName];
    }

    // 当前视角是user还是某个角色
    function currentOwner(d) {
        if (d.currentView === 'char' && d.currentChar) return d.currentChar;
        return 'user';
    }

    // 获取当前视角的穿搭列表
    function getViewOutfits(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).outfits;
        return d.outfits;
    }

    // 获取当前视角的分类列表
    function getViewCategories(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).categories;
        return d.categories;
    }

    // 获取当前视角的activeIds
    function getViewActiveIds(d) {
        if (d.currentView === 'char' && d.currentChar) return getCharData(d, d.currentChar).activeIds;
        return d.activeIds;
    }

    // 设置当前视角的activeIds
    function setViewActiveIds(d, ids) {
        if (d.currentView === 'char' && d.currentChar) { getCharData(d, d.currentChar).activeIds = ids; }
        else { d.activeIds = ids; }
    }

    // 按id查找穿搭（在所有数据中查找）
    function getById(d, id) {
        for (var i = 0; i < d.outfits.length; i++) { if (d.outfits[i].id === id) return d.outfits[i]; }
        if (d.chars) { for (var cn in d.chars) { var co = d.chars[cn].outfits || []; for (var j = 0; j < co.length; j++) { if (co[j].id === id) return co[j]; } } }
        if (d.virtualOutfits && d.virtualOutfits[id]) return d.virtualOutfits[id];
        return null;
    }

    // 按id查找穿搭（仅当前视角）
    function getViewById(d, id) {
        var list = getViewOutfits(d);
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
        return null;
    }

    // 判断是否激活（当前视角）
    function isActive(d, id) {
        return getViewActiveIds(d).indexOf(id) !== -1;
    }

    // v17兼容：迁移旧数据中带owner字段的穿搭到chars结构
    function migrateV17(d) {
        if (!d.outfits) return;
        var userOutfits = [];
        var moved = {};
        d.outfits.forEach(function (o) {
            if (o.owner && o.owner !== 'user') {
                var cn = o.owner;
                if (!moved[cn]) moved[cn] = [];
                delete o.owner;
                moved[cn].push(o);
            } else {
                delete o.owner;
                userOutfits.push(o);
            }
        });
        d.outfits = userOutfits;
        if (!d.chars) d.chars = {};
        if (!d.virtualOutfits) d.virtualOutfits = {};
        if (!d.charNames) d.charNames = [];
        for (var cn in moved) {
            if (!d.chars[cn]) d.chars[cn] = { outfits: [], categories: [], activeIds: [] };
            d.chars[cn].outfits = d.chars[cn].outfits.concat(moved[cn]);
            if (d.charNames.indexOf(cn) === -1) d.charNames.push(cn);
        }
        // 迁移 charActiveIds
        if (d.charActiveIds) {
            for (var cn2 in d.charActiveIds) {
                if (!d.chars[cn2]) d.chars[cn2] = { outfits: [], categories: [], activeIds: [] };
                d.chars[cn2].activeIds = d.charActiveIds[cn2];
            }
            delete d.charActiveIds;
        }
    }

    // ── 图片压缩 ─────────────────────────────────────────────
    function compressImage(dataUrl, cb) {
        var img = new Image();
        img.onload = function () {
            var w = img.width, h = img.height, canvas = document.createElement('canvas');
            if (w > MAX_IMG_WIDTH) { canvas.width = MAX_IMG_WIDTH; canvas.height = Math.round(h * MAX_IMG_WIDTH / w); }
            else { canvas.width = w; canvas.height = h; }
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            cb(canvas.toDataURL('image/jpeg', IMG_QUALITY));
        };
        img.onerror = function () { cb(dataUrl); };
        img.src = dataUrl;
    }

    // ── Toast ─────────────────────────────────────────────────
    function toast(msg, isErr) {
        var el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'position:absolute !important;bottom:96px !important;left:50% !important;' +
            'transform:translateX(-50%) translateY(8px) !important;' +
            'background:' + (isErr ? '#e57373' : 'var(--SmartThemeQuoteColor,#7c6daf)') + ' !important;' +
            'color:#fff !important;padding:8px 20px !important;border-radius:20px !important;' +
            'font-size:13px !important;font-weight:600 !important;z-index:2147483649 !important;' +
            'box-shadow:0 4px 16px rgba(0,0,0,.4) !important;white-space:nowrap !important;' +
            'pointer-events:none !important;opacity:0 !important;transition:all .22s !important;';
        // 优先挂在 overlay 内
        getPopupLayer().appendChild(el);
        setTimeout(function () {
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('transform', 'translateX(-50%) translateY(0)', 'important');
        }, 10);
        setTimeout(function () { el.style.setProperty('opacity', '0', 'important'); }, 2400);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2700);
    }

    // ── CSS ───────────────────────────────────────────────────
    function injectStyles() {
        var old = document.getElementById('om-style-v4');
        if (old) old.parentNode.removeChild(old);
        var s = document.createElement('style');
        s.id = 'om-style-v4';
        s.textContent = [
            /* ══ 全屏主界面 ══ */
            '@keyframes om-fadein{from{opacity:0}to{opacity:1}}',
            '@keyframes om-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}',
            '@keyframes om-popin{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}',

            /* 全屏遮罩/容器 — 改为窗口化 */
            '.om-light{--om-bg:#f5f5f7;--om-bg2:#ececef;--om-text:#111;--om-border:rgba(0,0,0,.1);--om-card-bg:rgba(0,0,0,.04);--om-head-bg:rgba(255,255,255,.8);}',
            '.om-dark{--om-bg:#16161a;--om-bg2:#1e1e24;--om-text:#eee;--om-border:rgba(255,255,255,.08);--om-card-bg:rgba(255,255,255,.05);--om-head-bg:rgba(0,0,0,.3);}',
            '.om-overlay{position:fixed;inset:4vh 3vw;z-index:2147483647;',
            'background:var(--om-bg,var(--SmartThemeBackgroundColor,#16161a));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));',
            'display:flex;flex-direction:column;color:var(--SmartThemeBodyColor,#eee));',
            'animation:om-fadein .18s ease;font-size:14px;',
            'border:1px solid rgba(127,127,127,.1);border-radius:16px;',
            'box-shadow:0 16px 48px rgba(0,0,0,.35);',
            'transform:translate3d(var(--om-offset-x,0),var(--om-offset-y,0),0) scale(var(--om-scale,1));',
            'transform-origin:center center;transition:transform 160ms ease-out;overflow:hidden;}',
            '.om-overlay.om-dragging{transition:none;}',
            /* 遮罩背景层 */
            '.om-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);',
            'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:om-fadein .18s ease;}',

            /* 主框 全屏填满 */
            '.om-box{width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;}',

            /* ══ 顶栏 ══ */
            '.om-head{display:flex;align-items:center;gap:8px;padding:12px 15px;flex-shrink:0;',
            'border-bottom:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);',
            'cursor:move;user-select:none;touch-action:none;}',
            '.om-head-title{font-weight:700;font-size:1.05em;display:flex;align-items:center;gap:7px;flex:1;min-width:0;pointer-events:auto;}',
            '.om-head-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-head-actions{display:flex;align-items:center;gap:4px;pointer-events:auto;}',
            /* 视口控制（缩放） */
            '.om-viewport{display:flex;align-items:center;gap:3px;padding:2px;',
            'border:1px solid rgba(127,127,127,.15);border-radius:8px;background:rgba(127,127,127,.06);}',
            '.om-viewport-btn{cursor:pointer;background:none;border:none;color:inherit;opacity:.6;',
            'width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;',
            'transition:.15s;font-size:.8em;}',
            '.om-viewport-btn:hover{opacity:1;background:rgba(127,127,127,.15);}',
            '.om-viewport-label{min-width:38px;text-align:center;font-size:.75em;opacity:.6;}',
            '.om-icon-btn{cursor:pointer;background:none;border:none;opacity:.55;font-size:1.15em;',
            'width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
            'transition:.18s;color:inherit;flex-shrink:0;}',
            '.om-icon-btn:hover{opacity:1;background:rgba(127,127,127,.12);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 日夜切换 */
            '.om-theme-btn{cursor:pointer;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.2);',
            'border-radius:14px;padding:4px 10px;font-size:.75em;display:flex;align-items:center;gap:5px;',
            'transition:.2s;color:inherit;flex-shrink:0;height:28px;white-space:nowrap;}',
            '.om-theme-btn:hover{background:rgba(127,127,127,.2);}',,

            /* 搜索框（顶栏下方展开）*/
            '.om-search-bar{display:none;padding:8px 15px;border-bottom:1px solid rgba(127,127,127,.08);',
            'background:rgba(0,0,0,.06);flex-shrink:0;}',
            '.om-search-bar.open{display:flex;align-items:center;gap:8px;}',
            '.om-search-wrap{flex:1;position:relative;display:flex;align-items:center;}',
            '.om-search-wrap i{position:absolute;left:10px;opacity:.4;font-size:.85em;pointer-events:none;}',
            '.om-search-inp{width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:7px 32px 7px 30px;font-size:.85em;font-family:inherit;box-sizing:border-box;}',
            '.om-search-inp:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-search-clear{background:none;border:none;color:inherit;opacity:.4;cursor:pointer;font-size:.9em;padding:4px;line-height:1;}',
            '.om-search-clear:hover{opacity:.9;}',

            /* ══ 视角切换栏 ══ */
            '.om-viewbar{display:flex;align-items:center;gap:6px;padding:8px 15px;flex-shrink:0;',
            'border-bottom:1px solid rgba(127,127,127,.08);}',
            '.om-viewtab{padding:5px 16px;border-radius:18px;font-size:.78em;cursor:pointer;white-space:nowrap;',
            'border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-viewtab:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-viewtab.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);font-weight:600;}',
            '.om-char-sel{flex:1;min-width:0;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:5px 10px;font-size:.78em;font-family:inherit;}',
            '.om-char-sel:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-add-btn{background:none;border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;',
            'cursor:pointer;padding:5px 10px;font-size:.78em;white-space:nowrap;font-family:inherit;}',
            '.om-char-add-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 角色选择面板 ══ */
            /* viewbar内的角色搜索框 */
            '.om-char-input{flex:1;min-width:0;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:5px 10px;font-size:.78em;font-family:inherit;box-sizing:border-box;}',
            '.om-char-input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-input::placeholder{opacity:.4;}',
            /* 下拉列表容器 */
            '.om-char-dropdown{position:absolute;left:0;right:0;top:100%;z-index:50;',
            'background:var(--om-bg,#1a1a20);border-bottom:1px solid rgba(127,127,127,.15);',
            'max-height:50vh;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,.2);}',
            '.om-light .om-char-dropdown{background:var(--om-bg,#f4f4f6);}',
            /* 分组标题 */
            '.om-char-group-hdr{display:flex;align-items:center;gap:6px;padding:7px 12px 4px;cursor:pointer;font-size:.78em;font-weight:600;opacity:.5;}',
            '.om-char-group-hdr:hover{opacity:.7;}',
            '.om-char-group-hdr i.om-g-arrow{font-size:.7em;transition:transform .15s;width:10px;text-align:center;}',
            '.om-char-group-hdr i.om-g-arrow.collapsed{transform:rotate(-90deg);}',
            '.om-char-group-hdr i.om-g-icon{font-size:.75em;opacity:.6;}',
            /* 角色行 */
            '.om-char-row{display:flex;align-items:center;gap:8px;padding:9px 12px 9px 20px;cursor:pointer;',
            'transition:background .1s;font-size:.9em;}',
            '.om-char-row:hover{background:rgba(127,127,127,.08);}',
            '.om-char-row.active{background:rgba(124,109,175,.1);}',
            '.om-char-star{cursor:pointer;opacity:.25;flex-shrink:0;width:20px;text-align:center;font-size:.85em;}',
            '.om-char-star.on{opacity:.8;color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-char-rname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.om-char-count{font-size:.78em;opacity:.4;flex-shrink:0;min-width:28px;text-align:right;}',
            '.om-char-actions{display:flex;gap:2px;flex-shrink:0;}',
            '.om-char-act{background:none;border:none;color:inherit;cursor:pointer;opacity:.25;font-size:.82em;padding:3px 5px;border-radius:4px;transition:.15s;}',
            '.om-char-act:hover{opacity:.85;background:rgba(127,127,127,.15);}',
            '.om-char-act.om-char-delete:hover{opacity:1;color:#e57373;background:rgba(229,115,115,.12);}',
            '.om-char-empty{text-align:center;opacity:.3;font-size:.85em;padding:18px 15px;}',

            /* ══ 分类栏 ══ */
            '.om-catbar{display:flex;gap:6px;padding:8px 15px;overflow-x:auto;flex-wrap:nowrap;flex-shrink:0;',
            '-webkit-overflow-scrolling:touch;scrollbar-width:none;',
            'border-bottom:1px solid rgba(127,127,127,.08);}',
            '.om-catbar::-webkit-scrollbar{display:none;}',
            '.om-catbtn{padding:5px 14px;border-radius:18px;font-size:.78em;cursor:pointer;white-space:nowrap;flex-shrink:0;',
            'border:1px solid rgba(127,127,127,.15);background:rgba(127,127,127,.06);transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-catbtn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-catbtn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);font-weight:600;}',

            /* ══ 网格区（独立滚动）══ */
            '.om-grid-area{flex:1;overflow-y:auto;padding:12px 12px 8px;}',
            '.om-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:9px;}',

            /* ══ 添加卡片 ══ */
            '.om-add-card{border:2px dashed rgba(127,127,127,.22);border-radius:10px;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;',
            'cursor:pointer;opacity:.55;transition:all .2s;font-size:.8em;color:inherit;}',
            '.om-add-card:hover{opacity:1;border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.04);}',
            '.om-add-card i{font-size:1.4em;}',
'.om-batch-add-card{border:2px dashed rgba(127,127,127,.22);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;opacity:.55;transition:all .2s;font-size:.8em;color:inherit;background:linear-gradient(135deg,rgba(124,109,175,.04) 0%,rgba(124,109,175,.01) 100%);}',
'.om-batch-add-card:hover{opacity:1;border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(124,109,175,.08);}',
'.om-batch-add-card i{font-size:1.4em;}',
'.om-type-radios{display:flex;gap:12px;}',
'.om-radio-label{display:flex;align-items:center;gap:4px;font-size:.85em;cursor:pointer;opacity:.7;}',
'.om-radio-label:hover{opacity:1;}',
'.om-radio-label input[type=radio]{accent-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 穿搭卡片 ══ */
            '.om-card{border-radius:10px;overflow:hidden;position:relative;cursor:pointer;',
            'transition:all .18s;border:2px solid transparent;display:flex;flex-direction:column;}',
            '.om-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.25);}',
            '.om-card.on{border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'box-shadow:0 0 0 1px var(--SmartThemeQuoteColor,#7c6daf),0 4px 16px rgba(0,0,0,.2);}',
            /* 图片区 */
            '.om-card-img{width:100%;aspect-ratio:3/4;position:relative;background:rgba(127,127,127,.1);',
            'display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;}',
            '.om-card-img img{width:100%;height:100%;object-fit:cover;display:block;}',
            /* 底部渐变文字遮罩 */
            /* 触屏：点击过的卡片菜单常显 */
            '@media (hover:none){.om-card-menu{opacity:.75 !important;}}',
            '.om-card-info{padding:5px 7px 6px;background:var(--om-card-bg,rgba(127,127,127,.06));min-height:36px;box-sizing:border-box;}',
            '.om-card-name{font-size:.8em;font-weight:600;line-height:1.3;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            'color:var(--om-text,#eee);}',
            '.om-card-tag{font-size:.68em;line-height:1.2;margin-top:2px;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
            'color:var(--om-text,#aaa);opacity:.5;}',
            /* 无图片占位 - 显示描述摘要 */
            '.om-card-noimg{display:flex;flex-direction:column;align-items:flex-start;gap:5px;',
            'width:100%;height:100%;justify-content:flex-start;padding:12px 12px 32px 12px;box-sizing:border-box;',
            'background:linear-gradient(135deg,rgba(127,127,127,.08) 0%,rgba(127,127,127,.03) 100%);}',
            '.om-card-noimg .om-noimg-name{font-size:.88em;font-weight:700;line-height:1.3;',
            'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
            'word-break:break-all;color:var(--om-text,#eee);}',
            '.om-card-noimg .om-noimg-desc{font-size:.78em;line-height:1.45;opacity:.55;',
            'display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden;',
            'word-break:break-all;color:var(--om-text,#ccc);}',
            '.om-card-noimg .om-noimg-icon{font-size:1.2em;opacity:.2;position:absolute;bottom:8px;right:8px;}',
            /* 有文字描述但无图片时显示背景 */
            '.om-card.no-img{background:var(--om-card-bg,rgba(127,127,127,.06));}',
            '.om-card.no-img .om-card-info{display:none;}',
            '.om-card.no-img .om-card-img{aspect-ratio:unset;flex:1;min-height:0;}',
            /* 选中角标 */
            '.om-badge-on{position:absolute;top:5px;right:5px;',
            'width:20px;height:20px;border-radius:50%;',
            'background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;',
            'display:flex;align-items:center;justify-content:center;font-size:.6em;',
            'box-shadow:0 2px 6px rgba(0,0,0,.3);}',
            /* 批量选择框 */
            '.om-card-check{position:absolute;top:5px;left:5px;',
            'width:20px;height:20px;border-radius:6px;border:2px solid rgba(255,255,255,.7);',
            'background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;',
            'cursor:pointer;transition:.15s;z-index:2;}',
            '.om-card-check.checked{background:var(--SmartThemeQuoteColor,#7c6daf);border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-card-check i{font-size:.65em;color:#fff;opacity:0;transition:.12s;}',
            '.om-card-check.checked i{opacity:1;}',
            '.om-card.batch-sel{border:2px solid var(--SmartThemeQuoteColor,#7c6daf);}',

            /* 卡片菜单按钮 - 右下角，不与对号冲突 */
            '.om-card-menu{position:absolute;bottom:5px;right:5px;',
            'width:20px;height:20px;border-radius:50%;',
            'background:rgba(0,0,0,.5);color:#fff;border:none;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;font-size:.55em;line-height:1;overflow:hidden;',
            'opacity:0;transition:opacity .18s;z-index:3;pointer-events:auto;',
            'backdrop-filter:blur(4px);box-shadow:0 2px 6px rgba(0,0,0,.3);}',
            '.om-card:hover .om-card-menu,.om-card:active .om-card-menu{opacity:1;}',
            '.om-card-menu:hover{background:rgba(0,0,0,.75);}',

            /* ══ 批量操作栏（网格区顶部，随滚动）══ */
            '.om-batch-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;',
            'background:rgba(124,109,175,.08);border:1px solid rgba(124,109,175,.2);',
            'border-radius:10px;margin-bottom:10px;flex-wrap:nowrap;overflow-x:auto;',
            '-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
            '.om-batch-bar::-webkit-scrollbar{display:none;}',
            '.om-batch-info{font-size:.82em;font-weight:600;color:var(--SmartThemeQuoteColor,#7c6daf);white-space:nowrap;flex-shrink:0;}',
            '.om-batch-acts{display:flex;gap:5px;flex-shrink:0;flex-wrap:nowrap;}',
            '.om-batch-btn{padding:5px 10px;border-radius:6px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.78em;',
            'font-family:inherit;transition:.15s;white-space:nowrap;flex-shrink:0;}',
            '.om-batch-btn:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-btn.danger{color:#e57373;border-color:rgba(229,115,115,.35);}',
            '.om-batch-btn.danger:hover{background:#e57373;color:#fff;border-color:#e57373;}',

            /* 空状态 */
            '.om-empty{text-align:center;padding:40px 0;opacity:.45;display:flex;flex-direction:column;gap:10px;align-items:center;font-size:.88em;}',
            '.om-empty i{font-size:2.6em;}',

            /* ══ 底栏 ══ */
            '.om-quick-scenes{display:flex;gap:4px;flex-wrap:wrap;margin-left:8px;}.om-quick-scene-btn{font-size:.7em;padding:3px 8px;border-radius:12px;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.06);color:inherit;cursor:pointer;white-space:nowrap;transition:all .15s;}.om-quick-scene-btn:hover{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);}.om-bottombar{display:flex !important;align-items:center;gap:6px;padding:10px 14px;flex-shrink:0;',
            'border-top:1px solid rgba(127,127,127,.1);background:rgba(0,0,0,.12);}',
            '.om-bottom-status{flex:1;min-width:0;display:flex;align-items:center;gap:7px;',
            'cursor:pointer;border-radius:8px;padding:5px 7px;transition:.15s;',
            'border:1px solid transparent;}',
            '.om-bottom-status:hover{background:rgba(127,127,127,.08);border-color:rgba(127,127,127,.12);}',
            '.om-status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
            '.om-status-dot.gray{background:rgba(127,127,127,.5);}',
            '.om-status-dot.green{background:#4caf50;}',
            '.om-status-dot.orange{background:#ff8c42;}',
            '.om-status-text{font-size:.82em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}',
            '.om-status-clear{margin-left:4px;background:none;border:none;font-size:.75em;color:inherit;',
            'opacity:.5;cursor:pointer;white-space:nowrap;padding:2px 5px;border-radius:4px;font-family:inherit;flex-shrink:0;}',
            '.om-status-clear:hover{opacity:1;background:rgba(127,127,127,.1);}',
            '.om-bottom-btn{width:36px;height:36px;border-radius:50%;border:1px solid rgba(127,127,127,.15);',
            'background:rgba(127,127,127,.06);color:inherit;cursor:pointer;',
            'display:flex;align-items:center;justify-content:center;font-size:.9em;',
            'transition:.18s;flex-shrink:0;}',
            '.om-bottom-btn:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);',
            'color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-toggle-btn{padding:6px 11px;border-radius:18px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.75em;',
            'white-space:nowrap;font-family:inherit;transition:.15s;flex-shrink:0;}',
            '.om-batch-toggle-btn:hover{border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-batch-toggle-btn.on{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 选择详情面板（从底栏上方弹出）══ */
            '.om-detail-panel{position:absolute;bottom:0;left:0;right:0;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(28,28,32,1)));',
            'border-radius:16px 16px 0 0;padding:14px 16px 16px;',
            'box-shadow:0 -4px 24px rgba(0,0,0,.3);',
            'animation:om-sheet-up .22s ease;border-top:1px solid rgba(127,127,127,.15);}',
            '.om-detail-handle{width:32px;height:4px;border-radius:2px;',
            'background:rgba(127,127,127,.25);margin:0 auto 12px;}',
            '.om-detail-title{font-size:.78em;font-weight:700;opacity:.55;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;}',
            '.om-detail-tags{display:flex;flex-wrap:wrap;gap:6px;}',
            '.om-detail-tag{display:inline-flex;align-items:center;gap:5px;',
            'padding:4px 6px 4px 10px;border-radius:14px;',
            'background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;font-size:.78em;font-weight:600;}',
            '.om-detail-tag-x{background:none;border:none;color:#fff;cursor:pointer;',
            'font-size:.9em;line-height:1;padding:0 2px;opacity:.75;font-family:inherit;}',
            '.om-detail-tag-x:hover{opacity:1;}',

            /* ══ Bottom Sheet 通用 ══ */
            '.om-sheet-overlay{position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;pointer-events:auto !important;}',
            '.om-sheet{position:absolute;bottom:0;left:0;right:0;max-height:88vh;max-height:88dvh;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,#1a1a1e));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));',
            'border-radius:18px 18px 0 0;overflow-y:auto;',
            'animation:om-sheet-up .25s ease;border:1px solid rgba(127,127,127,.15);border-bottom:none;}',
            '.om-sheet-handle{width:36px;height:4px;border-radius:2px;',
            'background:rgba(127,127,127,.25);margin:10px auto 4px;}',
            '.om-sheet-content{padding:4px 20px 32px;}',
            '.om-sheet-title{font-weight:700;font-size:1.05em;padding:10px 0 14px;',
            'display:flex;align-items:center;gap:8px;}',
            '.om-sheet-title i{color:var(--SmartThemeQuoteColor,#7c6daf);}',

            /* ══ 长按操作菜单 Bottom Sheet ══ */
            '.om-ctx-item{display:flex;align-items:center;gap:12px;padding:14px 4px;',
            'cursor:pointer;border-bottom:1px solid rgba(127,127,127,.08);transition:.15s;border-radius:0;}',
            '.om-ctx-item:last-child{border-bottom:none;}',
            '.om-ctx-item:hover{color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-ctx-item i{width:20px;text-align:center;opacity:.75;font-size:1em;}',
            '.om-ctx-item.danger{color:#e57373;}',
            '.om-ctx-item.danger:hover{color:#ef5350;}',
            '.om-ctx-outfit-name{font-size:.85em;opacity:.5;padding:2px 0 10px;',
            'border-bottom:1px solid rgba(127,127,127,.1);margin-bottom:4px;}',

            /* ══ 通用组件 ══ */
            '.om-sec-title{font-size:.75em;font-weight:700;opacity:.55;text-transform:uppercase;',
            'letter-spacing:.07em;padding:10px 0 7px;}',
            '.om-divider{height:1px;background:rgba(127,127,127,.12);margin:6px 0 12px;}',
            '.om-hint{font-size:.76em;opacity:.5;line-height:1.4;}',
            '.om-btn-row{display:flex;gap:8px;flex-wrap:wrap;}',
            '.om-btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;',
            'font-size:.87em;font-weight:600;transition:.18s;font-family:inherit;}',
            '.om-btn-safe{background:var(--SmartThemeQuoteColor,#7c6daf);color:#fff;}',
            '.om-btn-safe:hover{filter:brightness(1.1);box-shadow:0 3px 10px rgba(0,0,0,.15);}',
            '.om-btn-outline{background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.22);color:inherit;}',
            '.om-btn-outline:hover{background:rgba(127,127,127,.15);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-btn-danger{background:rgba(229,115,115,.1);border:1px solid #e57373;color:#e57373;}',
            '.om-btn-danger:hover{background:#e57373;color:#fff;}',
            /* 输入 */
            '.om-setting-row{display:flex;flex-direction:column;gap:5px;margin-bottom:4px;}',
            '.om-setting-row label{font-size:.8em;opacity:.7;}',
            '.om-setting-row select,.om-setting-row textarea{background:rgba(127,127,127,.08);',
            'border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;',
            'padding:7px 10px;font-size:.85em;width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;}',
            '.om-setting-row select:focus,.om-setting-row textarea:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-row-inline{flex-direction:row!important;align-items:center;justify-content:space-between;}',
            '.om-row-inline label{opacity:.8;font-size:.88em;}',
            '.om-chk{width:17px;height:17px;accent-color:var(--SmartThemeQuoteColor,#7c6daf);cursor:pointer;}',
            '.om-storage-info{font-size:.72em;opacity:.45;padding:4px 0;}',
            /* 编辑表单 */
            '.om-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}',
            '.om-field label{font-size:.8em;opacity:.7;font-weight:500;}',
            '.om-field input[type=text],.om-field select,.om-field textarea{',
            'background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:9px 11px;font-size:.9em;width:100%;box-sizing:border-box;font-family:inherit;}',
            '.om-field textarea{resize:none;}',
            '.om-field input:focus,.om-field select:focus,.om-field textarea:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-frow{display:flex;gap:7px;align-items:stretch;}',
            '.om-frow select{flex:1;}',
            '.om-imgarea{width:100%;height:160px;background:rgba(127,127,127,.06);',
            'border:2px dashed rgba(127,127,127,.25);border-radius:10px;',
            'display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;transition:border-color .18s;}',
            '.om-imgarea:hover,.om-imgarea.drag{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(127,127,127,.1);}',
            '.om-imgph{display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.4;font-size:.82em;pointer-events:none;}',
            '.om-imgph i{font-size:1.8em;}',
            '.om-imgarea img{width:100%;height:100%;object-fit:contain;}',
            '.om-img-actions{display:flex;gap:7px;margin-top:7px;}',
            '.om-edit-foot{display:flex;gap:9px;justify-content:flex-end;padding-top:14px;',
            'border-top:1px solid rgba(127,127,127,.1);margin-top:10px;}',
            /* 场景标签建议 */
            '.om-suggest-wrap{position:relative;width:100%;}',
            '.om-suggest-wrap input{width:100%;box-sizing:border-box;}',
            '.om-suggest-list{position:absolute;top:100%;left:0;right:0;',
            'background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(40,40,40,.98)));',
            'border:1px solid rgba(127,127,127,.22);border-radius:8px;margin-top:3px;',
            'z-index:200;max-height:160px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,.25);}',
            '.om-suggest-item{padding:8px 12px;font-size:.85em;cursor:pointer;transition:.12s;color:var(--SmartThemeBodyColor,inherit);}',
            '.om-suggest-item:hover{background:rgba(127,127,127,.15);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 分类管理 */
            '.om-cat-item{display:flex;align-items:center;gap:8px;padding:9px 12px;',
            'background:rgba(127,127,127,.06);border-radius:9px;',
            'border:1px solid rgba(127,127,127,.1);transition:all .15s;margin-bottom:7px;}',
            '.om-cat-item:hover{background:rgba(127,127,127,.11);}',
            '.om-cat-name{flex:1;font-size:.88em;}',
            '.om-cat-count{font-size:.74em;opacity:.45;}',
            '.om-cat-add-row{display:flex;gap:8px;}',
            '.om-cat-add-row input{flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);',
            'border-radius:8px;color:inherit;padding:8px 11px;font-size:.88em;font-family:inherit;box-sizing:border-box;}',
            '.om-cat-add-row input:focus{outline:none;border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            /* 预设 */
            '.om-preset-item{display:flex;align-items:center;gap:8px;padding:10px 14px;',
            'background:rgba(127,127,127,.06);border-radius:9px;border:1px solid rgba(127,127,127,.1);',
            'transition:all .15s;cursor:pointer;margin-bottom:7px;}',
            '.om-preset-item:hover{background:rgba(127,127,127,.12);border-color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-preset-name{flex:1;font-size:.9em;font-weight:600;}',
            '.om-preset-count{font-size:.74em;opacity:.5;white-space:nowrap;}',
            '.om-preset-item.current{border-color:var(--SmartThemeQuoteColor,#7c6daf);background:rgba(124,109,175,.08);}',
            /* 通用小按钮 */
            '.om-btn-sm{padding:5px 7px;border-radius:6px;cursor:pointer;font-size:.78em;',
            'background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.14);',
            'transition:all .15s;color:inherit;font-family:inherit;}',
            '.om-btn-sm:hover{background:rgba(127,127,127,.15);}',
            /* 导出/导入 modal */
            '.om-modal{position:absolute;inset:0;z-index:2;background:rgba(0,0,0,.45);pointer-events:auto;',
            'display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}',
            '.om-modal-box{background:var(--om-bg2,var(--SmartThemeBackgroundColor,rgba(30,30,30,1)));',
            'color:var(--om-text,var(--SmartThemeBodyColor,#eee));border-radius:16px;padding:22px 20px 26px;',
            'width:100%;max-width:400px;max-height:85vh;overflow-y:auto;',
            'display:flex;flex-direction:column;gap:10px;',
            'box-shadow:0 8px 32px rgba(0,0,0,.4);margin:auto;border:1px solid rgba(127,127,127,.15);}',
            '.om-modal-title{font-weight:700;font-size:1em;margin-bottom:4px;}',
            '.om-modal-btn{padding:10px 14px;border-radius:9px;border:1px solid rgba(127,127,127,.2);',
            'background:rgba(127,127,127,.07);color:inherit;cursor:pointer;font-size:.88em;text-align:left;',
            'font-family:inherit;transition:.15s;}',
            '.om-modal-btn:hover{background:rgba(127,127,127,.16);border-color:var(--SmartThemeQuoteColor,#7c6daf);color:var(--SmartThemeQuoteColor,#7c6daf);}',
            '.om-modal-cancel{padding:9px;border-radius:9px;border:none;background:none;',
            'color:inherit;cursor:pointer;font-size:.85em;opacity:.5;font-family:inherit;margin-top:4px;}',
            '.om-modal-cancel:hover{opacity:1;}',
            /* 全屏 lightbox */
            '.om-lightbox{position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.92);pointer-events:auto;',
            'display:flex;align-items:center;justify-content:center;animation:om-popin .18s ease;}',
            '.om-lb-img{max-width:92vw;max-height:88vh;object-fit:contain;border-radius:10px;',
            'box-shadow:0 8px 40px rgba(0,0,0,.6);user-select:none;}',
            '.om-lb-close{position:absolute;top:18px;right:20px;background:rgba(255,255,255,.12);',
            'border:none;color:#fff;font-size:1.3em;width:40px;height:40px;border-radius:50%;',
            'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.om-lb-close:hover{background:rgba(255,255,255,.25);}',
            '.om-lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);',
            'border:none;color:#fff;font-size:1.2em;width:42px;height:42px;border-radius:50%;',
            'cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2147483647;}',
            '.om-lb-nav:hover{background:rgba(255,255,255,.25);}',
            '.om-lb-prev{left:14px;} .om-lb-next{right:14px;}',
            '.om-lb-counter{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);',
            'color:rgba(255,255,255,.6);font-size:.82em;background:rgba(0,0,0,.4);',
            'padding:4px 14px;border-radius:20px;z-index:2147483647;}',
            '.om-lb-name{position:absolute;top:20px;left:50%;transform:translateX(-50%);',
            'color:#fff;font-size:.9em;font-weight:600;background:rgba(0,0,0,.4);',
            'padding:5px 16px;border-radius:20px;max-width:60vw;white-space:nowrap;',
            'overflow:hidden;text-overflow:ellipsis;z-index:2147483647;}',

            /* ══ 扩展设置面板入口 ══ */
            '.om-settings-entry{margin-bottom:2px;}',
        ].join('');
        document.head.appendChild(s);
    }

    // ── 弹窗状态 ──────────────────────────────────────────────
    var curCat = '__all__';
    var wbMode = false;
    
    function getWorldBookStyles() { var all = []; if (typeof worldBookStylesModern !== 'undefined') all = all.concat(worldBookStylesModern); if (typeof worldBookStylesLingerie !== 'undefined') all = all.concat(worldBookStylesLingerie); return all; }
    var worldBookStylesModern = [{"name":"纯欲风","style":"纯欲","season":"春夏","scene":"约会","desc":"纯欲风穿搭：清纯中带性感，甜美不失轻盈。浅色系为主（白、粉、薄荷、奶油黄、香槟），蕾丝、荷叶边、短裙、露肩/露腰设计。\n示例搭配：白色蕾丝泡泡袖短上衣，荷叶边领口微敞，搭配粉色高腰百褶短裙。配饰选珍珠发夹半扎发、细带玛丽珍鞋，手腕系一条浅粉丝带。整体清新甜美，露锁骨与小腿，若隐若现的纯欲感。"},{"name":"甜酷风","style":"甜酷","season":"春夏","scene":"外出","desc":"甜酷风穿搭：甜辣元气，又甜又酷，个性俏皮。黑粉撞色、红白、黑紫为主。露肩/露腰短上衣、蛋糕层叠短裙、阔腿牛仔长裤、金属链条、玩偶包包、厚底松糕鞋。\n示例搭配：黑色露腰短T恤（胸前印花爪印图案），搭配粉紫格纹百褶短裙。配饰银色金属腿环+黑色choker+黑白条纹堆堆袜+厚底马丁靴。单手拎一只毛绒玩偶斜挎包，又凶又可爱。"},{"name":"休闲风","style":"休闲","season":"全年","scene":"外出","desc":"休闲日常风：舒适、简约、随性，不刻意打扮但仍干净有质感。白、灰、米色、燕麦色、浅蓝、牛仔蓝为主。T恤、卫衣、牛仔裤、阔腿裤、运动鞋、帆布包。\n示例搭配：米白色宽松卫衣（微落肩），内搭白T领口露出，下穿浅蓝直筒破洞牛仔裤，挽起两折裤脚。白色帆布鞋+帆布托特包+棒球帽，耳机线从领口垂落。慵懒又干净的日常。"},{"name":"千禧Y2K","style":"千禧","season":"春夏","scene":"外出","desc":"千禧Y2K风：复古千禧辣妹甜心，随性叛逆甜酷张扬。高饱和粉、明黄、草绿、树莓粉、黑灰、复古做旧牛仔色。印花工字吊带、低腰牛仔短裙/热裤、豹纹毛绒、十字架银饰、绑带、格纹贝雷帽、厚底坡跟鞋。\n示例搭配：玫红色印花工字背心吊带（紧身短款），搭配低腰浅蓝做旧牛仔迷你裙，外披豹纹毛绒短外套。银色多层十字架项链+黑色宽腰封绑带+厚底松糕凉鞋。头发挑染粉色，美式复古辣妹。"},{"name":"日系软甜","style":"甜美","season":"春夏","scene":"约会","desc":"日系软甜风：温柔可爱清纯，像棉花糖一样软乎乎的少女感。粉白奶油色系为主，棉麻雪纺柔软材质，蓬蓬裙、娃娃领、荷叶边、蝴蝶结、蕾丝短袜。\n示例搭配：奶油白圆领灯笼袖衬衫（领口系一条细丝带蝴蝶结），搭配樱花粉高腰A字百褶短裙。白色蕾丝花边短袜+圆头玛丽珍粗跟鞋，手腕系粉色串珠手链。头发半扎成丸子头，留几缕碎发在耳边。"},{"name":"日系复古","style":"复古","season":"秋冬","scene":"外出","desc":"日系复古风：文艺怀旧、书卷气。深棕墨绿酒红驼色为主，格纹毛衣、灯芯绒长裙、毛呢贝雷帽、皮革剑桥包。\n示例搭配：驼色绞花高领毛衣（宽松落肩），内搭白色衬衫领子翻出，搭配深墨绿色格纹百褶长裙及小腿。棕色皮革细腰带收腰+棕色乐福鞋+同色皮革斜挎包+深棕贝雷帽。怀里抱一本旧书，像从图书馆走出来的文学少女。"},{"name":"办公室海妖","style":"通勤","season":"全年","scene":"办公","desc":"办公室海妖风：知性职场穿搭，优雅不失气场。黑白灰藏青为主，西装、真丝飘带衬衫、包臀裙、阔腿西裤、尖头细高跟。\n示例搭配：藏青色收腰一粒扣西装外套（垫肩利落），内搭白色真丝飘带领衬衫（飘带自然垂落），搭配黑色九分烟管西裤露出脚踝。黑色尖头细高跟+银色简约腕表+黑色皮革手提公文包。妆容精致淡雅，气场全开的职场女性。"},{"name":"通勤休闲","style":"通勤","season":"全年","scene":"办公","desc":"通勤休闲风：日常通勤简约舒适，不过分正式也不邋遢。针织开衫、直筒裤、乐福鞋为主，燕麦灰米白柔和色系。\n示例搭配：浅灰色针织V领开衫（轻薄款扣两粒扣子），内搭白色圆领T恤，下穿米色直筒西装裤九分长度+棕色乐福鞋。帆布托特包加一杯外带咖啡，轻松又不失体面的工作日穿搭。"},{"name":"洛丽塔","style":"甜美","season":"全年","scene":"约会","desc":"洛丽塔风：甜系Lolita，蓬蓬裙、蝴蝶结、蕾丝、荷叶边、珍珠元素。OP/JSK连衣裙+南瓜裤+KC发带/蝴蝶结头饰+圆头粗跟鞋+白色蕾丝花边袜。\n示例搭配：粉色草莓印花JSK高腰连衣裙（胸口蝴蝶结+多层蕾丝裙摆），内搭白色荷叶领衬衫+白色南瓜裤（裙撑蓬起）。搭配同色系KC蝴蝶结发带+白色圆头粗跟玛丽珍+白色蕾丝花边中筒袜。手提草莓造型小包，手腕系粉色丝带。"},{"name":"学院风","style":"学院","season":"全年","scene":"外出","desc":"学院风：元气校园感，preppy风格。百褶裙、针织背心、衬衫、V领毛衣、格纹元素，藏青酒红格纹为主。\n示例搭配：白色尖领衬衫外搭藏青色V领针织背心（领口露出衬衫领），搭配红黑格纹百褶短裙。黑色过膝长袜+黑色乐福鞋+深棕色皮革双肩包。头发扎成高马尾用格纹发圈，整个人元气满满。"},{"name":"韩系日常","style":"简约","season":"全年","scene":"外出","desc":"韩系日常风：简约休闲干净利落，基础款搭配出高级感。黑白灰米色系，西装外套、直筒牛仔裤、板鞋、帆布托特包。\n示例搭配：米白色短款针织开衫（刚好及腰），内搭黑色高领打底，下穿黑色高腰直筒西裤。白色厚底板鞋+黑色帆布托特包，手腕叠戴银色细手链。头发随意低马尾，干净清爽的韩系小姐姐。"},{"name":"韩系女团","style":"街头","season":"春夏","scene":"外出","desc":"韩系女团风：kpop爱豆打歌服既视感，舞台mix日常。短上衣、高腰工装裤/百褶裙、亮片、金属链条、厚底靴。\n示例搭配：黑色亮片短吊带（紧身露腰），搭配白色高腰束脚工装裤（腰间银色链条腰带垂落）。黑色厚底马丁靴+多层银链项链+银色大耳环。头发高马尾加挑染，眼妆闪亮，随时可以上台打歌。"},{"name":"现代哥特","style":"街头","season":"秋冬","scene":"外出","desc":"现代哥特风：暗黑甜酷。全黑或黑紫黑红为主，铆钉、蕾丝、皮革、鱼网袜、十字架、choker。\n示例搭配：黑色蕾丝拼接短上衣（半透蕾丝拼接+绑带鱼骨束腰设计），搭配黑色纱裙（多层不规则裙摆）。黑色过膝渔网袜+厚底铆钉短靴+多层十字架银链choker+黑色皮革腕带。黑色微卷长发披散，烟熏妆暗黑但不失甜美。"},{"name":"旗袍","style":"优雅","season":"春夏","scene":"约会","desc":"旗袍风：民国复古韵味。修身旗袍、开叉设计、真丝提花、盘扣立领、滚边工艺。\n示例搭配：墨绿色暗纹提花短款旗袍（及膝长度），侧边低开叉+盘扣立领+黑色丝绒滚边。珍珠耳坠+黑色细跟尖头鞋+墨绿色缎面手拿包。头发盘成低发髻插一根玉簪，优雅古典的东方美人。"},{"name":"新中式","style":"优雅","season":"全年","scene":"外出","desc":"新中式风：国风改良，传统元素与现代剪裁融合。盘扣、立领、刺绣、交领、阔腿裤。\n示例搭配：黑色改良旗袍领短上衣（立领盘扣+微微泡泡袖），搭配白色高腰阔腿裤。腰间一条黑色刺绣宽腰封收腰，黑色尖头猫跟鞋。银色流苏耳坠+黑色缎面链条包。现代与古典的碰撞，时髦又有韵味。"},{"name":"御姐辣妹","style":"街头","season":"春夏","scene":"约会","desc":"御姐辣妹风：成熟性感气场全开。紧身短裙、深V露背、高跟鞋、金属配饰，黑红为主。\n示例搭配：黑色深V交叉绑带短上衣（露背设计），搭配红色包臀皮裙（侧边小开衩）。黑色尖头细高跟（12cm）+金色大耳环+多层金属手镯+黑色链条包。长发微卷披肩，红唇妆容，走路带风。"},{"name":"财阀千金","style":"优雅","season":"全年","scene":"约会","desc":"财阀千金风：高级优雅名媛感。粗花呢套装、珍珠配饰、小香风元素、链条包、尖头高跟鞋。\n示例搭配：奶白色粗花呢短外套（圆领无领设计+珍珠纽扣），内搭白色真丝吊带，下穿同色粗花呢A字短裙。珍珠项链+珍珠耳钉+白色菱格纹链条包+米色尖头细高跟。手腕戴银色细链表，头发微卷披肩，优雅贵气。"},{"name":"小香风","style":"优雅","season":"秋冬","scene":"外出","desc":"小香风：温柔富家千金感。粗花呢外套、珍珠钻石配饰、丝质衬衫、阔腿裤，粉白米金柔和色系。\n示例搭配：淡粉色粗花呢圆领短外套（编织金线+珍珠纽扣），内搭白色丝质飘带衬衫，搭配米色阔腿西裤。珍珠耳钉+珍珠短项链+裸色尖头高跟鞋+米色链条包。整体色调温柔高级，名媛下午茶穿搭。"},{"name":"欧美风","style":"街头","season":"全年","scene":"外出","desc":"欧美风：简约大气廓形剪裁，effortless chic。白T/背心、直筒/阔腿牛仔裤、oversized西装外套、运动鞋，卡其黑白灰为主。\n示例搭配：白色纯棉圆领短T（微宽松塞进裤腰），搭配浅蓝色直筒破洞牛仔裤+黑色皮带。外披卡其色oversized西装外套，白色厚底运动鞋+黑色墨镜。金色hoop耳环+黑色腋下包，简约不简单的街拍感。"},{"name":"轻亚风","style":"街头","season":"全年","scene":"外出","desc":"轻亚风：亚文化轻量版，暗黑但不夸张，日常可穿。暗色系为主，银饰、十字架、链条、choker、网纱、撕裂元素+日常单品混搭。\n示例搭配：黑色不规则撕裂感短T恤，搭配灰色束脚工装阔腿裤。多层银链短项链+黑色皮革choker+银色十字架耳坠+黑色马丁靴。手腕叠戴铆钉皮革手环，暗黑但不中二，日常出街刚好。"}];;
    var worldBookStylesLingerie = [{"name":"基础纯棉","style":"舒适","season":"全年","scene":"家居","desc":"基础纯棉内衣：日常舒适亲肤透气，纯棉材质为主。白色/浅灰/肤色纯棉三角杯文胸（无钢圈、薄棉垫可拆卸、肩带固定长度），搭配同色纯棉中腰三角裤（弹力螺纹腰头、无印花无蕾丝）。柔软贴合身体曲线，适合居家、睡眠、日常休闲穿着。简约实穿不做作。"},{"name":"蕾丝花边","style":"甜美","season":"全年","scene":"睡前","desc":"蕾丝花边内衣：清新甜美。浅粉/奶白/淡紫色蕾丝薄款三角杯文胸（无钢圈、花卉纹样蕾丝、细肩带），搭配同色蕾丝低腰三角裤（蕾丝花边腰头+轻薄内衬）。蕾丝若隐若现的清透感，少女气息满满，适合约会前的小心机或睡前仪式感。"},{"name":"丝绸缎面","style":"优雅","season":"春夏","scene":"睡前","desc":"丝绸缎面内衣：光泽柔滑奢华质感。香槟金/酒红/墨绿色真丝吊带式文胸（细吊带V领设计+缎面光泽），搭配同色真丝低腰三角裤（柔滑缎面+细带侧腰）。贴肤丝滑冰凉，慵懒性感，适合夏日夜晚或特殊场合，自带高级感体香。"},{"name":"运动款","style":"运动","season":"全年","scene":"运动","desc":"运动内衣：工字背/宽肩带设计，透气速干弹力面料。黑色/深灰/藏青色运动背心式文胸（中高强度支撑+可拆卸胸垫+透气网眼拼接），搭配同色无缝平角运动内裤（四面弹力+吸湿排汗）。运动时不晃动不摩擦，瑜伽跑步健身都合适。"},{"name":"法式三角","style":"优雅","season":"全年","scene":"约会","desc":"法式三角杯内衣：简约精致不刻意。黑色/肤色/酒红色细带三角杯文胸（无钢圈轻薄款+可调节细肩带+后背交叉设计），搭配同色细带低腰三角裤（极简剪裁+细带侧腰）。法式慵懒性感，不追求聚拢，原生态的美感，适合约会或需要无痕内搭时穿着。"}];;
    
    var curType = '__all__';
    var batchMode = false;
    var batchSelected = [];
    var searchQuery = '';
    var searchOpen = false;
    var detailPanelOpen = false;

    // ── 打开全屏主界面 ────────────────────────────────────────
    var omOffsetX = 0, omOffsetY = 0, omScale = 1;
    var omDragState = null;

    function applyOmViewport() {
        var ov = document.querySelector('.om-overlay');
        if (ov) {
            ov.style.setProperty('--om-offset-x', omOffsetX + 'px');
            ov.style.setProperty('--om-offset-y', omOffsetY + 'px');
            ov.style.setProperty('--om-scale', String(omScale));
        }
        var lbl = document.getElementById('om-zoom-label');
        if (lbl) lbl.textContent = Math.round(omScale * 100) + '%';
    }

    function resetOmViewport() {
        omOffsetX = 0; omOffsetY = 0; omScale = 1;
        try { localStorage.setItem('om-viewport', JSON.stringify({x:0,y:0,s:1})); } catch(e){}
        applyOmViewport();
    }

    function loadOmViewport() {
        try {
            var v = JSON.parse(localStorage.getItem('om-viewport'));
            if (v) { omOffsetX = v.x || 0; omOffsetY = v.y || 0; omScale = v.s || 1; }
        } catch(e){}
    }

    function saveOmViewport() {
        try { localStorage.setItem('om-viewport', JSON.stringify({x:omOffsetX,y:omOffsetY,s:omScale})); } catch(e){}
    }

    function openPopup() {
        if (document.querySelector('.om-overlay')) return;
        loadOmViewport();

        // 遮罩背景层
        var backdrop = document.createElement('div');
        backdrop.className = 'om-backdrop';
        backdrop.addEventListener('click', closePopup);
        document.body.appendChild(backdrop);

        injectStyles();
        batchMode = false; batchSelected = []; searchQuery = ''; searchOpen = false; detailPanelOpen = false;

        var ov = document.createElement('div');
        ov.className = 'om-overlay ' + (darkMode ? 'om-dark' : 'om-light');
        ov.setAttribute('style', 'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;z-index:2147483647 !important;');

        ov.innerHTML =
            '<div class="om-box">' +
            // 顶栏
            '<div class="om-head">' +
            '<div class="om-head-title"><i class="fa-solid fa-shirt"></i>' + SCRIPT_NAME + '</div>' +
            '<div class="om-head-actions">' +
            '<div class="om-viewport">' +
            '<button class="om-viewport-btn" id="om-zoom-out" title="缩小"><i class="fa-solid fa-magnifying-glass-minus"></i></button>' +
            '<span class="om-viewport-label" id="om-zoom-label">' + Math.round(omScale * 100) + '%</span>' +
            '<button class="om-viewport-btn" id="om-zoom-reset" title="复位"><i class="fa-solid fa-arrows-to-dot"></i></button>' +
            '<button class="om-viewport-btn" id="om-zoom-in" title="放大"><i class="fa-solid fa-magnifying-glass-plus"></i></button>' +
            '</div>' +
            '<button class="om-icon-btn" id="om-search-toggle" title="搜索"><i class="fa-solid fa-magnifying-glass"></i></button>' +
            '<button class="om-theme-btn" id="om-theme-toggle"><i class="fa-solid fa-circle-half-stroke"></i></button>' +
            '<button class="om-icon-btn" id="om-x" title="关闭"><i class="fa-solid fa-xmark"></i></button>' +
            '</div></div>' +
            // 搜索栏（默认隐藏）
            '<div class="om-search-bar" id="om-search-bar">' +
            '<div class="om-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>' +
            '<input class="om-search-inp" id="om-search-inp" type="text" placeholder="搜索名称或标签…" autocomplete="off" /></div>' +
            '<button class="om-search-clear" id="om-search-clear" title="关闭搜索"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
            // 视角切换栏（User / Char）
            '<div class="om-viewbar" id="om-viewbar"></div>' +
            // 分类栏
            '<div class="om-catbar" id="om-catbar"></div>' +
            // 网格区
            '<div class="om-grid-area" id="om-grid-area"></div>' +
            // 底栏
            '<div class="om-bottombar" id="om-bottombar" style="position:relative;">' +
            '<div class="om-bottom-status" id="om-bottom-status"></div>' +
            '<div class="om-quick-scenes" id="om-quick-scenes"></div>' +
            '<button class="om-batch-toggle-btn" id="om-batch-toggle">多选</button>' +
            '<button class="om-bottom-btn" id="om-bottom-presets" title="预设"><i class="fa-solid fa-bookmark"></i></button>' +
            '<button class="om-bottom-btn" id="om-bottom-roll" title="随机搭配"><i class="fa-solid fa-dice"></i></button>' +
            '<button class="om-bottom-btn" id="om-bottom-settings" title="设置"><i class="fa-solid fa-sliders"></i></button>' +
            '</div>' +
            '</div>' +
            '<div id="om-popup-slot" style="position:absolute;inset:0;z-index:999;pointer-events:none;"></div>';

        document.body.appendChild(ov);

        // 绑定顶栏
        ov.querySelector('#om-x').addEventListener('click', closePopup);
        ov.querySelector('#om-zoom-out').addEventListener('click', function () { omScale = Math.max(0.5, omScale - 0.1); saveOmViewport(); applyOmViewport(); });
        ov.querySelector('#om-zoom-in').addEventListener('click', function () { omScale = Math.min(1.5, omScale + 0.1); saveOmViewport(); applyOmViewport(); });
        ov.querySelector('#om-zoom-reset').addEventListener('click', function () { resetOmViewport(); });
        // 拖拽面板
        var head = ov.querySelector('.om-head');
        function onHeadPointerDown(e) {
            if (e.target.closest('button, input, select, a, label, .om-viewport')) return;
            omDragState = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startOX: omOffsetX, startOY: omOffsetY };
            ov.classList.add('om-dragging');
            e.preventDefault();
            head.setPointerCapture(e.pointerId);
        }
        function onHeadPointerMove(e) {
            if (!omDragState || e.pointerId !== omDragState.pointerId) return;
            omOffsetX = omDragState.startOX + e.clientX - omDragState.startX;
            omOffsetY = omDragState.startOY + e.clientY - omDragState.startY;
            applyOmViewport();
        }
        function onHeadPointerUp(e) {
            if (!omDragState || e.pointerId !== omDragState.pointerId) return;
            omOffsetX = Math.round(omOffsetX); omOffsetY = Math.round(omOffsetY);
            ov.classList.remove('om-dragging');
            omDragState = null;
            saveOmViewport();
            applyOmViewport();
        }
        head.addEventListener('pointerdown', onHeadPointerDown);
        head.addEventListener('pointermove', onHeadPointerMove);
        head.addEventListener('pointerup', onHeadPointerUp);
        head.addEventListener('pointercancel', onHeadPointerUp);
        ov.querySelector('#om-theme-toggle').addEventListener('click', function () {
            darkMode = !darkMode;
            var overlay = document.querySelector('.om-overlay');
            if (overlay) {
                overlay.classList.toggle('om-dark', darkMode);
                overlay.classList.toggle('om-light', !darkMode);
            }
            var btn = ov.querySelector('#om-theme-toggle');
            if (btn) btn.innerHTML = darkMode
                ? '<i class="fa-solid fa-circle-half-stroke"></i>'
                : '<i class="fa-regular fa-sun"></i>';
        });
        ov.querySelector('#om-search-toggle').addEventListener('click', function () {
            searchOpen = !searchOpen;
            var bar = document.getElementById('om-search-bar');
            bar.classList.toggle('open', searchOpen);
            if (searchOpen) { setTimeout(function () { var i = document.getElementById('om-search-inp'); if (i) i.focus(); }, 50); }
            else { searchQuery = ''; renderGrid(); }
        });
        ov.querySelector('#om-search-clear').addEventListener('click', function () {
            searchOpen = false;
            searchQuery = '';
            var bar = document.getElementById('om-search-bar');
            bar.classList.remove('open');
            renderGrid();
        });
        var sinp = ov.querySelector('#om-search-inp');
        sinp.addEventListener('input', function () { searchQuery = sinp.value; renderGrid(); });
        sinp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { searchOpen = false; searchQuery = ''; ov.querySelector('#om-search-bar').classList.remove('open'); renderGrid(); } });

        // 绑定底栏
        ov.querySelector('#om-bottom-status').addEventListener('click', function () { toggleDetailPanel(); });
        ov.querySelector('#om-batch-toggle').addEventListener('click', function () {
            batchMode = !batchMode; batchSelected = [];
            ov.querySelector('#om-batch-toggle').classList.toggle('on', batchMode);
            renderGrid();
        });
        ov.querySelector('#om-bottom-presets').addEventListener('click', function () { openPresetsSheet(); });
        ov.querySelector('#om-bottom-settings').addEventListener('click', function () { openSettingsSheet(); });
        ov.querySelector('#om-bottom-roll').addEventListener('click', function () { openRandomRoll(); });

        renderViewbar();
        renderCatbar();
        renderGrid();
        renderBottomStatus();
        closeFab();
    }

    function closePopup() {
        var ov = document.querySelector('.om-overlay'); if (ov) ov.parentNode.removeChild(ov);
        var bd = document.querySelector('.om-backdrop'); if (bd) bd.parentNode.removeChild(bd);
    }


    var charPanelExpanded = false;
    var collapsedGroups = {};

    function renderViewbar() {
        var vbar = document.getElementById('om-viewbar'); if (!vbar) return;
        var d = load();
        var isUser = d.currentView !== 'char';
        vbar.style.position = 'relative';

        var html = '<button class="om-viewtab' + (isUser ? ' on' : '') + '" data-v="user"><i class="fa-solid fa-user" style="margin-right:4px"></i>User</button>' +
            '<button class="om-viewtab' + (!isUser ? ' on' : '') + '" data-v="char"><i class="fa-solid fa-masks-theater" style="margin-right:4px"></i>角色</button>' +
            '<button class="om-viewtab" id="om-wb-toggle" title="混合世界书风格"><i class="fa-solid fa-book" style="margin-right:4px"></i>世界书</button>';

        if (!isUser) {
            html += '<input type="text" class="om-char-input" id="om-char-input" placeholder="' + (d.currentChar ? esc(d.currentChar) : '搜索角色…') + '" autocomplete="off" />' +
                '<button class="om-char-add-btn" id="om-char-add" title="添加角色">+</button>';
        }

        vbar.innerHTML = html;

        vbar.querySelectorAll('.om-viewtab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var dd = load();
                dd.currentView = tab.dataset.v;
                save(dd);
                charPanelExpanded = false;
                renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
            });
        });

        var wbBtn = vbar.querySelector('#om-wb-toggle'); if (wbBtn) { wbBtn.classList.toggle('on', wbMode); wbBtn.addEventListener('click', function() { wbMode = !wbMode; vbar.querySelector('#om-wb-toggle').classList.toggle('on', wbMode); renderGrid(); }); }

        if (!isUser) {
            var inp = vbar.querySelector('#om-char-input');
            inp.addEventListener('focus', function () {
                charPanelExpanded = true;
                renderCharDropdown(vbar, load(), '');
            });
            inp.addEventListener('input', function () {
                charPanelExpanded = true;
                renderCharDropdown(vbar, load(), this.value.trim().toLowerCase());
            });
            vbar.querySelector('#om-char-add').addEventListener('click', function () { addCharPrompt(); });
            if (charPanelExpanded) renderCharDropdown(vbar, d, '');
        }
    }

    function renderCharDropdown(vbar, d, query) {
        var old = vbar.querySelector('.om-char-dropdown');
        if (old) old.parentNode.removeChild(old);

        var favs = d.charFavorites || [];
        var groups = d.charGroups || {};
        var allNames = d.charNames || [];
        var matchedGroupKeys = {};
        if (query) { for (var gg in groups) { if (gg.toLowerCase().indexOf(query) !== -1) matchedGroupKeys[gg] = true; } }

        function visible(cn) {
            if (!query) return true;
            if (cn.toLowerCase().indexOf(query) !== -1) return true;
            for (var gg2 in matchedGroupKeys) { if ((groups[gg2] || []).indexOf(cn) !== -1) return true; }
            return false;
        }

        var inGroup = {};
        for (var gn in groups) { (groups[gn] || []).forEach(function (n) { inGroup[n] = true; }); }

        function makeRow(cn) {
            if (!visible(cn)) return '';
            var isFav = favs.indexOf(cn) !== -1;
            var isActive = d.currentChar === cn;
            var cd = d.chars && d.chars[cn] ? d.chars[cn] : { outfits: [] };
            var count = (cd.outfits || []).length;
            return '<div class="om-char-row' + (isActive ? ' active' : '') + '" data-cn="' + esc(cn) + '">' +
                '<i class="fa-' + (isFav ? 'solid' : 'regular') + ' fa-star om-char-star' + (isFav ? ' on' : '') + '" data-cn="' + esc(cn) + '"></i>' +
                '<span class="om-char-rname">' + esc(cn) + '</span>' +
                '<span class="om-char-count">' + count + '套</span>' +
                '<div class="om-char-actions">' +
                '<button class="om-char-act om-char-rename" data-cn="' + esc(cn) + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="om-char-act om-char-move-group" data-cn="' + esc(cn) + '" title="分组"><i class="fa-solid fa-folder"></i></button>' +
                '<button class="om-char-act om-char-delete" data-cn="' + esc(cn) + '" title="删除" style="color:#e57373"><i class="fa-solid fa-trash"></i></button>' +
                '</div></div>';
        }

        function makeSection(title, iconClass, names, gkey) {
            var visNames = names.filter(visible);
            if (visNames.length === 0) return '';
            var isCollapsed = collapsedGroups[gkey];
            var html = '<div class="om-char-group-hdr" data-gkey="' + esc(gkey) + '">' +
                '<i class="fa-solid fa-chevron-down om-g-arrow' + (isCollapsed ? ' collapsed' : '') + '"></i>' +
                '<i class="' + iconClass + ' om-g-icon"></i> ' + esc(title) +
                ' <span style="opacity:.4">(' + visNames.length + ')</span></div>';
            if (!isCollapsed) { visNames.forEach(function (cn) { html += makeRow(cn); }); }
            return html;
        }

        var listHtml = '';
        var favNames = allNames.filter(function (n) { return favs.indexOf(n) !== -1; });
        listHtml += makeSection('收藏', 'fa-solid fa-star', favNames, '__fav__');
        for (var gn2 in groups) {
            var gNames = (groups[gn2] || []).filter(function (n) { return allNames.indexOf(n) !== -1; });
            listHtml += makeSection(gn2, 'fa-solid fa-folder', gNames, 'g_' + gn2);
        }
        var ungrouped = allNames.filter(function (n) { return !inGroup[n] && favs.indexOf(n) === -1; });
        if (ungrouped.length > 0) {
            var ugLabel = (favNames.length > 0 || Object.keys(groups).length > 0) ? '未分组' : '全部角色';
            listHtml += makeSection(ugLabel, 'fa-regular fa-folder-open', ungrouped, '__ungrouped__');
        }
        if (allNames.length === 0) listHtml = '<div class="om-char-empty">还没有角色，点 + 添加</div>';

        var dropdown = document.createElement('div');
        dropdown.className = 'om-char-dropdown';
        dropdown.innerHTML = listHtml;
        vbar.appendChild(dropdown);

        // 分组折叠
        dropdown.querySelectorAll('.om-char-group-hdr').forEach(function (hdr) {
            hdr.addEventListener('click', function () {
                collapsedGroups[hdr.dataset.gkey] = !collapsedGroups[hdr.dataset.gkey];
                renderCharDropdown(vbar, load(), query);
            });
        });
        // 选中角色
        dropdown.querySelectorAll('.om-char-row').forEach(function (row) {
            row.addEventListener('click', function (e) {
                if (e.target.closest('.om-char-star') || e.target.closest('.om-char-actions')) return;
                var dd = load(); dd.currentChar = row.dataset.cn; save(dd);
                charPanelExpanded = false;
                renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
            });
        });
        // 收藏
        dropdown.querySelectorAll('.om-char-star').forEach(function (star) {
            star.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); if (!dd.charFavorites) dd.charFavorites = [];
                var cn = star.dataset.cn; var idx = dd.charFavorites.indexOf(cn);
                if (idx !== -1) dd.charFavorites.splice(idx, 1); else dd.charFavorites.push(cn);
                save(dd); renderCharDropdown(vbar, load(), query);
            });
        });
        // 重命名
        dropdown.querySelectorAll('.om-char-rename').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn;
                var nw = prompt('重命名角色「' + cn + '」：', cn);
                if (!nw || !nw.trim() || nw.trim() === cn) return; nw = nw.trim();
                var dd = load();
                if (dd.charNames.indexOf(nw) !== -1) { toast('角色「' + nw + '」已存在', true); return; }
                var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames[idx] = nw;
                if (dd.chars && dd.chars[cn]) { dd.chars[nw] = dd.chars[cn]; delete dd.chars[cn]; }
                if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites[fi] = nw; }
                if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g][gi] = nw; } }
                if (dd.currentChar === cn) dd.currentChar = nw;
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); toast('已重命名为「' + nw + '」');
            });
        });
        // 分组移动
        dropdown.querySelectorAll('.om-char-move-group').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn; var dd = load();
                if (!dd.charGroups) dd.charGroups = {};
                var gNamesList = Object.keys(dd.charGroups);
                if (gNamesList.length === 0) {
                    var gname = prompt('还没有分组，输入新分组名称：');
                    if (!gname || !gname.trim()) return;
                    dd.charGroups[gname.trim()] = [cn]; save(dd); renderCharDropdown(vbar, load(), query);
                    toast('已创建分组并移入'); return;
                }
                var currentGroup = '';
                for (var g in dd.charGroups) { if ((dd.charGroups[g] || []).indexOf(cn) !== -1) { currentGroup = g; break; } }
                var msg = '将「' + cn + '」移到：\n0. 不分组' + (currentGroup ? '（当前：' + currentGroup + '）' : '') + '\n';
                gNamesList.forEach(function (g, i) { msg += (i + 1) + '. ' + g + '\n'; });
                msg += (gNamesList.length + 1) + '. 新建分组';
                var choice = prompt(msg); if (choice === null) return;
                var ci = parseInt(choice);
                for (var g2 in dd.charGroups) { var ri = dd.charGroups[g2].indexOf(cn); if (ri !== -1) dd.charGroups[g2].splice(ri, 1); }
                if (ci > 0 && ci <= gNamesList.length) { dd.charGroups[gNamesList[ci - 1]].push(cn); toast('已移入「' + gNamesList[ci - 1] + '」'); }
                else if (ci === gNamesList.length + 1) { var ng = prompt('新分组名称：'); if (ng && ng.trim()) { dd.charGroups[ng.trim()] = [cn]; toast('已创建分组并移入'); } }
                else { toast('已移出分组'); }
                save(dd); renderCharDropdown(vbar, load(), query);
            });
        });
        // 删除
        dropdown.querySelectorAll('.om-char-delete').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation(); var cn = btn.dataset.cn;
                if (!confirm('删除角色「' + cn + '」及其所有穿搭？')) return;
                var dd = load();
                if (dd.chars) delete dd.chars[cn];
                var idx = dd.charNames.indexOf(cn); if (idx !== -1) dd.charNames.splice(idx, 1);
                if (dd.charFavorites) { var fi = dd.charFavorites.indexOf(cn); if (fi !== -1) dd.charFavorites.splice(fi, 1); }
                if (dd.charGroups) { for (var g in dd.charGroups) { var gi = dd.charGroups[g].indexOf(cn); if (gi !== -1) dd.charGroups[g].splice(gi, 1); } }
                if (dd.currentChar === cn) dd.currentChar = '';
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); toast('已删除角色「' + cn + '」');
            });
        });
        // 点击外部关闭
        function closeOnOutside(e) {
            if (!vbar.contains(e.target)) {
                charPanelExpanded = false;
                var dd2 = vbar.querySelector('.om-char-dropdown');
                if (dd2) dd2.parentNode.removeChild(dd2);
                document.removeEventListener('click', closeOnOutside, true);
            }
        }
        setTimeout(function () { document.addEventListener('click', closeOnOutside, true); }, 50);
    }

    function addCharPrompt() {
        var name = prompt('输入角色名：');
        if (!name || !name.trim()) return; name = name.trim();
        var dd = load();
        if (!dd.charNames) dd.charNames = [];
        if (dd.charNames.indexOf(name) !== -1) { toast('角色「' + name + '」已存在', true); return; }
        dd.charNames.push(name); dd.currentChar = name; save(dd);
        charPanelExpanded = false;
        renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
        toast('✅ 已添加角色「' + name + '」');
    }

    function renderCharPanel() { /* 兼容 */ }

    // ── 分类栏渲染 ────────────────────────────────────────────
    function renderCatbar() {
        var catbar = document.getElementById('om-catbar'); if (!catbar) return;
        var d = load(); var cats = getViewCategories(d); var allOutfits = getViewOutfits(d);
        var outfitCats = {}; var itemCats = {};
        allOutfits.forEach(function (o) { var c = o.category || ''; if (!o.type || o.type === 'outfit') { if (c) outfitCats[c] = true; } else { if (c) itemCats[c] = true; } });
        if (cats.length === 0) { catbar.style.display = 'none'; return; }
        catbar.style.display = '';
        var html = '<button class="om-catbtn om-typebtn"' + (curType === '__all__' ? ' on' : '') + ' data-t="__all__">全部</button>';
        html += '<button class="om-catbtn om-typebtn"' + (curType === 'outfit' ? ' on' : '') + ' data-t="outfit"><i class="fa-solid fa-shirt"></i> 套装</button>';
        html += '<button class="om-catbtn om-typebtn"' + (curType === 'item' ? ' on' : '') + ' data-t="item"><i class="fa-solid fa-box"></i> 单品</button>';
        html += '<span style="width:1px;height:20px;background:rgba(127,127,127,.2);flex-shrink:0;margin:0 2px;align-self:center"></span>';
        cats.forEach(function (c) {
            var show = true;
            if (curType === 'outfit' && !outfitCats[c]) show = false;
            if (curType === 'item' && !itemCats[c]) show = false;
            if (show) html += '<button class="om-catbtn"' + (curCat === c ? ' on' : '') + ' data-c="' + esc(c) + '">' + esc(c) + '</button>';
        });
        catbar.innerHTML = html;
        catbar.querySelectorAll('.om-typebtn').forEach(function (btn) { btn.addEventListener('click', function () { curType = btn.dataset.t; curCat = '__all__'; renderCatbar(); renderGrid(); }); });
        catbar.querySelectorAll('.om-catbtn:not(.om-typebtn)').forEach(function (btn) { btn.addEventListener('click', function () { curCat = btn.dataset.c; renderCatbar(); renderGrid(); }); });
        if (!catbar._wheelBound) {
            catbar.addEventListener('wheel', function (e) { if (Math.abs(e.deltaY) > 0) { e.preventDefault(); catbar.scrollLeft += e.deltaY; } }, { passive: false });
            var _drag = { down: false, startX: 0, scrollL: 0 };
            catbar.addEventListener('mousedown', function (e) { _drag.down = true; _drag.startX = e.pageX; _drag.scrollL = catbar.scrollLeft; catbar.style.cursor = 'grabbing'; catbar.style.userSelect = 'none'; });
            document.addEventListener('mousemove', function (e) { if (!_drag.down) return; catbar.scrollLeft = _drag.scrollL - (e.pageX - _drag.startX); });
            document.addEventListener('mouseup', function () { if (_drag.down) { _drag.down = false; catbar.style.cursor = ''; catbar.style.userSelect = ''; } });
            catbar._wheelBound = true;
        }
    }

    // ── 网格区渲染 ────────────────────────────────────────────
    function renderGrid() {
        var area = document.getElementById('om-grid-area'); if (!area) return;
        var d = load();

        // 如果是角色视角但没选角色，显示提示
        if (d.currentView === 'char' && !d.currentChar) {
            area.innerHTML = '<div class="om-empty"><i class="fa-solid fa-masks-theater"></i><span>请先选择或添加一个角色</span></div>';
            return;
        }

        // 当前视角的穿搭
        var allOutfits = getViewOutfits(d);

        // 按分类过滤
        var list = curCat === '__all__' ? allOutfits : allOutfits.filter(function (o) { return o.category === curCat; });
        if (curType !== '__all__') list = list.filter(function (o) { return curType === 'outfit' ? (!o.type || o.type === 'outfit') : o.type === 'item'; });
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            list = list.filter(function (o) {
                return (o.name && o.name.toLowerCase().indexOf(q) !== -1) ||
                    (o.category && o.category.toLowerCase().indexOf(q) !== -1) ||
                    (o.sceneTag && o.sceneTag.toLowerCase().indexOf(q) !== -1) ||
                    (o.description && o.description.toLowerCase().indexOf(q) !== -1);
            });
        }
        var imgOutfits = list.filter(function (o) { return !!o.imageData; });

        var html = '';

        // 批量操作栏
        if (batchMode) {
            html += '<div class="om-batch-bar">' +
                '<span class="om-batch-info">已选&nbsp;<b id="om-batch-count">' + batchSelected.length + '</b>&nbsp;套</span>' +
                '<div class="om-batch-divider" style="width:1px;height:16px;background:rgba(127,127,127,.25);flex-shrink:0;margin:0 2px;"></div>' +
                '<div class="om-batch-acts">' +
                '<button class="om-batch-btn" id="om-batch-selall">全选</button>' +
                '<button class="om-batch-btn" id="om-batch-none">取消</button>' +
                '<button class="om-batch-btn" id="om-batch-cat"><i class="fa-solid fa-folder"></i> 分类</button>' +
                '<button class="om-batch-btn" id="om-batch-tag"><i class="fa-solid fa-tag"></i> 标签</button>' +
                '<button class="om-batch-btn" id="om-batch-paste"><i class="fa-solid fa-paste"></i> 批量粘贴</button>' +
                '<button class="om-batch-btn danger" id="om-batch-del"><i class="fa-solid fa-trash"></i> 删除</button>' +
                '</div></div>';
        }

        html += '<div class="om-grid">';

        // 添加卡（仅非批量模式）
        if (!batchMode) {
            html += '<div class="om-add-card" id="om-addcard"><i class="fa-solid fa-plus"></i><span>添加穿搭</span></div>';
            html += '<div class="om-batch-add-card" id="om-batchaddcard"><i class="fa-solid fa-images"></i><span>批量添加</span></div>';
        }

        
        // 世界书模式：混入虚拟穿搭
        if (wbMode && curCat !== '__all__') {
            // Only mix in when viewing a specific category, not ''all''
            var wbMatching = getWorldBookStyles().filter(function(ws) {
                return ws.scene === curCat || ws.style === curCat;
            });
            wbMatching.forEach(function(ws, wi) {
                list.push({ id: 'wb_grid_' + wi, name: ws.name, category: curCat, type: 'outfit', style: ws.style, season: ws.season, sceneTag: ws.scene, description: ws.desc, imageData: null, isVirtual: true });
            });
        }
        if (list.length === 0) {
            html += '</div><div class="om-empty"><i class="fa-solid fa-shirt"></i><span>' +
                (searchQuery ? '没有匹配「' + esc(searchQuery) + '」的穿搭' : (curCat !== '__all__' ? '该分类暂无穿搭' : '还没有穿搭，点击左上角添加')) +
                '</span></div>';
        } else {
            list.forEach(function (o) {
                var on = isActive(d, o.id);
                var bsel = batchSelected.indexOf(o.id) !== -1;
                var checkBox = batchMode ? '<div class="om-card-check' + (bsel ? ' checked' : '') + '" data-id="' + o.id + '"><i class="fa-solid fa-check"></i></div>' : '';
                var badge = (on && !batchMode) ? '<div class="om-badge-on"><i class="fa-solid fa-check"></i></div>' : '';

                var imgContent = '';
                if (o.imageData) {
                    imgContent = '<img src="' + o.imageData + '" alt="' + esc(o.name) + '" />';
                } else {
                    var descPreview = (o.description && o.description.trim()) ? o.description.trim() : '';
                    imgContent = '<div class="om-card-noimg">' +
                        '<div class="om-noimg-name">' + esc(o.name) + '</div>' +
                        (descPreview ? '<div class="om-noimg-desc">' + esc(descPreview) + '</div>' : '') +
                        '<i class="fa-regular fa-file-lines om-noimg-icon"></i>' +
                        '</div>';
                }

                var menuBtn = batchMode ? '' : '<button class="om-card-menu" data-id="' + o.id + '" title="操作"><i class="fa-solid fa-ellipsis-vertical"></i></button>';
                var tagText = (o.sceneTag && o.sceneTag.trim()) ? o.sceneTag.trim() : '';
                html += '<div class="om-card' + (on ? ' on' : '') + (bsel ? ' batch-sel' : '') + (o.imageData ? '' : ' no-img') + '" data-id="' + o.id + '">' +
                    '<div class="om-card-img">' +
                    checkBox + imgContent + badge + menuBtn +
                    '</div>' +
                    '<div class="om-card-info">' +
                    '<div class="om-card-name">' + esc(o.name) + '</div>' +
                    (tagText ? '<div class="om-card-tag">' + esc(tagText) + '</div>' : '') +
                    '</div>' +
                    '</div>';
            });
            html += '</div>';
        }

        area.innerHTML = html;

        // 添加卡点击
        var ac = area.querySelector('#om-addcard');
        if (ac) ac.addEventListener('click', function () { openEditSheet(null, curCat !== '__all__' ? curCat : ''); });
        var bac = area.querySelector('#om-batchaddcard');
        if (bac) bac.addEventListener('click', function () { openBatchAddSheet(curCat !== '__all__' ? curCat : ''); });

        // 批量操作
        if (batchMode) {
            var selall = area.querySelector('#om-batch-selall');
            var selnone = area.querySelector('#om-batch-none');
            var btagBtn = area.querySelector('#om-batch-tag');
            var bdelBtn = area.querySelector('#om-batch-del');

            if (selall) selall.addEventListener('click', function () { batchSelected = list.map(function (o) { return o.id; }); renderGrid(); });
            if (selnone) selnone.addEventListener('click', function () { batchSelected = []; renderGrid(); });
            var bcatBtn = area.querySelector('#om-batch-cat');
            if (bcatBtn) bcatBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var dd = load();
                var cats = getViewCategories(dd);
                if (cats.length === 0) { toast('还没有分类，请先在设置中添加', true); return; }
                var msg = '选择分类（输入序号）：\n' + cats.map(function (n, i) { return (i + 1) + '. ' + n; }).join('\n');
                var choice = prompt(msg);
                if (choice === null) return;
                var ci = parseInt(choice) - 1;
                if (ci < 0 || ci >= cats.length) { toast('无效选择', true); return; }
                var targetCat = cats[ci];
                dd.outfits.forEach(function (o) { if (batchSelected.indexOf(o.id) !== -1) o.category = targetCat; });
                save(dd); toast('✅ 已将 ' + batchSelected.length + ' 套移到「' + targetCat + '」'); batchSelected = []; renderGrid();
            });
            if (btagBtn) btagBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var tag = prompt('为所选 ' + batchSelected.length + ' 套穿搭设置场景标签：'); if (tag === null) return; tag = tag.trim();
                var dd = load(); dd.outfits.forEach(function (o) { if (batchSelected.indexOf(o.id) !== -1) o.sceneTag = tag; });
                save(dd); toast('✅ 已设置标签：' + (tag || '（已清空）')); batchSelected = []; renderGrid();
            });
            if (bdelBtn) bdelBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                if (!confirm('确定删除已选 ' + batchSelected.length + ' 套穿搭？')) return;
                var dd = load();
                dd.outfits = dd.outfits.filter(function (o) { return batchSelected.indexOf(o.id) === -1; });
                if (dd.chars) { for (var cn in dd.chars) { dd.chars[cn].outfits = (dd.chars[cn].outfits || []).filter(function (o) { return batchSelected.indexOf(o.id) === -1; }); } }
                batchSelected.forEach(function (id) {
                    var ai = (dd.activeIds || []).indexOf(id); if (ai !== -1) dd.activeIds.splice(ai, 1);
                    if (dd.chars) { for (var cn2 in dd.chars) { var cai = (dd.chars[cn2].activeIds || []).indexOf(id); if (cai !== -1) dd.chars[cn2].activeIds.splice(cai, 1); } }
                });
                save(dd); updateBtn(); renderBottomStatus(); toast('已删除 ' + batchSelected.length + ' 套穿搭'); batchSelected = []; renderGrid();
            });

            var bpasteBtn = area.querySelector('#om-batch-paste');
            if (bpasteBtn) bpasteBtn.addEventListener('click', function () {
                if (batchSelected.length === 0) { toast('请先选择穿搭', true); return; }
                var modal = document.createElement('div'); modal.className = 'om-modal';
                var bg = darkMode ? '#1e1e24' : '#ececef'; var fg = darkMode ? '#eee' : '#111';
                modal.innerHTML = '<div class="om-modal-box" style="max-width:600px;background:' + bg + ';color:' + fg + '"><div class="om-modal-title"><i class="fa-solid fa-paste"></i> 批量粘贴描述</div><div style="font-size:.78em;opacity:.6;margin-bottom:8px">将 AI 返回的所有描述一起粘贴到下方，按 <code>--- 第N套 ---</code> 自动分割分配给已选 ' + batchSelected.length + ' 套穿搭</div><textarea id="om-paste-area" rows="14" style="width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:10px;font-size:.85em;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea><div id="om-paste-result" style="margin-top:8px;font-size:.8em"></div><div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-paste-go">分配并保存</button><button class="om-btn om-btn-outline" id="om-paste-copyprompt" style="font-size:.75em;padding:3px 8px;margin-right:4px"><i class="fa-solid fa-copy"></i> 复制提示词</button><button class="om-btn om-btn-outline" id="om-paste-cancel">取消</button></div></div>';
                var mp = getPopupLayer(); modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
                mp.appendChild(modal); modal.addEventListener('click', function (e) { if (e.target === modal) mp.removeChild(modal); });
                modal.querySelector('#om-paste-cancel').addEventListener('click', function () { mp.removeChild(modal); });
                modal.querySelector('#om-paste-copyprompt').addEventListener('click', function (e) { e.stopPropagation(); var prompt = '请逐一分析以下穿搭照片，对每张照片严格按以下格式返回（不要额外解释，直接输出）：\n\n--- 第1套 ---\n名称：<5-15字简短名称>\n分类：<睡衣/制服/常服/外出服>\n风格：<学院/简约/运动/甜美/通勤/休闲/街头/优雅/舒适>\n季节：<春/夏/秋/冬/全年>\n场景：<外出/家居/办公/约会/运动/睡前>\n描述：<100-200字服装描述>\n\n--- 第2套 ---\n...'; navigator.clipboard.writeText(prompt).then(function() { toast('提示词已复制！粘贴到外部AI对话框即可'); }).catch(function() { toast('复制失败，请手动复制', true); }); });
                modal.querySelector('#om-paste-go').addEventListener('click', function () {
                    var text = modal.querySelector('#om-paste-area').value.trim();
                    if (!text) { toast('请先粘贴内容', true); return; }
                    var blocks = text.split(/---\s*第\s*\d+\s*套\s*---/i).filter(function(b) { return b.trim(); });
                    if (blocks.length === 0) { blocks = text.split(/\n\s*\n\s*\n/).filter(function(b) { return b.trim(); }); }
                    if (blocks.length === 0) { blocks = [text]; }
                    var dd = load(); var updated = 0;
                    var ids = batchSelected.slice();
                    for (var i = 0; i < Math.min(blocks.length, ids.length); i++) {
                        var o = getById(dd, ids[i]); if (!o) continue;
                        var block = blocks[i].trim();
                        function findKey(kp) { var allKeys = ['名称','分类','类型','风格','季节','场景','描述']; var stopKeys = allKeys.filter(function(k){ return k !== kp; }); var stopPat = stopKeys.map(function(k){ return k + '\\s*[\\uff1a：]'; }).join('|'); var m = block.match(new RegExp(kp + '\\s*[\\uff1a：]\\s*([\\s\\S]*?)(?=' + stopPat + '|---|$)', 'i')); return m ? m[1].trim() : ''; }
                        var nm = findKey('名称'); if (nm) o.name = nm;
                        var cat = findKey('分类'); if (cat) { o.category = cat; var vcl = getViewCategories(dd); if (vcl.indexOf(cat) === -1) vcl.push(cat); }
                        var st = findKey('风格'); if (st) o.style = st;
                        var sn = findKey('季节'); if (sn) o.season = sn;
                        var sc = findKey('场景'); if (sc) o.sceneTag = sc;
                        var desc = findKey('描述'); if (desc) o.description = desc;
                        if (!nm && !cat && !st && !sn && !sc && !desc) { o.description = block; }
                        updated++;
                    }
                    save(dd); mp.removeChild(modal); renderGrid(); renderCatbar(); toast('✅ 已更新 ' + updated + ' 套');
                });
            });
            area.querySelectorAll('.om-card').forEach(function (card) {
                card.addEventListener('click', function (e) {
                    if (e.target.closest('.om-card-check')) return;
                    var id = card.dataset.id;
                    var chk = card.querySelector('.om-card-check');
                    var idx = batchSelected.indexOf(id);
                    if (idx !== -1) batchSelected.splice(idx, 1); else batchSelected.push(id);
                    if (chk) chk.classList.toggle('checked', batchSelected.indexOf(id) !== -1);
                    card.classList.toggle('batch-sel', batchSelected.indexOf(id) !== -1);
                    var cnt = area.querySelector('#om-batch-count');
                    if (cnt) cnt.textContent = batchSelected.length;
                });
            });
            area.querySelectorAll('.om-card-check').forEach(function (chk) {
                chk.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = chk.dataset.id;
                    var idx = batchSelected.indexOf(id);
                    if (idx !== -1) batchSelected.splice(idx, 1); else batchSelected.push(id);
                    chk.classList.toggle('checked', batchSelected.indexOf(id) !== -1);
                    var card = chk.closest('.om-card');
                    if (card) card.classList.toggle('batch-sel', batchSelected.indexOf(id) !== -1);
                    var cnt = area.querySelector('#om-batch-count');
                    if (cnt) cnt.textContent = batchSelected.length;
                });
            });
        } else {
            // 非批量：单击 = 换上这一套；Ctrl/Shift/Command + 单击 = 多套衣柜模式
            area.querySelectorAll('.om-card').forEach(function (card) {
                var id = card.dataset.id;

                card.addEventListener('click', function (e) {
                    if (e.target.closest('.om-card-menu')) return;
                    var dd = load();
                    var aids = getViewActiveIds(dd);
                    var idx = aids.indexOf(id);
                    var wasActive = idx !== -1;
                    var multiMode = e.ctrlKey || e.metaKey || e.shiftKey;
                    if (multiMode) {
                        if (wasActive) aids.splice(idx, 1); else aids.push(id);
                    } else if (wasActive && aids.length === 1) {
                        aids = [];
                    } else {
                        aids = [id];
                    }
                    setViewActiveIds(dd, aids);
                    save(dd); updateBtn(); renderBottomStatus();


                    // 更新整页卡片样式，普通点击会替换掉旧穿搭
                    area.querySelectorAll('.om-card').forEach(function (c) {
                        var cid = c.dataset.id;
                        var active = isActive(dd, cid);
                        c.classList.toggle('on', active);
                        var badge = c.querySelector('.om-badge-on');
                        if (active) {
                            if (!badge) {
                                var img = c.querySelector('.om-card-img');
                                if (img) {
                                    var b = document.createElement('div');
                                    b.className = 'om-badge-on';
                                    b.innerHTML = '<i class="fa-solid fa-check"></i>';
                                    img.appendChild(b);
                                }
                            }
                        } else if (badge) {
                            badge.parentNode.removeChild(badge);
                        }
                    });
                    closeDetailPanel();
                    var n = aids.length;
                    var o = getById(dd, id);
                    if (n === 0) toast('已取消：' + (o ? o.name : ''));
                    else if (n === 1) toast('✅ 已换装：' + (o ? o.name : '') + '，下次发送时注入');
                    else toast('✅ 衣柜模式，共' + n + '套');
                });
            });

            // 菜单按钮点击事件（独立绑定，stopPropagation防止触发卡片选择）
            area.querySelectorAll('.om-card-menu').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var id = btn.dataset.id;
                    var o = getById(load(), id);
                    openContextMenu(o, imgOutfits);
                });
            });
        }
    }

    // ── 底栏状态 ─────────────────────────────────────────────
    function renderQuickScenes(d) {
        var el = document.getElementById('om-quick-scenes'); if (!el) return;
        var allOutfits = getViewOutfits(d);
        if (allOutfits.length === 0) { el.innerHTML = ''; return; }
        // Collect all unique scene tags
        var sceneTags = [];
        allOutfits.forEach(function(o) { if (o.sceneTag && o.sceneTag.trim() && sceneTags.indexOf(o.sceneTag.trim()) === -1) sceneTags.push(o.sceneTag.trim()); }); if (typeof wbMode !== 'undefined' && wbMode) { var wbOnlyChecked = document.getElementById('om-qs-wbonly') ? document.getElementById('om-qs-wbonly').checked : false; var outfits = wbOnlyChecked ? [] : getViewOutfits(d).filter(function(o) { return o.sceneTag && o.sceneTag.trim() === scene; }); getWorldBookStyles().forEach(function(ws) { if (ws.scene && ws.scene.trim() && sceneTags.indexOf(ws.scene.trim()) === -1) sceneTags.push(ws.scene.trim()); }); }
        if (sceneTags.length === 0) { if (typeof wbMode !== 'undefined' && wbMode) { var wbScenes = []; var wbStyles = typeof worldBookStylesModern !== 'undefined' ? worldBookStylesModern : []; wbStyles.forEach(function(ws) { if (ws.scene && wbScenes.indexOf(ws.scene) === -1) wbScenes.push(ws.scene); }); sceneTags = wbScenes.slice(0, 6); if (sceneTags.length === 0) { el.innerHTML = ''; return; } } else { el.innerHTML = ''; return; } }
        // Limit to first 6
        sceneTags = sceneTags.slice(0, 6);
        var wbOnlyQS = false; el.innerHTML = '<label style="display:flex;align-items:center;gap:4px;font-size:.65em;opacity:.7;margin-right:4px;cursor:pointer;white-space:nowrap"><input type="checkbox" id="om-qs-wbonly" style="margin:0" /> 仅世界书</label>' + sceneTags.map(function(tag) {
            return '<button class="om-quick-scene-btn" data-scene="' + esc(tag) + '">' + esc(tag) + '</button>';
        }).join('');
        el.querySelectorAll('.om-quick-scene-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var scene = this.dataset.scene;
                var wbOnlyChecked = document.getElementById('om-qs-wbonly') ? document.getElementById('om-qs-wbonly').checked : false; var outfits = wbOnlyChecked ? [] : getViewOutfits(d).filter(function(o) { return o.sceneTag && o.sceneTag.trim() === scene; }); if (typeof wbMode !== 'undefined' && (wbMode || wbOnlyChecked)) { getWorldBookStyles().filter(function(ws) { return ws.scene === scene; }).forEach(function(ws, wi) { outfits.push({ id: 'wb_qs_' + wi, name: ws.name, category: ws.scene, type: 'outfit', style: ws.style, season: ws.season, sceneTag: ws.scene, description: ws.desc, imageData: null, isVirtual: true }); }); }
                if (outfits.length === 0) { toast('没有「' + scene + '」场景的穿搭', true); return; }
                var picked = outfits[Math.floor(Math.random() * outfits.length)];
                var dd = load();
                // Activate only this outfit
                dd.activeIds = [];
                if (dd.chars) for (var cn in dd.chars) dd.chars[cn].activeIds = [];
                if (picked.isVirtual) { var realId = genId(); picked.id = realId; dd.virtualOutfits[realId] = picked; } dd.activeIds = [picked.id];
                var confirmPick = function() { save(dd); renderGrid(); renderBottomStatus(); updateBtn(); toast('已换上「' + picked.name + '」(' + scene + ')'); };
                if (picked.isVirtual) {
                    var modal2 = document.createElement('div'); modal2.className = 'om-modal';
                    var bgg = typeof darkMode !== 'undefined' && darkMode ? '#1e1e24' : '#ececef'; var fgg = typeof darkMode !== 'undefined' && darkMode ? '#eee' : '#111';
                    modal2.innerHTML = '<div class="om-modal-box" style="max-width:460px;background:' + bgg + ';color:' + fgg + '"><div class="om-modal-title" style="font-size:1.1em"><i class="fa-solid fa-shirt"></i> ' + esc(picked.name) + '</div>' +
                        '<div style="display:flex;gap:16px;margin:12px 0;font-size:.82em;opacity:.7"><span>风格：' + esc(picked.style || '') + '</span><span>季节：' + esc(picked.season || '') + '</span><span>场景：' + esc(picked.sceneTag || '') + '</span></div>' +
                        '<div style="background:rgba(127,127,127,.08);border-radius:10px;padding:16px;font-size:.9em;line-height:1.8;white-space:pre-wrap;max-height:300px;overflow-y:auto">' + esc(picked.description || '') + '</div>' +
                        '<div class="om-btn-row" style="margin-top:12px;gap:10px"><button class="om-btn om-btn-safe" id="om-desc-confirm"><i class="fa-solid fa-check"></i> 确认</button><button class="om-btn om-btn-outline" id="om-desc-close">关闭</button></div></div>';
                    var mp2 = getPopupLayer(); modal2.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
                    mp2.appendChild(modal2); modal2.addEventListener('click', function(e) { if (e.target === modal2) mp2.removeChild(modal2); });
                    modal2.querySelector('#om-desc-confirm').addEventListener('click', function() { confirmPick(); mp2.removeChild(modal2); });
                    modal2.querySelector('#om-desc-close').addEventListener('click', function() { mp2.removeChild(modal2); });
                } else if (picked.imageData) {
                    confirmPick();
                    openLightbox([picked], picked.id);
                    setTimeout(function() { var lb = document.getElementById('om-lightbox'); if (lb && lb.parentNode) lb.parentNode.removeChild(lb); }, 3000);
                } else {
                    confirmPick();
                }
            });
        });
    }

        function renderBottomStatus() {
        var el = document.getElementById('om-bottom-status'); if (!el) return;
        var d = load();

        // 收集所有owner的激活穿搭
        var allActive = [];
        // User
        (d.activeIds || []).forEach(function (id) { var o = getById(d, id); if (o) allActive.push({ owner: 'User', name: o.name, id: id }); });
        // Chars
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                (cd.activeIds || []).forEach(function (id) {
                    var o = null; for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { o = cd.outfits[k]; break; } }
                    if (o) allActive.push({ owner: cn, name: o.name, id: id });
                });
            }
        }

        var dotClass, text;
        if (allActive.length === 0) { dotClass = 'gray'; text = '未选择穿搭'; }
        else {
            dotClass = 'green';
            var parts = [];
            var userCount = allActive.filter(function (a) { return a.owner === 'User'; }).length;
            if (userCount > 0) parts.push('User ' + userCount + '套');
            if (d.chars) {
                for (var cn2 in d.chars) {
                    var cnt = allActive.filter(function (a) { return a.owner === cn2; }).length;
                    if (cnt > 0) parts.push(cn2 + ' ' + cnt + '套');
                }
            }
            text = parts.join(' · ');
            if (allActive.length > 1) dotClass = 'orange';
        }

        var clearBtn = allActive.length > 0 ? '<button class="om-status-clear" id="om-status-clearall">全部取消</button>' : '';
        var activeName = allActive.length === 1 ? allActive[0].name : '';
        var statusDisplay = activeName ? '穿着：' + esc(activeName) : text;
        el.innerHTML = '<div class="om-status-dot ' + dotClass + '"></div><span class="om-status-text" title="' + esc(activeName) + '">' + esc(statusDisplay) + '</span>' + clearBtn;
        renderQuickScenes(load());

        var clr = el.querySelector('#om-status-clearall');
        if (clr) clr.addEventListener('click', function (e) {
            e.stopPropagation();
            var dd = load(); dd.activeIds = [];
            if (dd.chars) { for (var cn3 in dd.chars) { dd.chars[cn3].activeIds = []; } }
            save(dd);
            updateBtn(); renderBottomStatus(); renderGrid(); closeDetailPanel();
            toast('已取消全部选择');
        });
    }

    // ── 选择详情面板 ─────────────────────────────────────────
    function toggleDetailPanel() {
        if (detailPanelOpen) { closeDetailPanel(); return; }
        var d = load();

        // 收集所有owner的激活穿搭，按owner分组
        var groups = [];
        var userNames = [];
        (d.activeIds || []).forEach(function (id) { var o = getById(d, id); if (o) userNames.push({ id: id, name: o.name }); });
        if (userNames.length > 0) groups.push({ owner: 'User', items: userNames });
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                var charNames = [];
                (cd.activeIds || []).forEach(function (id) {
                    for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { charNames.push({ id: id, name: cd.outfits[k].name }); break; } }
                });
                if (charNames.length > 0) groups.push({ owner: cn, items: charNames });
            }
        }
        if (groups.length === 0) return;
        openDetailPanel(groups, d);
    }

    function openDetailPanel(groups, d) {
        closeDetailPanel();
        var bottombar = document.getElementById('om-bottombar'); if (!bottombar) return;
        detailPanelOpen = true;
        var panel = document.createElement('div');
        panel.id = 'om-detail-panel';
        panel.className = 'om-detail-panel';
        panel.style.cssText = 'position:absolute;bottom:100%;left:0;right:0;z-index:10;';

        var html = '<div class="om-detail-handle"></div>';
        groups.forEach(function (g) {
            html += '<div class="om-detail-title" style="margin-top:4px">' + esc(g.owner) + '</div>';
            html += '<div class="om-detail-tags">';
            g.items.forEach(function (w) {
                html += '<span class="om-detail-tag">' + esc(w.name) +
                    '<button class="om-detail-tag-x" data-id="' + w.id + '">&#x2715;</button></span>';
            });
            html += '</div>';
        });
        panel.innerHTML = html;
        bottombar.appendChild(panel);
        panel.querySelectorAll('.om-detail-tag-x').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var id = btn.dataset.id;
                // 从所有owner中查找并移除
                var ai1 = (dd.activeIds || []).indexOf(id); if (ai1 !== -1) dd.activeIds.splice(ai1, 1);
                if (dd.chars) { for (var cn in dd.chars) { var cai = (dd.chars[cn].activeIds || []).indexOf(id); if (cai !== -1) dd.chars[cn].activeIds.splice(cai, 1); } }
                save(dd); updateBtn(); renderBottomStatus(); renderGrid();
                closeDetailPanel();
            });
        });
        // 点击底栏外关闭
        setTimeout(function () {
            document.addEventListener('click', outsideDetailClick, true);
        }, 10);
    }

    function outsideDetailClick(e) {
        var panel = document.getElementById('om-detail-panel');
        var statusEl = document.getElementById('om-bottom-status');
        if (panel && !panel.contains(e.target) && statusEl && !statusEl.contains(e.target)) {
            closeDetailPanel();
        }
    }

    function closeDetailPanel() {
        detailPanelOpen = false;
        var p = document.getElementById('om-detail-panel'); if (p && p.parentNode) p.parentNode.removeChild(p);
        document.removeEventListener('click', outsideDetailClick, true);
    }

    // ── 长按操作菜单 Bottom Sheet ─────────────────────────────
    function openContextMenu(outfit, imgOutfits) {
        if (!outfit) return;
        var d = load();
        var isOn = isActive(d, outfit.id);

        var sheet = createSheet([
            '<div class="om-ctx-outfit-name"><i class="fa-solid fa-shirt" style="margin-right:6px;opacity:.5;"></i>' + esc(outfit.name) + '</div>',
            isOn
                ? '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-xmark"></i>取消选择</div>'
                : '<div class="om-ctx-item" id="om-ctx-wear"><i class="fa-solid fa-circle-check"></i>选择穿搭</div>',
            outfit.imageData ? '<div class="om-ctx-item" id="om-ctx-view"><i class="fa-solid fa-expand"></i>查看大图</div>' : '',
            '<div class="om-ctx-item" id="om-ctx-edit"><i class="fa-solid fa-pen"></i>编辑</div>',
            '<div class="om-ctx-item danger" id="om-ctx-del"><i class="fa-solid fa-trash"></i>删除</div>',
        ].join(''));

        var wearEl = sheet.querySelector('#om-ctx-wear');
        if (wearEl) wearEl.addEventListener('click', function () {
            closeSheet(sheet);
            var dd = load();
            var aids = getViewActiveIds(dd);
            var idx = aids.indexOf(outfit.id);
            if (idx !== -1) aids.splice(idx, 1); else aids = [outfit.id];
            setViewActiveIds(dd, aids);
            save(dd); updateBtn(); renderBottomStatus(); renderGrid();
            closeDetailPanel();
        });

        var viewEl = sheet.querySelector('#om-ctx-view');
        if (viewEl) viewEl.addEventListener('click', function () {
            closeSheet(sheet);
            openLightbox(imgOutfits, outfit.id);
        });

        var editEl = sheet.querySelector('#om-ctx-edit');
        if (editEl) editEl.addEventListener('click', function () {
            closeSheet(sheet);
            openEditSheet(outfit, outfit.category || '');
        });

        var delEl = sheet.querySelector('#om-ctx-del');
        if (delEl) delEl.addEventListener('click', function () {
            closeSheet(sheet);
            if (!confirm('确定删除「' + outfit.name + '」？')) return;
            var dd = load();
            dd.outfits = dd.outfits.filter(function (o) { return o.id !== outfit.id; });
            // 也从chars中查找并删除
            if (dd.chars) { for (var cn in dd.chars) { dd.chars[cn].outfits = (dd.chars[cn].outfits || []).filter(function (o) { return o.id !== outfit.id; }); var cai = (dd.chars[cn].activeIds || []).indexOf(outfit.id); if (cai !== -1) dd.chars[cn].activeIds.splice(cai, 1); } }
            var ai = (dd.activeIds || []).indexOf(outfit.id); if (ai !== -1) dd.activeIds.splice(ai, 1);
            save(dd); updateBtn(); renderBottomStatus(); renderGrid(); toast('已删除');
        });
    }

    // ── 编辑 Bottom Sheet ─────────────────────────────────────
    function getAllTagSuggestions(d) {
        var tags = [];
        d.outfits.forEach(function (o) { if (o.sceneTag && o.sceneTag.trim()) { var t = o.sceneTag.trim(); if (tags.indexOf(t) === -1) tags.push(t); } });
        return tags;
    }

    function openBatchAddSheet(defaultCat) {
        var d = load(); var viewCats = getViewCategories(d);
        var catOpts = '<option value="">无分类</option>' + viewCats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        if (defaultCat) catOpts = catOpts.replace('value="' + esc(defaultCat) + '"', 'value="' + esc(defaultCat) + '" selected');
        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-images"></i>批量添加穿搭</div>',
            '<div class="om-field"><label>名称前缀</label><input type="text" id="om-ba-prefix" placeholder="如：睡衣 -> 睡衣 1、睡衣 2..." /></div>',
            '<div class="om-field"><label>类型</label><div class="om-type-radios"><label class="om-radio-label"><input type="radio" name="om-ba-type" value="outfit" checked /> 套装</label><label class="om-radio-label"><input type="radio" name="om-ba-type" value="item" /> 单品</label></div></div>',
            '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-ba-cat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-ba-newcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="om-field"><label>风格</label><input type="text" id="om-ba-style" placeholder="学院 / 简约 / 运动" />',
            '<div class="om-field"><label>季节</label><input type="text" id="om-ba-season" placeholder="春 / 夏 / 秋 / 冬 / 全年" />',
            '<div class="om-field"><label>场景标签</label><input type="text" id="om-ba-scene" placeholder="家居 / 外出 / 睡觉" />',
            '<div class="om-field"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><label style="margin:0">粘贴AI描述 <span class="om-hint">可选：按 --- 第N套 --- 分割，与照片顺序一一对应</span></label><button class="om-btn om-btn-outline" id="om-ba-copyprompt" style="font-size:.75em;padding:4px 10px;flex-shrink:0" title="复制提示词到剪贴板"><i class="fa-solid fa-copy"></i> 复制提示词</button></div><textarea id="om-ba-desctext" rows="8" placeholder="将外部AI返回的描述粘贴到这里...&#10;格式示例：&#10;--- 第1套 ---&#10;名称：粉色睡裙&#10;分类：睡衣&#10;风格：甜美&#10;季节：夏&#10;场景：睡前&#10;描述：粉色丝绸吊带睡裙...&#10;&#10;--- 第2套 ---&#10;..." style="width:100%;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.2);border-radius:8px;color:inherit;padding:10px;font-size:.8em;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea></div>',
            '<div class="om-field"><label>选择照片</label><div class="om-imgarea" id="om-ba-dropzone" style="min-height:120px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;padding:12px"><div class="om-imgph" id="om-ba-placeholder"><i class="fa-regular fa-images"></i><span>点击或拖拽多张照片</span></div></div><input type="file" id="om-ba-file" accept="image/*" multiple style="display:none" /></div>',
            '<div class="om-field" id="om-ba-preview-area" style="display:none"><label>已选择 <span id="om-ba-count">0</span> 张</label><div id="om-ba-preview" style="display:flex;flex-wrap:wrap;gap:6px;max-height:120px;overflow-y:auto"></div></div>',
            '<div class="om-btn-row"><button class="om-btn om-btn-safe" id="om-ba-create">创建 <span id="om-ba-btn-count">0</span> 套</button><button class="om-btn om-btn-outline" id="om-ba-cancel">取消</button></div>'
        ]);
        var batchFiles = []; var batchDataUrls = [];
        function updatePreview() {
            var cnt = batchFiles.length; sheet.querySelector('#om-ba-count').textContent = cnt; sheet.querySelector('#om-ba-btn-count').textContent = cnt;
            sheet.querySelector('#om-ba-preview-area').style.display = cnt > 0 ? '' : 'none';
            sheet.querySelector('#om-ba-placeholder').style.display = cnt > 0 ? 'none' : '';
            sheet.querySelector('#om-ba-create').disabled = cnt === 0;
            sheet.querySelector('#om-ba-preview').innerHTML = batchDataUrls.map(function (url) { return '<img src="' + url + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px" />'; }).join('');
        }
        function addFiles(files) { for (var i = 0; i < files.length; i++) { var f2 = files[i]; if (!f2 || f2.type.indexOf('image') !== 0) continue; batchFiles.push(f2); } var loaded = 0; var total = batchFiles.length; batchDataUrls = new Array(total); for (var j = 0; j < batchFiles.length; j++) { (function (idx) { var reader = new FileReader(); reader.onload = function (e) { compressImage(e.target.result, function (c) { batchDataUrls[idx] = c; loaded++; if (loaded >= total) updatePreview(); }); }; reader.readAsDataURL(batchFiles[idx]); })(j); } if (total === 0) updatePreview(); }
        sheet.querySelector('#om-ba-dropzone').addEventListener('click', function () { sheet.querySelector('#om-ba-file').click(); });
        sheet.querySelector('#om-ba-file').addEventListener('change', function () { if (this.files.length > 0) addFiles(this.files); });
        sheet.querySelector('#om-ba-dropzone').addEventListener('dragover', function (e) { e.preventDefault(); });
        sheet.querySelector('#om-ba-dropzone').addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); });
        sheet.querySelector('#om-ba-create').addEventListener('click', function () {
            var prefix = sheet.querySelector('#om-ba-prefix').value.trim();
            var cat = sheet.querySelector('#om-ba-cat').value;
            var typeEl = sheet.querySelector('input[name="om-ba-type"]:checked');
            var baType = typeEl ? typeEl.value : 'outfit';
            var style = sheet.querySelector('#om-ba-style').value.trim();
            var season = sheet.querySelector('#om-ba-season').value.trim();
            var scene = sheet.querySelector('#om-ba-scene').value.trim();
            var descText = sheet.querySelector('#om-ba-desctext') ? sheet.querySelector('#om-ba-desctext').value.trim() : '';
            var descBlocks = [];
            if (descText) {
                descBlocks = descText.split(/---\s*第\s*\d+\s*套\s*---/i).filter(function(b) { return b.trim(); });
                if (descBlocks.length === 0) { descBlocks = descText.split(/\n\s*\n\s*\n/).filter(function(b) { return b.trim(); }); }
                if (descBlocks.length === 0) { descBlocks = [descText]; }
            }
            var dd = load(); var created = 0;
            batchDataUrls.forEach(function (url, i) {
                var name = prefix ? prefix + ' ' + (i + 1) : ('穿搭 ' + (i + 1));
                var desc = '', nm = name, oc = cat, ost = style, osn = season, osc = scene, otype = baType;
                if (descBlocks[i]) {
                    var block = descBlocks[i].trim();
                    function findKey(kp) { var allKeys = ['名称','分类','类型','风格','季节','场景','描述']; var stopKeys = allKeys.filter(function(k){ return k !== kp; }); var stopPat = stopKeys.map(function(k){ return k + '\\s*[\\uff1a：]'; }).join('|'); var m = block.match(new RegExp(kp + '\\s*[\\uff1a：]\\s*([\\s\\S]*?)(?=' + stopPat + '|---|$)', 'i')); return m ? m[1].trim() : ''; }
                    var pn = findKey('名称'); if (pn) nm = pn;
                    var pcat = findKey('分类'); if (pcat) oc = pcat;
                    var ptype = findKey('类型'); if (ptype && (ptype === '套装' || ptype === '单品')) otype = ptype;
                    var pst = findKey('风格'); if (pst) ost = pst;
                    var psn = findKey('季节'); if (psn) osn = psn;
                    var psc = findKey('场景'); if (psc) osc = psc;
                    var pdesc = findKey('描述'); if (pdesc) desc = pdesc;
                }
                var vcs = getViewCategories(dd); if (oc && vcs.indexOf(oc) === -1) vcs.push(oc); var o = { id: genId(), name: nm, category: oc, type: otype, style: ost, season: osn, sceneTag: osc, description: desc, imageData: url, createdAt: Date.now() };
                if (dd.currentView === 'char' && dd.currentChar) getCharData(dd, dd.currentChar).outfits.push(o);
                else dd.outfits.push(o);
                created++;
            });
            save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus(); toast('已创建 ' + created + ' 套');
        });
        sheet.querySelector('#om-ba-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-ba-copyprompt').addEventListener('click', function (e) { e.stopPropagation(); var prompt = '请逐一分析以下穿搭照片，对每张照片严格按以下格式返回（不要额外解释，直接输出）：\n\n--- 第1套 ---\n名称：<5-15字简短名称>\n分类：<睡衣/制服/常服/外出服>\n风格：<学院/简约/运动/甜美/通勤/休闲/街头/优雅/舒适>\n季节：<春/夏/秋/冬/全年>\n场景：<外出/家居/办公/约会/运动/睡前>\n描述：<100-200字服装描述>\n\n--- 第2套 ---\n...'; navigator.clipboard.writeText(prompt).then(function() { toast('提示词已复制！粘贴到外部AI对话框即可'); }).catch(function() { toast('复制失败，请手动复制', true); }); });
        sheet.querySelector('#om-ba-newcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); var vc = getViewCategories(dd); if (vc.indexOf(name) === -1) { vc.push(name); save(dd); renderCatbar(); }
            var sel = sheet.querySelector('#om-ba-cat'); var ex = false;
            for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
            sel.value = name;
        });
    }

    function openRandomRoll() {
        var d = load(); var allOutfits = getViewOutfits(d);
        if (allOutfits.length === 0) { toast('还没有任何穿搭', true); return; }
        var styles = []; var seasons = []; var scenes = [];
        allOutfits.forEach(function (o) { if (o.style && o.style.trim() && styles.indexOf(o.style.trim()) === -1) styles.push(o.style.trim()); if (o.season && o.season.trim() && seasons.indexOf(o.season.trim()) === -1) seasons.push(o.season.trim()); if (o.sceneTag && o.sceneTag.trim() && scenes.indexOf(o.sceneTag.trim()) === -1) scenes.push(o.sceneTag.trim()); });
        var sopts = styles.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var seopts = seasons.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var scopts = scenes.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-dice"></i>随机搭配</div>',
            '<div class="om-field"><label style="font-weight:600;font-size:.85em;margin-bottom:4px">世界书风格</label>',
            '<div style="display:flex;flex-direction:column;gap:4px;font-size:.82em">',
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="om-roll-wb-modern" checked /> 💎uu现代v2.1（20种风格）</label>',
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="om-roll-wb-lingerie" /> 🦋uu内衣v1.0（5款）</label>',
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:2px"><input type="checkbox" id="om-roll-wb-only" /> 仅roll世界书（不含衣柜）</label>',
            '</div></div>',
            '<div class="om-field"><label>风格</label><select id="om-roll-style"><option value="">不限</option>' + sopts + '</select></div>',
            '<div class="om-field"><label>季节</label><select id="om-roll-season"><option value="">不限</option>' + seopts + '</select></div>',
            '<div class="om-field"><label>场景</label><select id="om-roll-scene"><option value="">不限</option>' + scopts + '</select></div>',
            '<div class="om-field"><label>搭配模式</label><select id="om-roll-mode"><option value="mixed">套装优先 + 单品填充</option><option value="outfit">仅套装</option><option value="items">仅单品随机组合</option></select></div>',
            '<div class="om-field" id="om-roll-result-area" style="display:none;margin-top:12px"><div style="font-weight:600;font-size:.95em;margin-bottom:8px;color:var(--SmartThemeQuoteColor,#7c6daf)">搭配结果</div><div id="om-roll-result" style="background:rgba(127,127,127,.08);border-radius:10px;padding:14px;font-size:.85em;line-height:1.7;white-space:pre-wrap"></div><div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-roll-apply">应用这套搭配</button></div></div>',
            '<div class="om-btn-row" style="margin-top:10px"><button class="om-btn om-btn-safe" id="om-roll-go">随机搭配！</button><button class="om-btn om-btn-outline" id="om-roll-cancel">取消</button></div>'
        ]);
        var lastResult = null;
        function doRoll() { var ss = sheet.querySelector('#om-roll-style').value; var sn = sheet.querySelector('#om-roll-season').value; var sc = sheet.querySelector('#om-roll-scene').value; var sm = sheet.querySelector('#om-roll-mode').value; var useWBModern = sheet.querySelector('#om-roll-wb-modern') ? sheet.querySelector('#om-roll-wb-modern').checked : false; var useWBLingerie = sheet.querySelector('#om-roll-wb-lingerie') ? sheet.querySelector('#om-roll-wb-lingerie').checked : false; var useWBOnly = sheet.querySelector('#om-roll-wb-only') ? sheet.querySelector('#om-roll-wb-only').checked : false; var pool = useWBOnly ? [] : allOutfits.slice(); if (useWBModern) { (worldBookStylesModern || []).forEach(function(ws, wi) { pool.push({ id: 'wb_modern_' + wi, name: ws.name, category: ws.scene, type: 'outfit', style: ws.style, season: ws.season, sceneTag: ws.scene, description: ws.desc, imageData: null, isVirtual: true, source: '💎uu现代' }); }); } if (useWBLingerie) { (worldBookStylesLingerie || []).forEach(function(ws, wi) { pool.push({ id: 'wb_lingerie_' + wi, name: ws.name, category: ws.scene, type: 'outfit', style: ws.style, season: ws.season, sceneTag: ws.scene, description: ws.desc, imageData: null, isVirtual: true, source: '🦋uu内衣' }); }); } var f = pool.filter(function (o) { if (ss && (!o.style || o.style.trim() !== ss)) return false; if (sn && (!o.season || o.season.trim() !== sn)) return false; if (sc && (!o.sceneTag || o.sceneTag.trim() !== sc)) return false; return true; }); if (f.length === 0) { toast('没有匹配的穿搭', true); return; } var r = { outfits: [], items: [] }; var fo = f.filter(function (o) { return !o.type || o.type === 'outfit'; }); var fi = f.filter(function (o) { return o.type === 'item'; }); if (sm === 'outfit') { if (fo.length === 0) { toast('没有匹配的套装', true); return; } r.outfits = [fo[Math.floor(Math.random() * fo.length)]]; } else if (sm === 'items') { var g = {}; fi.forEach(function (it) { var c = it.category || '其他'; if (!g[c]) g[c] = []; g[c].push(it); }); for (var k in g) r.items.push(g[k][Math.floor(Math.random() * g[k].length)]); } else { if (fo.length > 0) r.outfits = [fo[Math.floor(Math.random() * fo.length)]]; var g2 = {}; fi.forEach(function (it) { var c2 = it.category || '其他'; if (!g2[c2]) g2[c2] = []; g2[c2].push(it); }); for (var k2 in g2) r.items.push(g2[k2][Math.floor(Math.random() * g2[k2].length)]); } lastResult = r; var h = '<div>'; if (r.outfits.length > 0) { h += '<div style="font-weight:600;margin-bottom:8px">套装</div>'; r.outfits.forEach(function (o) { h += '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;padding:8px;background:rgba(127,127,127,.06);border-radius:8px">'; if (o.imageData) h += '<img src="' + o.imageData + '" style="width:80px;height:106px;object-fit:cover;border-radius:6px;flex-shrink:0" />'; h += '<div style="min-width:0"><div style="font-weight:600;margin-bottom:2px">' + esc(o.name) + '</div>'; if (o.style) h += '<div style="font-size:.8em;opacity:.7">风格：' + esc(o.style) + '</div>'; if (o.season) h += '<div style="font-size:.8em;opacity:.7">季节：' + esc(o.season) + '</div>'; if (o.sceneTag) h += '<div style="font-size:.8em;opacity:.7">场景：' + esc(o.sceneTag) + '</div>'; if (o.description) h += '<div style="font-size:.82em;opacity:.85;margin-top:6px;line-height:1.6;padding:8px;background:rgba(127,127,127,.05);border-radius:6px;white-space:pre-wrap">' + esc(o.description) + '</div>'; h += '</div></div>'; }); } if (r.items.length > 0) { h += '<div style="font-weight:600;margin:8px 0">单品</div>'; r.items.forEach(function (o) { h += '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;padding:6px 8px;background:rgba(127,127,127,.04);border-radius:6px">'; if (o.imageData) h += '<img src="' + o.imageData + '" style="width:60px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0" />'; h += '<div><span style="font-size:.75em;opacity:.5">' + esc(o.category || '其他') + '</span><br>' + esc(o.name) + esc(o.name) + '</div>'; if (o.description) h += '<div style="font-size:.75em;opacity:.7;margin-top:2px;line-height:1.4">' + esc(o.description) + '</div>'; h += '</div></div>'; }); } h += '</div>'; sheet.querySelector('#om-roll-result').innerHTML = h; sheet.querySelector('#om-roll-result-area').style.display = ''; }
        sheet.querySelector('#om-roll-go').addEventListener('click', doRoll);
        sheet.querySelector('#om-roll-cancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-roll-apply').addEventListener('click', function () { if (!lastResult) return; var dd = load(); dd.activeIds = []; if (dd.chars) for (var cn in dd.chars) dd.chars[cn].activeIds = []; var ids = []; lastResult.outfits.forEach(function (o) { if (o.isVirtual) { var no = { id: genId(), name: o.name, category: o.category || '', type: 'outfit', style: o.style || '', season: o.season || '', sceneTag: o.sceneTag || '', description: o.description || '', imageData: null, createdAt: Date.now(), isVirtual: true }; dd.virtualOutfits[no.id] = no; ids.push(no.id); } else { ids.push(o.id); } }); lastResult.items.forEach(function (o) { ids.push(o.id); }); if (dd.currentView === 'char' && dd.currentChar) getCharData(dd, dd.currentChar).activeIds = ids; else dd.activeIds = ids; save(dd); closeSheet(sheet); toast('已应用！(' + ids.length + '件)'); renderGrid(); renderBottomStatus(); updateBtn(); });
        doRoll();
    }

    function openEditSheet(outfit, defaultCat) {
        var d = load();
        var editImgData = outfit ? (outfit.imageData || null) : null;
        var viewCats = getViewCategories(d);
        var catOpts = '<option value="">无分类</option>' +
            viewCats.map(function (c) { return '<option value="' + esc(c) + '"' + (outfit && outfit.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-' + (outfit ? 'pen' : 'plus') + '"></i>' + (outfit ? '编辑穿搭' : '添加穿搭') + '</div>',
            '<div class="om-field"><label>穿搭名称 *</label><input type="text" id="om-dn" placeholder="如：白色蕾丝连衣裙" value="' + esc(outfit ? outfit.name : '') + '" /></div>',
            '<div class="om-field"><label>分类</label><div class="om-frow"><select id="om-dcat">' + catOpts + '</select><button class="om-btn om-btn-outline" id="om-dnewcat" style="white-space:nowrap;font-size:.8em;padding:7px 10px">+ 新建</button></div></div>',
            '<div class="om-field"><label>类型</label><div class="om-type-radios"><label class="om-radio-label"><input type="radio" name="om-dtype" value="套装"' + (!outfit || outfit.type !== '单品' ? ' checked' : '') + ' /> 套装</label><label class="om-radio-label" style="margin-left:16px"><input type="radio" name="om-dtype" value="单品"' + (outfit && outfit.type === '单品' ? ' checked' : '') + ' /> 单品</label></div></div>',
            '<div class="om-field"><label>风格</label><input type="text" id="om-dstyle" placeholder="学院 / 简约 / 运动 / 甜美 / 通勤 / 休闲 / 街头 / 优雅 / 舒适" value="' + esc(outfit ? outfit.style || '' : '') + '" /></div>',
            '<div class="om-field"><label>季节</label><input type="text" id="om-dseason" placeholder="春 / 夏 / 秋 / 冬 / 全年" value="' + esc(outfit ? outfit.season || '' : '') + '" /></div>',
            '<div class="om-field"><label>文字描述 <span class="om-hint">注入用，越详细越好</span></label><textarea id="om-ddesc" rows="4" placeholder="如：白色蕾丝镂空连衣裙，领口略低，裙摆及膝……">' + esc(outfit ? outfit.description || '' : '') + '</textarea></div>',
            '<div class="om-field"><label>场景标签 <span class="om-hint">多套时 AI 据此选穿搭，如：外出 / 家居 / 睡前</span></label>',
            '<div class="om-suggest-wrap"><input type="text" id="om-dscene" placeholder="外出 / 家居 / 睡前 / 运动" value="' + esc(outfit ? outfit.sceneTag || '' : '') + '" autocomplete="off" />',
            '<div class="om-suggest-list" id="om-scene-suggest" style="display:none"></div></div></div>',
            '<div class="om-field"><label>参考图片 <span class="om-hint">可选，自动压缩</span></label>',
            '<div class="om-imgarea" id="om-dimgarea">' + (editImgData ? '<img src="' + editImgData + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>') + '</div>',
            '<input type="file" id="om-dfile" accept="image/*" style="display:none" />',
            '<div class="om-img-actions"><button class="om-btn om-btn-outline" id="om-dpick" style="font-size:.8em"><i class="fa-solid fa-image"></i> 选择图片</button>' + (editImgData ? '<button class="om-btn om-btn-danger" id="om-dclr" style="font-size:.8em">删除图片</button>' : '') + '</div></div>',
            '<div class="om-edit-foot"><button class="om-btn om-btn-outline" id="om-dcancel">取消</button><button class="om-btn om-btn-safe" id="om-dsave">保存</button></div>',
        ].join(''));

        // 设置默认分类
        if (defaultCat) {
            var sel = sheet.querySelector('#om-dcat'); if (sel) sel.value = defaultCat;
        }

        // 场景标签建议
        var sceneInput = sheet.querySelector('#om-dscene');
        var suggestList = sheet.querySelector('#om-scene-suggest');
        var allTags = getAllTagSuggestions(d);
        function showSuggestions(val) {
            var v = val.trim().toLowerCase();
            var filtered = v ? allTags.filter(function (t) { return t.toLowerCase().indexOf(v) !== -1 && t.toLowerCase() !== v; }) : allTags;
            if (filtered.length === 0) { suggestList.style.display = 'none'; return; }
            suggestList.innerHTML = filtered.map(function (t) { return '<div class="om-suggest-item" data-val="' + esc(t) + '">' + esc(t) + '</div>'; }).join('');
            suggestList.style.display = 'block';
        }
        sceneInput.addEventListener('focus', function () { showSuggestions(this.value); });
        sceneInput.addEventListener('input', function () { showSuggestions(this.value); });
        sceneInput.addEventListener('blur', function () { setTimeout(function () { suggestList.style.display = 'none'; }, 150); });
        suggestList.addEventListener('mousedown', function (e) {
            var item = e.target.closest('.om-suggest-item');
            if (item) { sceneInput.value = item.dataset.val; suggestList.style.display = 'none'; }
        });

        // 图片处理
        var fileInp = sheet.querySelector('#om-dfile');
        var imgArea = sheet.querySelector('#om-dimgarea');
        function setImg(data) {
            editImgData = data;
            imgArea.innerHTML = data ? '<img src="' + data + '" />' : '<div class="om-imgph"><i class="fa-regular fa-image"></i><span>点击或拖拽上传</span></div>';
            var clrOld = sheet.querySelector('#om-dclr'); var acts = sheet.querySelector('.om-img-actions');
            if (data && !clrOld && acts) {
                var b2 = document.createElement('button'); b2.className = 'om-btn om-btn-danger'; b2.id = 'om-dclr'; b2.style.fontSize = '.8em'; b2.textContent = '删除图片';
                b2.addEventListener('click', function () { setImg(null); }); acts.appendChild(b2);
            } else if (!data && clrOld) clrOld.parentNode.removeChild(clrOld);
        }
        function handleFile(f) {
            if (!f || f.type.indexOf('image') !== 0) return;
            var r = new FileReader(); r.onload = function (e) { compressImage(e.target.result, function (c) { setImg(c); }); }; r.readAsDataURL(f);
        }
        sheet.querySelector('#om-dpick').addEventListener('click', function () { fileInp.click(); });
        imgArea.addEventListener('click', function () { fileInp.click(); });
        fileInp.addEventListener('change', function () { if (fileInp.files[0]) handleFile(fileInp.files[0]); });
        imgArea.addEventListener('dragover', function (e) { e.preventDefault(); imgArea.classList.add('drag'); });
        imgArea.addEventListener('dragleave', function () { imgArea.classList.remove('drag'); });
        imgArea.addEventListener('drop', function (e) { e.preventDefault(); imgArea.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
        var clr = sheet.querySelector('#om-dclr'); if (clr) clr.addEventListener('click', function () { setImg(null); });

        sheet.querySelector('#om-dnewcat').addEventListener('click', function () {
            var name = prompt('新分类名称：'); if (!name || !name.trim()) return; name = name.trim();
            var dd = load(); var vc = getViewCategories(dd); if (vc.indexOf(name) === -1) { vc.push(name); save(dd); renderCatbar(); }
            var sel = sheet.querySelector('#om-dcat'); var ex = false;
            for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === name) { ex = true; break; } }
            if (!ex) { var opt = document.createElement('option'); opt.value = name; opt.textContent = name; sel.appendChild(opt); }
            sel.value = name; toast('分类「' + name + '」已添加');
        });

        sheet.querySelector('#om-dcancel').addEventListener('click', function () { closeSheet(sheet); });
        sheet.querySelector('#om-dsave').addEventListener('click', function () {
            var name = sheet.querySelector('#om-dn').value.trim();
            if (!name) { toast('请输入穿搭名称', true); return; }
            var cat = sheet.querySelector('#om-dcat').value;
            var desc = sheet.querySelector('#om-ddesc').value.trim();
            var scene = sheet.querySelector('#om-dscene').value.trim();
            var otype = (sheet.querySelector('input[name="om-dtype"]:checked') || {}).value || '套装';
            var style = sheet.querySelector('#om-dstyle') ? sheet.querySelector('#om-dstyle').value.trim() : '';
            var season = sheet.querySelector('#om-dseason') ? sheet.querySelector('#om-dseason').value.trim() : '';
            var dd = load();
            if (outfit) {
                // 编辑已有穿搭 - 在所有数据中查找
                var found = false;
                for (var i = 0; i < dd.outfits.length; i++) {
                    if (dd.outfits[i].id === outfit.id) {
                        Object.assign(dd.outfits[i], { name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene, imageData: editImgData }); found = true; break;
                    }
                }
                if (!found && dd.chars) {
                    for (var cn in dd.chars) {
                        var co = dd.chars[cn].outfits || [];
                        for (var j = 0; j < co.length; j++) {
                            if (co[j].id === outfit.id) { Object.assign(co[j], { name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene, imageData: editImgData }); found = true; break; }
                        }
                        if (found) break;
                    }
                }
            } else {
                // 新增穿搭 - 放入当前视角
                var newOutfit = { id: genId(), name: name, category: cat, type: otype, style: style, season: season, description: desc, sceneTag: scene, imageData: editImgData, createdAt: Date.now() };
                if (dd.currentView === 'char' && dd.currentChar) {
                    getCharData(dd, dd.currentChar).outfits.push(newOutfit);
                } else {
                    dd.outfits.push(newOutfit);
                }
            }
            save(dd); closeSheet(sheet); toast('✨ 已保存：' + name); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
        });
    }

    // ── 预设 Bottom Sheet ─────────────────────────────────────
    function openPresetsSheet() {
        var d = load();
        var activePresetId = d.activePresetId || null;
        var presetListHtml = (!d.presets || d.presets.length === 0)
            ? '<div class="om-empty"><i class="fa-solid fa-bookmark"></i><span>还没有预设</span></div>'
            : d.presets.map(function (p, idx) {
                var isCurrent = (activePresetId && p.id === activePresetId);
                return '<div class="om-preset-item' + (isCurrent ? ' current' : '') + '" data-idx="' + idx + '">' +
                    '<div class="om-preset-name">' + esc(p.name) + (isCurrent ? ' <span style="font-size:.7em;opacity:.5;font-weight:400">（当前）</span>' : '') + '</div>' +
                    '<div class="om-preset-count">包含 ' + (p.outfits || []).length + ' 套穿搭</div>' +
                    '<button class="om-btn-sm om-preset-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="om-btn-sm om-preset-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button>' +
                    '</div>';
            }).join('');

        // 保存区：如果有当前预设，显示"覆盖保存"按钮
        var currentPreset = null;
        if (activePresetId && d.presets) {
            for (var pi = 0; pi < d.presets.length; pi++) {
                if (d.presets[pi].id === activePresetId) { currentPreset = d.presets[pi]; break; }
            }
        }
        var saveSection = '';
        if (currentPreset) {
            saveSection =
                '<div class="om-sec-title">保存</div>' +
                '<div class="om-btn-row" style="margin-bottom:10px">' +
                '<button class="om-btn om-btn-safe" id="om-preset-overwrite" style="flex:1"><i class="fa-solid fa-floppy-disk"></i> 保存到「' + esc(currentPreset.name) + '」</button>' +
                '</div>' +
                '<div class="om-divider"></div>' +
                '<div class="om-sec-title">另存为新预设</div>' +
                '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="新预设名称…" /><button class="om-btn om-btn-outline" id="om-preset-save">保存</button></div>';
        } else {
            saveSection =
                '<div class="om-sec-title">保存当前状态为预设</div>' +
                '<div class="om-hint" style="margin-bottom:8px">将当前所有穿搭数据 + 分类一起打包保存</div>' +
                '<div class="om-cat-add-row"><input type="text" id="om-preset-name-inp" placeholder="预设名称…" /><button class="om-btn om-btn-safe" id="om-preset-save">保存</button></div>';
        }

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-bookmark"></i>预设管理</div>',
            '<div class="om-sec-title">已保存的预设 <span class="om-hint">点击名称加载</span></div>',
            presetListHtml,
            '<div class="om-divider"></div>',
            saveSection,
        ].join(''));

        // 覆盖保存到当前预设
        var overwriteBtn = sheet.querySelector('#om-preset-overwrite');
        if (overwriteBtn) overwriteBtn.addEventListener('click', function () {
            var dd = load();
            for (var i = 0; i < dd.presets.length; i++) {
                if (dd.presets[i].id === activePresetId) {
                    dd.presets[i].outfits = JSON.parse(JSON.stringify(dd.outfits));
                    dd.presets[i].categories = JSON.parse(JSON.stringify(dd.categories));
                    dd.presets[i].activeIds = JSON.parse(JSON.stringify(dd.activeIds));
                    dd.presets[i].updatedAt = Date.now();
                    break;
                }
            }
            save(dd); closeSheet(sheet); toast('✅ 已保存到「' + currentPreset.name + '」'); openPresetsSheet();
        });

        // 保存为新预设
        var inp = sheet.querySelector('#om-preset-name-inp');
        sheet.querySelector('#om-preset-save').addEventListener('click', function () {
            var name = inp.value.trim(); if (!name) { toast('请输入预设名称', true); return; }
            var dd = load();
            if (!Array.isArray(dd.presets)) dd.presets = [];
            var newId = genId();
            dd.presets.push({ id: newId, name: name, createdAt: Date.now(), outfits: JSON.parse(JSON.stringify(dd.outfits)), categories: JSON.parse(JSON.stringify(dd.categories)), activeIds: JSON.parse(JSON.stringify(dd.activeIds)) });
            save(dd); dd = load(); dd.activePresetId = newId; save(dd); inp.value = ''; closeSheet(sheet); toast('✨ 预设「' + name + '」已保存'); openPresetsSheet();
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-preset-save').click(); });

        // 加载预设
        sheet.querySelectorAll('.om-preset-item').forEach(function (item) {
            item.addEventListener('click', function (e) {
                if (e.target.closest('.om-preset-ren') || e.target.closest('.om-preset-del')) return;
                var dd = load(); var p = dd.presets[parseInt(item.dataset.idx)]; if (!p) return;
                if (!confirm('加载预设「' + p.name + '」？这将覆盖当前所有穿搭数据。')) return;
                dd.outfits = JSON.parse(JSON.stringify(p.outfits || []));
                dd.categories = JSON.parse(JSON.stringify(p.categories || []));
                dd.activeIds = JSON.parse(JSON.stringify(p.activeIds || []));
                dd.activePresetId = p.id;
                save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); toast('✅ 已加载「' + p.name + '」');
            });
        });
        sheet.querySelectorAll('.om-preset-ren').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
                var nw = prompt('重命名：', p.name); if (!nw || !nw.trim()) return;
                p.name = nw.trim(); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.om-preset-del').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var dd = load(); var p = dd.presets[parseInt(btn.dataset.idx)]; if (!p) return;
                if (!confirm('删除预设「' + p.name + '」？')) return;
                if (p.id === activePresetId) { dd.activePresetId = null; }
                dd.presets.splice(parseInt(btn.dataset.idx), 1); save(dd); closeSheet(sheet); openPresetsSheet(); toast('已删除');
            });
        });
    }

    // ── 设置 Bottom Sheet ─────────────────────────────────────
    function openSettingsSheet() {
        var d = load();
        var imgCount = d.outfits.filter(function (o) { return !!o.imageData; }).length;

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-sliders"></i>设置</div>',

            '<div class="om-sec-title">发送内容</div>',
            '<div class="om-setting-row"><label>发送给 AI 的内容类型</label><select id="om-mode">',
            '<option value="text"' + (d.mode === 'text' ? ' selected' : '') + '>仅文字描述</option>',
            '<option value="image"' + (d.mode === 'image' ? ' selected' : '') + '>仅图片</option>',
            '<option value="both"' + (d.mode === 'both' ? ' selected' : '') + '>文字 + 图片</option>',
            '</select></div>',

            '<div class="om-setting-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="om-auto-roll"' + (!d.autoRollDisabled ? ' checked' : '') + ' /> 启动时自动随机穿搭（从世界书）</label></div>' +
            '<div class="om-setting-row"><label>注入位置 <span class="om-hint">Gemini/DeepSeek 建议选\"用户消息\"</span></label><select id="om-inject-pos">',
            '<option value="system"' + (d.injectPosition === 'system' ? ' selected' : '') + '>系统提示末尾</option>',
            '<option value="context"' + (d.injectPosition === 'context' ? ' selected' : '') + '>上下文末尾</option>',
            '<option value="user"' + (d.injectPosition === 'user' || !d.injectPosition ? ' selected' : '') + '>用户消息末尾（推荐）</option>',
            '</select></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">单套模式模板 <span class="om-hint">（User选了1套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{description}} → 替换为穿搭的文字描述</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-single" rows="3">' + esc(d.singleTemplate) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">衣柜模式模板 <span class="om-hint">（User选了多套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{wardrobe}} → 替换为所有已选穿搭的列表</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-multi" rows="5">' + esc(d.multiTemplate) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">角色单套模板 <span class="om-hint">（角色选了1套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{description}} → 描述</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-char-single" rows="3">' + esc(d.charSingleTemplate || '【{{charName}}的穿搭】\n{{description}}') + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">角色衣柜模板 <span class="om-hint">（角色选了多套时生效）</span></div>',
            '<div class="om-hint" style="margin-bottom:6px">{{charName}} → 角色名 / {{wardrobe}} → 穿搭列表</div>',
            '<div class="om-setting-row"><textarea id="om-tpl-char-multi" rows="5">' + esc(d.charMultiTemplate || '【{{charName}}的穿搭】\n{{wardrobe}}') + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">图片模式补充提示</div>',
            '<div class="om-setting-row"><label>单套+图片</label><textarea id="om-imgprompt" rows="2">' + esc(d.imagePrompt) + '</textarea></div>',
            '<div class="om-setting-row" style="margin-top:6px"><label>衣柜+图片</label><textarea id="om-multi-imgprompt" rows="2">' + esc(d.multiImagePrompt) + '</textarea></div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">分类管理</div>',
            '<button class="om-btn om-btn-outline" id="om-open-cats" style="width:100%;text-align:left"><i class="fa-solid fa-tags" style="margin-right:7px"></i>管理分类…</button>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">数据</div>',
            '<div class="om-storage-info">' + d.outfits.length + ' 套穿搭 / ' + imgCount + ' 张图片 / ' + (d.presets ? d.presets.length : 0) + ' 个预设 | 酒馆共享存储</div>',
            '<div class="om-btn-row" style="margin-top:8px">',
            '<button class="om-btn om-btn-outline" id="om-exp"><i class="fa-solid fa-download"></i> 导出</button>',
            '<button class="om-btn om-btn-outline" id="om-imp"><i class="fa-solid fa-upload"></i> 导入</button>',
            '<button class="om-btn om-btn-danger" id="om-clear">清空穿搭</button>',
            '</div>',

            '<div class="om-divider"></div>',
            '<div class="om-sec-title">悬浮球</div>',
            '<div class="om-setting-row om-row-inline"><label>显示悬浮球</label><input type="checkbox" class="om-chk" id="om-show-ball"' + (d.showBall !== false ? ' checked' : '') + ' /></div>',
            '<div class="om-divider"></div>',
            '<div class="om-sec-title">调试</div>',
            '<div class="om-setting-row om-row-inline"><label>注入时显示 Toast 提示</label><input type="checkbox" class="om-chk" id="om-debug"' + (d.debug ? ' checked' : '') + ' /></div>',
        ].join(''));

        sheet.querySelector('#om-mode').addEventListener('change', function () { var dd = load(); dd.mode = this.value; save(dd); });
        sheet.querySelector('#om-inject-pos').addEventListener('change', function () { var dd = load(); dd.injectPosition = this.value; save(dd); });
        sheet.querySelector('#om-auto-roll').addEventListener('change', function () { var dd = load(); dd.autoRollDisabled = !this.checked; save(dd); });
        sheet.querySelector('#om-tpl-single').addEventListener('input', function () { var dd = load(); dd.singleTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-multi').addEventListener('input', function () { var dd = load(); dd.multiTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-char-single').addEventListener('input', function () { var dd = load(); dd.charSingleTemplate = this.value; save(dd); });
        sheet.querySelector('#om-tpl-char-multi').addEventListener('input', function () { var dd = load(); dd.charMultiTemplate = this.value; save(dd); });
        sheet.querySelector('#om-imgprompt').addEventListener('input', function () { var dd = load(); dd.imagePrompt = this.value; save(dd); });
        sheet.querySelector('#om-multi-imgprompt').addEventListener('input', function () { var dd = load(); dd.multiImagePrompt = this.value; save(dd); });

        sheet.querySelector('#om-show-ball').addEventListener('change', function () {
            var dd = load(); dd.showBall = this.checked; save(dd);
            var oldFab = document.getElementById(FAB_ID); if (oldFab) oldFab.parentNode.removeChild(oldFab);
            if (dd.showBall) injectFab();
        });
        sheet.querySelector('#om-debug').addEventListener('change', function () { var dd = load(); dd.debug = this.checked; save(dd); });
        sheet.querySelector('#om-exp').addEventListener('click', exportData);
        sheet.querySelector('#om-imp').addEventListener('click', importData);
        sheet.querySelector('#om-clear').addEventListener('click', function () {
            var dd = load();
            var label = dd.currentView === 'char' && dd.currentChar ? '「' + dd.currentChar + '」的穿搭' : 'User 的穿搭';
            if (!confirm('确定清空' + label + '？（其他数据不受影响）')) return;
            if (dd.currentView === 'char' && dd.currentChar) {
                var cd = getCharData(dd, dd.currentChar);
                cd.outfits = []; cd.categories = []; cd.activeIds = [];
            } else {
                dd.outfits = []; dd.categories = []; dd.activeIds = [];
            }
            save(dd); closeSheet(sheet); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn(); toast('已清空');
        });
        sheet.querySelector('#om-open-cats').addEventListener('click', function () {
            closeSheet(sheet); openCatsSheet();
        });
    }

    // ── 分类管理 Bottom Sheet ─────────────────────────────────
    function openCatsSheet() {
        var d = load();
        var cats = getViewCategories(d);
        var viewOutfits = getViewOutfits(d);
        var viewLabel = d.currentView === 'char' && d.currentChar ? d.currentChar + '的' : 'User的';
        var listHTML = cats.length === 0
            ? '<div class="om-empty"><i class="fa-solid fa-tags"></i><span>还没有分类</span></div>'
            : cats.map(function (cat, idx) {
                var n = viewOutfits.filter(function (o) { return o.category === cat; }).length;
                return '<div class="om-cat-item"><span class="om-cat-name">' + esc(cat) + '</span><span class="om-cat-count">' + n + '套</span>' +
                    '<button class="om-btn-sm om-cat-ren" data-idx="' + idx + '" title="重命名"><i class="fa-solid fa-pen"></i></button>' +
                    '<button class="om-btn-sm om-cat-del" data-idx="' + idx + '" title="删除"><i class="fa-solid fa-trash"></i></button></div>';
            }).join('');

        var sheet = createSheet([
            '<div class="om-sheet-title"><i class="fa-solid fa-tags"></i>' + esc(viewLabel) + '分类管理</div>',
            listHTML,
            '<div class="om-divider"></div>',
            '<div class="om-cat-add-row"><input type="text" id="om-newcat" placeholder="新分类名称…" /><button class="om-btn om-btn-safe" id="om-newadd">添加</button></div>',
        ].join(''));

        var inp = sheet.querySelector('#om-newcat');
        sheet.querySelector('#om-newadd').addEventListener('click', function () {
            var name = inp.value.trim(); if (!name) return;
            var dd = load(); var vc = getViewCategories(dd);
            if (vc.indexOf(name) === -1) { vc.push(name); save(dd); inp.value = ''; closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('分类「' + name + '」已添加'); }
            else toast('分类已存在', true);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') sheet.querySelector('#om-newadd').click(); });

        sheet.querySelectorAll('.om-cat-ren').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var vc = getViewCategories(dd); var vo = getViewOutfits(dd);
                var idx = parseInt(btn.dataset.idx); var old = vc[idx];
                var nw = prompt('重命名（原：' + old + '）：', old); if (!nw || !nw.trim() || nw.trim() === old) return;
                nw = nw.trim(); vc[idx] = nw;
                vo.forEach(function (o) { if (o.category === old) o.category = nw; });
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已重命名');
            });
        });
        sheet.querySelectorAll('.om-cat-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var dd = load(); var vc = getViewCategories(dd); var vo = getViewOutfits(dd);
                var idx = parseInt(btn.dataset.idx); var name = vc[idx];
                if (!confirm('删除分类「' + name + '」？（穿搭不会被删除）')) return;
                vc.splice(idx, 1);
                vo.forEach(function (o) { if (o.category === name) o.category = ''; });
                if (curCat === name) curCat = '__all__';
                save(dd); closeSheet(sheet); renderCatbar(); openCatsSheet(); toast('已删除');
            });
        });
    }

    // ── Bottom Sheet 通用创建/关闭 ───────────────────────────
    function createSheet(contentHtml) {
        var ov = document.createElement('div');
        ov.className = 'om-sheet-overlay';
        ov.innerHTML = '<div class="om-sheet"><div class="om-sheet-handle"></div><div class="om-sheet-content">' + contentHtml + '</div></div>';
        getPopupLayer().appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(ov); });
        return ov;
    }

    function closeSheet(ov) {
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    // ── 全屏 Lightbox ─────────────────────────────────────────
    function openLightbox(outfits, startId) {
        if (!outfits || outfits.length === 0) return;
        var idx = 0;
        for (var i = 0; i < outfits.length; i++) { if (outfits[i].id === startId) { idx = i; break; } }

        var lb = document.createElement('div');
        lb.id = 'om-lightbox';
        lb.className = 'om-lightbox';
        lb.style.cssText = 'position:absolute !important;inset:0 !important;z-index:2 !important;pointer-events:auto !important;background:rgba(0,0,0,.92) !important;display:flex !important;align-items:center !important;justify-content:center !important;';

        function render() {
            var o = outfits[idx];
            lb.innerHTML =
                '<button class="om-lb-close" id="om-lb-close"><i class="fa-solid fa-xmark"></i></button>' +
                '<div class="om-lb-name">' + esc(o.name) + '</div>' +
                (outfits.length > 1 ? '<button class="om-lb-nav om-lb-prev" id="om-lb-prev"><i class="fa-solid fa-chevron-left"></i></button>' : '') +
                '<img class="om-lb-img" src="' + o.imageData + '" draggable="false" />' +
                (outfits.length > 1 ? '<button class="om-lb-nav om-lb-next" id="om-lb-next"><i class="fa-solid fa-chevron-right"></i></button>' : '') +
                (outfits.length > 1 ? '<div class="om-lb-counter">' + (idx + 1) + ' / ' + outfits.length + '</div>' : '');
            lb.querySelector('#om-lb-close').addEventListener('click', closeLb);
            var prev = lb.querySelector('#om-lb-prev'); var next = lb.querySelector('#om-lb-next');
            if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx - 1 + outfits.length) % outfits.length; render(); });
            if (next) next.addEventListener('click', function (e) { e.stopPropagation(); idx = (idx + 1) % outfits.length; render(); });
        }
        lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
        function closeLb() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', keyH); }
        function keyH(e) {
            if (e.key === 'Escape') closeLb();
            else if (e.key === 'ArrowLeft' && outfits.length > 1) { idx = (idx - 1 + outfits.length) % outfits.length; render(); }
            else if (e.key === 'ArrowRight' && outfits.length > 1) { idx = (idx + 1) % outfits.length; render(); }
        }
        document.addEventListener('keydown', keyH);
        render();
        getPopupLayer().appendChild(lb);
        lb.style.setProperty('pointer-events', 'auto', 'important');
    }

    // ── 导出 ──────────────────────────────────────────────────
    function doExport(data, filename) {
        try {
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename; document.body.appendChild(a); a.click();
            setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
        } catch (e) { toast('导出失败：' + e.message, true); }
    }

    function exportData() {
        var d = load();
        var isCharView = d.currentView === 'char' && d.currentChar;
        var modal = document.createElement('div');
        modal.className = 'om-modal ' + (darkMode ? 'om-dark' : 'om-light');
        modal.style.setProperty('z-index', '2147483647', 'important');

        var charBtns = '';
        if (isCharView) {
            charBtns =
                '<button class="om-modal-btn" id="om-exp-char-one"><i class="fa-solid fa-user" style="margin-right:8px"></i>导出「' + esc(d.currentChar) + '」<br><small style="opacity:.6;font-weight:400">当前角色的穿搭+分类</small></button>';
        }
        if (d.charNames && d.charNames.length > 0) {
            charBtns +=
                '<button class="om-modal-btn" id="om-exp-char-all"><i class="fa-solid fa-users" style="margin-right:8px"></i>导出全部角色<br><small style="opacity:.6;font-weight:400">所有角色的穿搭+分类</small></button>';
        }

        modal.innerHTML = '<div class="om-modal-box">' +
            '<div class="om-modal-title"><i class="fa-solid fa-download" style="margin-right:6px"></i>导出数据</div>' +
            '<button class="om-modal-btn" id="om-exp-all"><i class="fa-solid fa-database" style="margin-right:8px"></i>导出完整备份<br><small style="opacity:.6;font-weight:400">User+角色+预设+设置</small></button>' +
            '<button class="om-modal-btn" id="om-exp-user"><i class="fa-solid fa-shirt" style="margin-right:8px"></i>仅导出 User 穿搭<br><small style="opacity:.6;font-weight:400">User的穿搭+分类</small></button>' +
            charBtns +
            '<button class="om-modal-cancel" id="om-exp-cancel">取消</button></div>';
        var _mp = getPopupLayer();
        modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        _mp.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _mp.removeChild(modal); });
        modal.querySelector('#om-exp-cancel').addEventListener('click', function () { _mp.removeChild(modal); });

        // 导出完整备份
        document.getElementById('om-exp-all').addEventListener('click', function () {
            _mp.removeChild(modal);
            doExport(d, 'outfit-mgr-backup-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出完整数据');
        });

        // 导出User穿搭
        document.getElementById('om-exp-user').addEventListener('click', function () {
            _mp.removeChild(modal);
            doExport({ type: 'user', outfits: d.outfits, categories: d.categories }, 'outfit-mgr-user-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出 User 穿搭');
        });

        // 导出当前角色
        var expCharOne = document.getElementById('om-exp-char-one');
        if (expCharOne) expCharOne.addEventListener('click', function () {
            _mp.removeChild(modal);
            var cd = getCharData(d, d.currentChar);
            doExport({ type: 'char', charName: d.currentChar, outfits: cd.outfits, categories: cd.categories }, 'outfit-mgr-char-' + d.currentChar + '-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出「' + d.currentChar + '」');
        });

        // 导出全部角色
        var expCharAll = document.getElementById('om-exp-char-all');
        if (expCharAll) expCharAll.addEventListener('click', function () {
            _mp.removeChild(modal);
            var charExport = { type: 'chars_all', charNames: d.charNames, chars: {} };
            (d.charNames || []).forEach(function (cn) { charExport.chars[cn] = getCharData(d, cn); });
            doExport(charExport, 'outfit-mgr-all-chars-' + new Date().toISOString().slice(0, 10) + '.json');
            toast('✅ 已导出全部角色（' + d.charNames.length + '个）');
        });
    }

    function importData() {
        var modal = document.createElement('div');
        modal.className = 'om-modal';
        modal.style.setProperty('z-index', '2147483647', 'important');
        modal.innerHTML = '<div class="om-modal-box">' +
            '<div class="om-modal-title"><i class="fa-solid fa-upload" style="margin-right:6px"></i>导入数据</div>' +
            '<div class="om-hint" style="margin-bottom:10px">选择之前导出的 .json 文件。</div>' +
            '<button class="om-modal-btn" id="om-imp-merge"><i class="fa-solid fa-code-merge" style="margin-right:8px"></i>合并导入<br><small style="opacity:.6;font-weight:400">追加到现有数据，不覆盖</small></button>' +
            '<button class="om-modal-btn" id="om-imp-replace"><i class="fa-solid fa-arrows-rotate" style="margin-right:8px"></i>覆盖导入<br><small style="opacity:.6;font-weight:400">替换现有穿搭（预设保留）</small></button>' +
            '<input type="file" id="om-imp-file" accept=".json" style="display:none" />' +
            '<button class="om-modal-cancel" id="om-imp-cancel">取消</button></div>';
        var _mp2 = getPopupLayer();
        modal.style.cssText = 'position:absolute !important;inset:0 !important;z-index:1 !important;background:rgba(0,0,0,.45) !important;display:flex !important;align-items:center !important;justify-content:center !important;padding:20px !important;box-sizing:border-box !important;pointer-events:auto !important;';
        _mp2.appendChild(modal);
        modal.addEventListener('click', function (e) { if (e.target === modal) _mp2.removeChild(modal); });
        modal.querySelector('#om-imp-cancel').addEventListener('click', function () { _mp2.removeChild(modal); });
        var fileInp = document.getElementById('om-imp-file');
        var importMode = 'merge';
        function triggerImport(mode) { importMode = mode; fileInp.click(); }
        document.getElementById('om-imp-merge').addEventListener('click', function () { triggerImport('merge'); });
        document.getElementById('om-imp-replace').addEventListener('click', function () { triggerImport('replace'); });
        fileInp.addEventListener('change', function () {
            var file = fileInp.files[0]; if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                try { var imported = JSON.parse(e.target.result); _mp2.removeChild(modal); processImport(imported, importMode); }
                catch (err) { toast('文件解析失败，请确认是有效的 JSON 文件', true); }
            };
            reader.onerror = function () { toast('文件读取失败', true); };
            reader.readAsText(file, 'utf-8');
        });
    }

    function processImport(imported, mode) {
        var dd = load();
        try {
            // 1. 预设导入
            if (imported.type === 'preset' && imported.preset) {
                var p = imported.preset; p.id = genId();
                if (!Array.isArray(dd.presets)) dd.presets = [];
                dd.presets.push(p); save(dd); renderGrid(); toast('✅ 已导入预设：' + p.name); return;
            }

            // 2. 单个角色导入
            if (imported.type === 'char' && imported.charName) {
                var cn = imported.charName;
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var srcO = (imported.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); });
                var srcC = imported.categories || [];
                if (mode === 'replace') {
                    dd.chars[cn] = { outfits: srcO, categories: srcC, activeIds: [] };
                } else {
                    var cd = getCharData(dd, cn);
                    srcO.forEach(function (o) { cd.outfits.push(o); });
                    srcC.forEach(function (c) { if (cd.categories.indexOf(c) === -1) cd.categories.push(c); });
                }
                if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
                toast('✅ 已导入角色「' + cn + '」（' + srcO.length + '套穿搭）');
                return;
            }

            // 3. 全部角色导入
            if (imported.type === 'chars_all' && imported.chars) {
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var importedNames = imported.charNames || Object.keys(imported.chars);
                var totalOutfits = 0;
                importedNames.forEach(function (cn) {
                    var src = imported.chars[cn]; if (!src) return;
                    var srcO2 = (src.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); });
                    var srcC2 = src.categories || [];
                    if (mode === 'replace') {
                        dd.chars[cn] = { outfits: srcO2, categories: srcC2, activeIds: [] };
                    } else {
                        var cd2 = getCharData(dd, cn);
                        srcO2.forEach(function (o) { cd2.outfits.push(o); });
                        srcC2.forEach(function (c) { if (cd2.categories.indexOf(c) === -1) cd2.categories.push(c); });
                    }
                    if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                    totalOutfits += srcO2.length;
                });
                save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus();
                toast('✅ 已导入 ' + importedNames.length + ' 个角色（共 ' + totalOutfits + ' 套穿搭）');
                return;
            }

            // 4. User穿搭导入（type='user' 或旧格式无type）
            var srcOutfits = imported.outfits || [], srcCats = imported.categories || [], srcPresets = imported.presets || [];
            if (mode === 'replace') {
                dd.outfits = srcOutfits.map(function (o) { return Object.assign({}, o, { id: genId() }); });
                dd.categories = srcCats.slice(); dd.activeIds = [];
            } else {
                srcOutfits.forEach(function (o) { dd.outfits.push(Object.assign({}, o, { id: genId() })); });
                srcCats.forEach(function (c) { if (dd.categories.indexOf(c) === -1) dd.categories.push(c); });
                if (srcPresets.length > 0) {
                    if (!Array.isArray(dd.presets)) dd.presets = [];
                    srcPresets.forEach(function (p2) { if (p2) dd.presets.push(Object.assign({}, p2, { id: genId() })); });
                }
            }

            // 如果是完整备份（含chars），也导入角色数据
            if (imported.chars) {
                if (!dd.chars) dd.chars = {};
                if (!dd.charNames) dd.charNames = [];
                var impNames = imported.charNames || Object.keys(imported.chars);
                impNames.forEach(function (cn) {
                    var src2 = imported.chars[cn]; if (!src2) return;
                    dd.chars[cn] = {
                        outfits: (src2.outfits || []).map(function (o) { return Object.assign({}, o, { id: genId() }); }),
                        categories: src2.categories || [],
                        activeIds: []
                    };
                    if (dd.charNames.indexOf(cn) === -1) dd.charNames.push(cn);
                });
            }

            save(dd); renderViewbar(); renderCatbar(); renderGrid(); renderBottomStatus(); updateBtn();
            toast('✅ 导入成功：' + dd.outfits.length + ' 套穿搭');
        } catch (err) { toast('导入处理失败：' + err.message, true); }
    }

    // ── FAB（悬浮球）────────────────────────────────────────
    var fabResizeHandler = null;

    function injectFab() {
        if (document.getElementById(FAB_ID)) return;
        var d = load(); if (d.showBall === false) return;
        var container = document.createElement('div'); container.id = FAB_ID;
        var MAIN_SIZE = 38;
        var accent = 'var(--SmartThemeQuoteColor,#7c6daf)';

        function posFab() {
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var vw = window.innerWidth || document.documentElement.clientWidth;
            var mainTop = vh - 80 - MAIN_SIZE; var mainLeft = vw - 16 - MAIN_SIZE;
            if (mainTop < 10) mainTop = 10; if (mainLeft < 10) mainLeft = 10;
            container.setAttribute('style',
                'position:fixed !important;top:' + mainTop + 'px !important;left:' + mainLeft + 'px !important;' +
                'z-index:2147483647 !important;display:flex !important;align-items:center !important;' +
                'pointer-events:none !important;margin:0 !important;padding:0 !important;');
        }

        var mainBtn = document.createElement('div'); mainBtn.id = 'om-fab-main-btn';
        mainBtn.innerHTML = '<i class="fa-solid fa-shirt" style="pointer-events:none;font-size:1.1em;"></i>';

        function styleMainBtn() {
            mainBtn.setAttribute('style',
                'width:' + MAIN_SIZE + 'px !important;height:' + MAIN_SIZE + 'px !important;border-radius:50% !important;' +
                'background:' + accent + ' !important;color:#fff !important;border:none !important;cursor:pointer !important;' +
                'display:flex !important;align-items:center !important;justify-content:center !important;' +
                'font-size:1.2em !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;opacity:.9 !important;' +
                'visibility:visible !important;pointer-events:auto !important;margin:0 !important;padding:0 !important;' +
                'flex-shrink:0 !important;transition:transform .2s !important;position:relative !important;z-index:1 !important;');
        }
        styleMainBtn();

        container.appendChild(mainBtn);

        // 拖拽 + 点击判断
        var _dragState = { sx: 0, sy: 0, ox: 0, oy: 0, moved: false };
        mainBtn.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            _dragState.sx = t.clientX; _dragState.sy = t.clientY;
            var rect = container.getBoundingClientRect();
            _dragState.ox = rect.left; _dragState.oy = rect.top;
            _dragState.moved = false;
        }, { passive: true });
        mainBtn.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            var dx = t.clientX - _dragState.sx, dy = t.clientY - _dragState.sy;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _dragState.moved = true;
            if (_dragState.moved) {
                var nx = _dragState.ox + dx, ny = _dragState.oy + dy;
                var vw = window.innerWidth, vh = window.innerHeight;
                nx = Math.max(0, Math.min(nx, vw - MAIN_SIZE));
                ny = Math.max(0, Math.min(ny, vh - MAIN_SIZE));
                container.style.setProperty('left', nx + 'px', 'important');
                container.style.setProperty('top', ny + 'px', 'important');
            }
        }, { passive: true });
        mainBtn.addEventListener('touchend', function (e) {
            if (!_dragState.moved) {
                _dragState.handled = true;
                e.preventDefault(); // 阻止后续 click 事件
                // 延迟打开，等触摸事件完全结束
                setTimeout(function () { openPopup(); }, 50);
            }
        });
        // PC端点击
        mainBtn.addEventListener('click', function (e) {
            if (_dragState.handled) { _dragState.handled = false; return; }
            if (_dragState.moved) { _dragState.moved = false; return; }
            openPopup();
        });

        posFab();
        if (fabResizeHandler) window.removeEventListener('resize', fabResizeHandler);
        fabResizeHandler = posFab;
        window.addEventListener('resize', fabResizeHandler);
        document.body.appendChild(container);
    }

    function closeFab() { /* no-op, fab is now single button */ }

    // ── 请求注入核心 ──────────────────────────────────────────
    // position: 'system' | 'context' | 'user'
    //   system  = 追加到第一条 system message 末尾（原有行为）
    //   context = 在最后一条 user message 之前插入一条 system message（类似 author's note）
    //   user    = 追加到最后一条 user message 文本末尾
    function injectText(p, text, position) {
        if (!p.messages || !Array.isArray(p.messages)) {
            // 兼容 prompt 模式
            if (typeof p.prompt === 'string') p.prompt = text + '\n\n' + p.prompt;
            return;
        }

        if (position === 'user') {
            // 追加到最后一条 user 消息末尾
            for (var j = p.messages.length - 1; j >= 0; j--) {
                if (p.messages[j].role === 'user') {
                    var c = p.messages[j].content;
                    if (typeof c === 'string') p.messages[j].content = c + '\n\n' + text;
                    else if (Array.isArray(c)) c.push({ type: 'text', text: '\n\n' + text });
                    break;
                }
            }
        } else if (position === 'context') {
            // 在最后一条 user 消息之前插入 system 消息
            var lastUserIdx = -1;
            for (var k = p.messages.length - 1; k >= 0; k--) {
                if (p.messages[k].role === 'user') { lastUserIdx = k; break; }
            }
            var sysMsg = { role: 'system', content: text };
            if (lastUserIdx > 0) p.messages.splice(lastUserIdx, 0, sysMsg);
            else if (lastUserIdx === 0) p.messages.unshift(sysMsg);
            else p.messages.push(sysMsg);
        } else {
            // system: 追加到第一条 system message 末尾
            var si = -1; for (var i = 0; i < p.messages.length; i++) { if (p.messages[i].role === 'system') { si = i; break; } }
            if (si !== -1) {
                var sm = p.messages[si];
                if (typeof sm.content === 'string') sm.content += '\n\n' + text;
                else if (Array.isArray(sm.content)) sm.content.push({ type: 'text', text: '\n\n' + text });
            } else { p.messages.unshift({ role: 'system', content: text }); }
        }
    }

    function injectImages(p, imgs) {
        if (!p.messages || !Array.isArray(p.messages)) return;
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                var blocks = imgs.map(function (img) { return { type: 'image_url', image_url: { url: img } }; });
                if (typeof c === 'string') p.messages[j].content = [{ type: 'text', text: c }].concat(blocks);
                else if (Array.isArray(c)) blocks.forEach(function (b) { c.push(b); });
                break;
            }
        }
    }

    // ★ v19新增：按owner交错注入 文字标签+图片，让AI知道每张图属于谁
    // ★ v21改进：在末尾注入图片提示词模板（风格引导）
    function injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt) {
        if (!p.messages || !Array.isArray(p.messages)) return;
        for (var j = p.messages.length - 1; j >= 0; j--) {
            if (p.messages[j].role === 'user') {
                var c = p.messages[j].content;
                // 确保content是数组格式
                if (typeof c === 'string') {
                    c = [{ type: 'text', text: c }];
                    p.messages[j].content = c;
                }

                // 添加总标题
                if (ownerImageGroups.length > 1) {
                    c.push({ type: 'text', text: '\n\n=== 穿搭图片参考 ===' });
                }

                var hasMulti = false;
                ownerImageGroups.forEach(function (grp) {
                    if (grp.isMulti) {
                        hasMulti = true;
                        // 同一owner多套衣柜
                        c.push({ type: 'text', text: '\n[' + grp.name + '的可选穿搭 - 共' + grp.outfits.length + '套]' });
                        grp.outfits.forEach(function (o, i) {
                            c.push({ type: 'text', text: '\n(' + (i + 1) + ') ' + o.name + (o.sceneTag ? ' [场景：' + o.sceneTag + ']' : '') + '：' });
                            c.push({ type: 'image_url', image_url: { url: o.imageData } });
                        });
                    } else {
                        // 单套
                        var o = grp.outfits[0];
                        c.push({ type: 'text', text: '\n[' + grp.name + '当前穿着]' });
                        c.push({ type: 'image_url', image_url: { url: o.imageData } });
                    }
                });

                // 注入图片提示词模板（风格引导）
                var prompt = hasMulti ? multiImgPrompt : imgPrompt;
                if (prompt) {
                    c.push({ type: 'text', text: '\n' + prompt });
                }

                if (ownerImageGroups.length > 1) {
                    c.push({ type: 'text', text: '\n=== 穿搭图片结束 ===' });
                }
                break;
            }
        }
    }

    function setupInjection() {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                if (init && init.body && typeof init.body === 'string') {
                    var nb = tryInjectBody(init.body);
                    if (nb) { init = Object.assign({}, init, { body: nb }); return origFetch.call(this, input, init); }
                }
            } catch (e) {}
            return origFetch.apply(this, arguments);
        };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
            try { if (body && typeof body === 'string') { var nb = tryInjectBody(body); if (nb) return origSend.call(this, nb); } } catch (e) {}
            return origSend.apply(this, arguments);
        };
    }

    function tryInjectBody(bodyStr) {
        var p; try { p = JSON.parse(bodyStr); } catch (e) { return null; }
        if (!p || (!p.messages && p.prompt === undefined)) return null;
        var d = load();
        var pos = d.injectPosition || 'user';
        var useImg = (d.mode === 'image' || d.mode === 'both');
        var useText = (d.mode === 'text' || d.mode === 'both');

        // 收集所有owner及其激活穿搭
        var owners = [];
        // User
        var userOutfits = [];
        (d.activeIds || []).forEach(function (id) { for (var i = 0; i < d.outfits.length; i++) { if (d.outfits[i].id === id) { userOutfits.push(d.outfits[i]); break; } } });
        if (userOutfits.length > 0) owners.push({ name: 'User', outfits: userOutfits, tplSingle: d.singleTemplate, tplMulti: d.multiTemplate });
        // Chars
        if (d.chars) {
            for (var cn in d.chars) {
                var cd = d.chars[cn];
                var cos = [];
                (cd.activeIds || []).forEach(function (id) { for (var k = 0; k < (cd.outfits || []).length; k++) { if (cd.outfits[k].id === id) { cos.push(cd.outfits[k]); break; } } });
                if (cos.length > 0) owners.push({ name: cn, outfits: cos, tplSingle: d.charSingleTemplate, tplMulti: d.charMultiTemplate });
            }
        }

        if (owners.length === 0) return null;

        // ★ v19核心改动：先收集所有文本和图片，合并成一条再注入
        var allTextParts = [];
        // 图片模式：按owner收集，保留归属信息
        var ownerImageGroups = []; // [{ name, outfits: [{name, imageData, sceneTag}], isMulti }]

        owners.forEach(function (ow) {
            var active = ow.outfits;
            var isMulti = active.length > 1;

            if (isMulti) {
                var lines = active.map(function (o, i) {
                    var scene = o.sceneTag ? '【场景：' + o.sceneTag + '】' : '';
                    var desc = (o.description && o.description.trim()) ? o.description.trim() : o.name;
                    return '[' + (i + 1) + '] ' + o.name + ' ' + scene + '\n描述：' + desc;
                });
                if (useText) {
                    var wt = (ow.tplMulti || '[服装信息]\n{{charName}}的穿搭：\n{{wardrobe}}')
                        .replace(/\{\{charName\}\}/g, ow.name)
                        .replace('{{wardrobe}}', lines.join('\n\n'));
                    allTextParts.push(wt);
                }
                if (useImg) {
                    var imgOutfits = active.filter(function (o) { return !!o.imageData; });
                    if (imgOutfits.length > 0) ownerImageGroups.push({ name: ow.name, outfits: imgOutfits, isMulti: true });
                }
            } else {
                var o = active[0];
                if (useText) {
                    var desc2 = (o.description && o.description.trim()) ? o.description.trim() : o.name;
                    var st = (ow.tplSingle || '[服装信息]\n{{charName}}当前穿着：\n{{description}}')
                        .replace(/\{\{charName\}\}/g, ow.name)
                        .replace('{{description}}', desc2);
                    allTextParts.push(st);
                }
                if (useImg && o.imageData) { ownerImageGroups.push({ name: ow.name, outfits: [o], isMulti: false }); }
            }
        });

        var injected = false;

        // 合并所有文本为一条，用分隔线隔开
        if (allTextParts.length > 0) {
            var mergedText;
            if (allTextParts.length === 1) {
                mergedText = allTextParts[0];
            } else {
                // 多个owner时加总包裹
                mergedText = '=== 当前场景服装信息（必须严格遵守，不可自行编造服装）===\n\n' + allTextParts.join('\n\n---\n\n') + '\n\n=== 服装信息结束 ===';
            }
            injectText(p, mergedText, pos);
            injected = true;
        }

        // ★ 图片注入：按owner交错注入文字标签+图片，让AI知道哪张图属于谁
        if (ownerImageGroups.length > 0) {
            var imgPrompt = d.imagePrompt || '';
            var multiImgPrompt = d.multiImagePrompt || '';
            injectImageBlocks(p, ownerImageGroups, imgPrompt, multiImgPrompt);
            injected = true;
        }

        if (d.debug) {
            var summary = owners.map(function (ow) { return ow.name + ':' + ow.outfits.length + '套'; }).join(' + ');
            toast('👗 ' + summary + ' [' + d.mode + '|' + pos + ']');
        }

        return injected ? JSON.stringify(p) : null;
    }

    // ── 侧栏按钮 ──────────────────────────────────────────────
    function updateBtn() {
        var btn = document.getElementById(BTN_ID); if (!btn) return;
        var d = load();
        var names = []; d.activeIds.forEach(function (id) { var o = getById(d, id); if (o) names.push(o.name); });
        var span = btn.querySelector('span');
        if (span) {
            if (names.length === 0) span.textContent = SCRIPT_NAME;
            else if (names.length === 1) span.textContent = names[0];
            else span.textContent = '衣柜(' + names.length + '套)';
        }
        btn.style.color = names.length > 0 ? 'var(--SmartThemeQuoteColor)' : '';
    }

    function findMenu() {
        var m = document.getElementById('extensionsMenu'); if (m) return m;
        m = document.getElementById('extensions_menu'); if (m) return m;
        var items = document.querySelectorAll('.list-group-item.interactable');
        for (var i = 0; i < items.length; i++) { var t = items[i].textContent || ''; if (t.indexOf('CSS') !== -1 || t.indexOf('头像框') !== -1 || t.indexOf('变量管理') !== -1) return items[i].parentElement; }
        return null;
    }

    function injectBtn() {
        if (document.getElementById(BTN_ID)) return;
        var menu = findMenu(); if (!menu) return;
        var d = load(); var names = []; d.activeIds.forEach(function (id) { var o = getById(d, id); if (o) names.push(o.name); });
        var btn = document.createElement('div');
        btn.id = BTN_ID; btn.className = 'list-group-item flex-container flexGap5 interactable'; btn.title = SCRIPT_NAME;
        if (names.length > 0) btn.style.color = 'var(--SmartThemeQuoteColor)';
        btn.innerHTML = '<i class="fa-solid fa-shirt"></i><span>' + esc(names.length === 1 ? names[0] : names.length > 1 ? '衣柜(' + names.length + '套)' : SCRIPT_NAME) + '</span>';
        btn.addEventListener('click', openPopup);
        menu.appendChild(btn);
    }

    // ── 扩展设置面板入口 ──
    function injectSettingsEntry() {
        if (document.getElementById('om-settings-entry')) return;
        var container = document.getElementById('extensions_settings');
        if (!container) { setTimeout(injectSettingsEntry, 500); return; }
        var entry = document.createElement('div');
        entry.id = 'om-settings-entry';
        entry.className = 'om-settings-entry';
        entry.innerHTML =
            '<div class="inline-drawer-toggle inline-drawer-header">' +
            '<b><i class="fa-solid fa-shirt"></i> ' + SCRIPT_NAME + '</b>' +
            '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
            '</div>' +
            '<div class="inline-drawer-content">' +
            '<div class="om-settings-entry__buttons" style="display:flex;flex-direction:column;gap:6px;padding:4px 0">' +
            '<button class="menu_button om-settings-entry__open" type="button" style="width:100%"><i class="fa-solid fa-up-right-from-square"></i> 打开衣柜</button>' +
            '<button class="menu_button om-settings-entry__console" type="button" style="width:100%"><i class="fa-solid fa-terminal"></i> 打开控制台</button>' +
            '</div>' +
            '</div>';
        entry.querySelector('.om-settings-entry__open').addEventListener('click', openPopup);
        entry.querySelector('.om-settings-entry__console').addEventListener('click', function() {
            // Open the console/popup with console tab
            openPopup();
        });
        container.appendChild(entry);
    }

    // ── 启动 ──────────────────────────────────────────────────
    injectStyles();
    setupInjection();
    setTimeout(injectBtn, 500);
    setInterval(injectBtn, 2000);
    setTimeout(injectFab, 1500);
    setInterval(function () { if (!document.getElementById(FAB_ID)) injectFab(); }, 3000);
    setTimeout(injectSettingsEntry, 500);
    setInterval(function () { if (!document.getElementById('om-settings-entry')) injectSettingsEntry(); }, 3000);

    loadFromDB(function (d) {
        // Auto-roll: if nothing active, pick random world book style
        if ((!d.activeIds || d.activeIds.length === 0) && !d.autoRollDisabled) {
            var allWB = [];
            if (typeof worldBookStylesModern !== 'undefined') allWB = allWB.concat(worldBookStylesModern);
            if (typeof worldBookStylesLingerie !== 'undefined') allWB = allWB.concat(worldBookStylesLingerie);
            if (allWB.length > 0) {
                var pick = allWB[Math.floor(Math.random() * allWB.length)];
                var o = { id: genId(), name: pick.name, category: pick.scene || '', type: 'outfit', style: pick.style || '', season: pick.season || '', sceneTag: pick.scene || '', description: pick.desc || '', imageData: null, isVirtual: true, createdAt: Date.now() };
                d.virtualOutfits[o.id] = o;
                d.activeIds = [o.id];
                save(d);
                if (typeof toast !== 'undefined') setTimeout(function() { toast('今日穿搭：「' + pick.name + '」（' + (pick.style || '') + '·' + (pick.scene || '') + '）', false, 4000); }, 3500);
            }
        } else if (d.activeIds && d.activeIds.length > 0) {
            // Show existing active outfit on restart
            var names = [];
            d.activeIds.forEach(function (id) {
                var o = getById(d, id);
                if (o) names.push(o.name);
            });
            if (names.length > 0 && typeof toast !== 'undefined') setTimeout(function() { toast('今日穿搭：「' + names.join('、') + '」', false, 4000); }, 3500);
        }
        dataCache = d;
        var lsData = loadFromLS();
        if (lsData && lsData.outfits && lsData.outfits.length > 0 && (!d.outfits || d.outfits.length === 0)) {
            dataCache = ensureDefaults(lsData);
            saveToDB(dataCache, function () { try { localStorage.removeItem('outfit_mgr_v4'); } catch (e) {} });
        }
        updateBtn();
    });

})();
