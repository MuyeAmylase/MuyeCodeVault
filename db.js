// ==================== MuyeStorageDB 统一数据库模块 ====================
// 数据库名称：MuyeStorageDB
// 使用方式：<script src="db.js"></script>  后直接调用全局函数或 MuyeDB.xxx()

(function () {
    'use strict';

    const DB_NAME = 'MuyeStorageDB';
    const DB_VERSION = 1;               // 新数据库从版本1开始，通过迁移一次性建立所有表
    const OLD_DB_NAME = 'MuyeChat7403DB';   // 旧版数据库

    // ---------- 全局数据库实例 ----------
    let db = null;

    // ======================== 数据库打开与升级 ========================
    async function openDB() {
        if (db) return db;      // 已经打开过则复用

        // 先检查是否需要迁移旧数据库
        await migrateIfNeeded();

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const database = e.target.result;

                // 创建所有需要的对象存储（如果尚未存在）
                const stores = [
                    'songs', 'settings', 'chats', 'worldbook', 'memory', 'notes',
                    'emote_groups', 'fonts'
                ];

                stores.forEach(storeName => {
                    if (!database.objectStoreNames.contains(storeName)) {
                        // 根据各表需求设置 keyPath 和索引
                        switch (storeName) {
                            case 'songs':
                                const songsStore = database.createObjectStore('songs', {
                                    keyPath: 'id',
                                    autoIncrement: true
                                });
                                songsStore.createIndex('order', 'order', { unique: false });
                                break;
                            case 'settings':
                                database.createObjectStore('settings', { keyPath: 'id' });
                                break;
                            case 'emote_groups':
                                database.createObjectStore('emote_groups', { keyPath: 'id' });
                                break;
                            case 'fonts':
                                const fontsStore = database.createObjectStore('fonts', { keyPath: 'id' });
                                fontsStore.createIndex('type', 'type', { unique: false });
                                break;
                            default:
                                // chats, worldbook, memory, notes 都用简单主键
                                database.createObjectStore(storeName, { keyPath: 'id' });
                        }
                    }
                });
            };

            request.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = function (e) {
                reject(e.target.error);
            };

            request.onblocked = function () {
                console.warn('数据库升级被阻塞，请关闭其他标签页后刷新。');
                reject(new Error('数据库被阻塞'));
            };
        });
    }

    // ---------- 旧数据库迁移 ----------
    async function migrateIfNeeded() {
        // 检查是否已经迁移过
        const hasMigrated = localStorage.getItem('muye_storage_migrated_v1');
        if (hasMigrated === 'true') return;

        // 检查旧数据库是否存在
        if (!(await databaseExists(OLD_DB_NAME)) && !(await databaseExists('EmoteWarehouseDB'))) {
            // 没有任何旧数据库，直接标记已迁移
            localStorage.setItem('muye_storage_migrated_v1', 'true');
            return;
        }

        try {
            // 打开新数据库（如果版本为1，此时会触发 onupgradeneeded 创建表）
            const database = await new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('blocked'));
            });

            // 迁移 MuyeChat7403DB 中的表
            if (await databaseExists(OLD_DB_NAME)) {
                const oldDB = await new Promise((resolve, reject) => {
                    const req = indexedDB.open(OLD_DB_NAME);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                const storesToMigrate = ['songs', 'settings', 'chats', 'worldbook', 'memory', 'notes'];
                for (const storeName of storesToMigrate) {
                    if (oldDB.objectStoreNames.contains(storeName)) {
                        const data = await getAllFromDB(oldDB, storeName);
                        if (data && data.length > 0) {
                            await putAllToDB(database, storeName, data);
                        }
                    }
                }
                oldDB.close();
            }

            // 迁移 EmoteWarehouseDB 中的表情包分组
            if (await databaseExists('EmoteWarehouseDB')) {
                const emoteDB = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('EmoteWarehouseDB');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                if (emoteDB.objectStoreNames.contains('groups')) {
                    const groups = await getAllFromDB(emoteDB, 'groups');
                    if (groups && groups.length > 0) {
                        await putAllToDB(database, 'emote_groups', groups);
                    }
                }
                emoteDB.close();
            }

            // 标记迁移完成
            localStorage.setItem('muye_storage_migrated_v1', 'true');
            database.close();
        } catch (e) {
            console.error('数据库迁移失败：', e);
            // 迁移失败不阻止后续使用，下次会再次尝试
        }
    }

    // ---------- 辅助函数：检查数据库是否存在 ----------
    function databaseExists(dbName) {
        return new Promise((resolve) => {
            const req = indexedDB.open(dbName);
            req.onsuccess = function () {
                req.result.close();
                resolve(true);
            };
            req.onerror = function () {
                resolve(false);
            };
            req.onblocked = function () {
                resolve(false);
            };
        });
    }

    // ---------- 辅助函数：从数据库读取某表全部数据 ----------
    function getAllFromDB(database, storeName) {
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ---------- 辅助函数：批量写入数据 ----------
    function putAllToDB(database, storeName, items) {
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            items.forEach(item => store.put(item));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ======================== 通用数据库操作（MuyeDB） ========================
    async function getAll(storeName) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function get(storeName, id) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function put(storeName, item) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function remove(storeName, id) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function clear(storeName) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ======================== 便捷设置方法（兼容旧版） ========================
    async function getSettings() {
        const settings = await get('settings', 'global');
        return settings || {
            id: 'global',
            allowCodeVaultAccess: false,
            codeVaultGroupName: 'AI 记忆'
        };
    }

    async function saveSettings(settingsObj) {
        if (!settingsObj.id) settingsObj.id = 'global';
        return put('settings', settingsObj);
    }

    // ======================== 表情包仓库专用方法（全局函数，兼容原表情包工作台） ========================
    window.loadAllGroups = async function () {
        return await getAll('emote_groups');
    };

    window.addGroup = async function (group) {
        return await put('emote_groups', group);
    };

    window.updateGroup = async function (group) {
        return await put('emote_groups', group);
    };

    window.deleteGroup = async function (id) {
        return await remove('emote_groups', id);
    };

    window.deleteMultipleGroups = async function (ids) {
        const database = await openDB();
        const tx = database.transaction('emote_groups', 'readwrite');
        const store = tx.objectStore('emote_groups');
        ids.forEach(id => store.delete(id));
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    };

    window.clearAllData = async function () {
        return await clear('emote_groups');
    };

    // 存储空间估算（通用）
    window.getStorageEstimate = async function () {
        if (navigator.storage && navigator.storage.estimate) {
            return await navigator.storage.estimate();
        }
        return { usage: 0, quota: 0 };
    };

    // 字节格式化工具函数
    window.formatBytes = function (bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 保留原来的 openDB 全局函数（返回实例，供原有 getStore 等使用）
    window.openDB = openDB;

    // 为了兼容某些可能存在的代码，暴露一个 getStore 函数（但不再推荐使用）
    window.getStore = function (storeName, mode = 'readonly') {
        // 注意：由于 db 实例已经通过 openDB 获取，此函数为简化版，建议直接用 MuyeDB
        throw new Error('不建议使用 getStore，请使用 MuyeDB 或专用函数');
    };

    // ======================== 字体收藏专用方法（供字体预览工具使用） ========================
    window.loadFonts = async function () {
        return await getAll('fonts');
    };

    window.addFont = async function (fontItem) {
        return await put('fonts', fontItem);
    };

    window.deleteFont = async function (id) {
        return await remove('fonts', id);
    };

    window.clearFonts = async function () {
        return await clear('fonts');
    };

    // ======================== 暴露全局 MuyeDB 对象 ========================
    window.MuyeDB = {
        openDB,
        getAll,
        get,
        put,
        remove,
        clear,
        getSettings,
        saveSettings,
        // 表情包仓库
        loadEmoteGroups: window.loadAllGroups,
        addEmoteGroup: window.addGroup,
        updateEmoteGroup: window.updateGroup,
        deleteEmoteGroup: window.deleteGroup,
        clearEmoteGroups: window.clearAllData,
        // 字体收藏
        loadFonts: window.loadFonts,
        addFont: window.addFont,
        deleteFont: window.deleteFont,
        clearFonts: window.clearFonts,
        // 工具
        getStorageEstimate: window.getStorageEstimate,
        formatBytes: window.formatBytes
    };

    // 初始化：预打开数据库（可选）
    openDB().catch(err => console.warn('MuyeStorageDB 初始化失败：', err));

})();
