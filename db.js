// ==================== MuyeStorageDB 统一数据库模块 ====================
// 数据库名称：MuyeStorageDB

(function () {
    'use strict';

    const DB_NAME = 'MuyeStorageDB';
    const DB_VERSION = 2;

    let db = null;

    async function openDB() {
        if (db) return db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const database = e.target.result;

                const stores = ['songs', 'settings', 'worldbook', 'emote_groups', 'fonts'];
                stores.forEach(name => {
                    if (!database.objectStoreNames.contains(name)) {
                        if (name === 'songs') {
                            const s = database.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
                            s.createIndex('order', 'order', { unique: false });
                        } else if (name === 'fonts') {
                            const f = database.createObjectStore('fonts', { keyPath: 'id' });
                            f.createIndex('type', 'type', { unique: false });
                        } else {
                            database.createObjectStore(name, { keyPath: 'id' });
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
                reject(new Error('数据库被占用'));
            };
        });
    }

    function closeDB() {
        if (db) {
            db.close();
            db = null;
        }
    }

    async function getAll(storeName) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function get(storeName, id) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
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
            tx.onabort = () => reject(new Error('事务中止'));
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
            tx.onabort = () => reject(new Error('事务中止'));
        });
    }

    async function getSettings() {
        const settings = await get('settings', 'global');
        return settings || {
            id: 'global',
            allowCodeVaultAccess: false,
            codeVaultGroupName: 'AI 记忆',
            widgetEnabled: false
        };
    }

    async function saveSettings(obj) {
        if (!obj.id) obj.id = 'global';
        return put('settings', obj);
    }

    // 表情包仓库
    window.loadAllGroups = async () => getAll('emote_groups');
    window.addGroup = async (group) => put('emote_groups', group);
    window.updateGroup = async (group) => put('emote_groups', group);
    window.deleteGroup = async (id) => remove('emote_groups', id);
    window.deleteMultipleGroups = async (ids) => {
        const database = await openDB();
        const tx = database.transaction('emote_groups', 'readwrite');
        const store = tx.objectStore('emote_groups');
        ids.forEach(id => store.delete(id));
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    };
    window.clearAllData = async () => clear('emote_groups');
    window.getStorageEstimate = async () => {
        if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
        return { usage: 0, quota: 0 };
    };
    window.formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // 字体
    window.loadFonts = async () => getAll('fonts');
    window.addFont = async (item) => put('fonts', item);
    window.deleteFont = async (id) => remove('fonts', id);
    window.clearFonts = async () => clear('fonts');

    window.openDB = openDB;
    window.closeDB = closeDB;

    window.MuyeDB = {
        openDB,
        closeDB,
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
        loadFonts: window.loadFonts,
        addFont: window.addFont,
        deleteFont: window.deleteFont,
        clearFonts: window.clearFonts,
        getStorageEstimate: window.getStorageEstimate,
        formatBytes: window.formatBytes
    };
})();
