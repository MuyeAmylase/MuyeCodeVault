// ==================== MuyeStorageDB 统一数据库模块（精简版） ====================
// 数据库名称：MuyeStorageDB
// 使用方式：<script src="db.js"></script>  后直接调用全局函数或 MuyeDB.xxx()
// 已移除：chats, memory, notes 相关表

(function () {
    'use strict';

    const DB_NAME = 'MuyeStorageDB';
    const DB_VERSION = 3;               // 版本号递增以触发升级

    let db = null;
    let initPromise = null;

    // ---------- 打开/升级数据库 ----------
    async function openDB() {
        if (db) return db;
        if (initPromise) return initPromise;

        initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const database = e.target.result;

                // 删除可能存在的旧表（清理之前版本残留的 chats, memory, notes）
                const storesToRemove = ['chats', 'memory', 'notes'];
                storesToRemove.forEach(name => {
                    if (database.objectStoreNames.contains(name)) {
                        database.deleteObjectStore(name);
                    }
                });

                // 创建/确保需要的对象存储
                if (!database.objectStoreNames.contains('songs')) {
                    const songsStore = database.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
                    songsStore.createIndex('order', 'order', { unique: false });
                }
                if (!database.objectStoreNames.contains('settings')) {
                    database.createObjectStore('settings', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('worldbook')) {
                    database.createObjectStore('worldbook', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('emote_groups')) {
                    database.createObjectStore('emote_groups', { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains('fonts')) {
                    database.createObjectStore('fonts', { keyPath: 'id' });
                }
            };

            request.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = function (e) {
                console.error('打开数据库失败:', e.target.error);
                reject(e.target.error);
            };

            request.onblocked = function () {
                alert('数据库升级被占用，请关闭所有相关网页后刷新。');
                reject(new Error('数据库被阻塞'));
            };
        });

        return initPromise;
    }

    // ---------- 通用操作 ----------
    async function getAll(storeName) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
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
            tx.onabort = () => reject(new Error('事务中止'));
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

    // ---------- 便捷设置方法 ----------
    async function getSettings() {
        const settings = await get('settings', 'global');
        return settings || {
            id: 'global',
            allowCodeVaultAccess: false,
            codeVaultGroupName: 'AI 记忆',
            widgetEnabled: false
        };
    }

    async function saveSettings(settingsObj) {
        if (!settingsObj.id) settingsObj.id = 'global';
        return put('settings', settingsObj);
    }

    // ==================== 表情包仓库专用方法（全局函数） ====================
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

    window.getStorageEstimate = async function () {
        if (navigator.storage && navigator.storage.estimate) {
            return await navigator.storage.estimate();
        }
        return { usage: 0, quota: 0 };
    };

    window.formatBytes = function (bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 兼容性：暴露 openDB
    window.openDB = openDB;

    // ==================== 暴露全局 MuyeDB 对象 ====================
    window.MuyeDB = {
        openDB,
        getAll,
        get,
        put,
        remove,
        clear,
        getSettings,
        saveSettings,
        loadEmoteGroups: window.loadAllGroups,
        addEmoteGroup: window.addGroup,
        updateEmoteGroup: window.updateGroup,
        deleteEmoteGroup: window.deleteGroup,
        clearEmoteGroups: window.clearAllData,
        getStorageEstimate: window.getStorageEstimate,
        formatBytes: window.formatBytes
    };

    // 初始化：自动打开数据库
    openDB().catch(err => console.warn('MuyeStorageDB 初始化失败：', err));

})();
