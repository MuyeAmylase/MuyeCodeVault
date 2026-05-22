// ==================== MuyeChat 公共数据库模块（增强版） ====================
// 数据库名称：MuyeChat7403DB
// 使用方式：<script src="db.js"></script>  后通过 MuyeDB.xxx() 调用

(function () {
    'use strict';

    const DB_NAME = 'MuyeChat7403DB';
    const DB_VERSION = 3;   // ← 升级到 3

    // ---------- 打开数据库 ----------
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const database = e.target.result;
                const oldVersion = e.oldVersion;

                // 版本 < 1：创建 songs 和 settings（已有用户不会触发）
                if (oldVersion < 1) {
                    if (!database.objectStoreNames.contains('songs')) {
                        const songsStore = database.createObjectStore('songs', {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        songsStore.createIndex('order', 'order', { unique: false });
                    }
                }

                // 版本 < 2：创建 settings（已有用户不会触发）
                if (oldVersion < 2) {
                    if (!database.objectStoreNames.contains('settings')) {
                        database.createObjectStore('settings', {
                            keyPath: 'id'
                        });
                    }
                }

                // 版本 < 3：创建 chats, worldbook, memory, notes
                if (oldVersion < 3) {
                    if (!database.objectStoreNames.contains('chats')) {
                        database.createObjectStore('chats', { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains('worldbook')) {
                        database.createObjectStore('worldbook', { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains('memory')) {
                        database.createObjectStore('memory', { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains('notes')) {
                        database.createObjectStore('notes', { keyPath: 'id' });
                    }
                }
            };

            request.onsuccess = function (e) {
                resolve(e.target.result);
            };

            request.onerror = function (e) {
                reject(e.target.error);
            };

            request.onblocked = function () {
                console.warn('MuyeChatDB 升级被阻塞，请关闭其他标签页后刷新。');
                reject(new Error('数据库被阻塞'));
            };
        });
    }

    // ---------- 带重试的数据读取 ----------
    async function loadFromDB(storeName, operation, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const db = await openDB();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, 'readonly');
                    const store = tx.objectStore(storeName);
                    const request = operation(store);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                    tx.oncomplete = () => { db.close(); };
                });
            } catch (e) {
                if (i === retries - 1) throw e;
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }

    // ---------- 带重试的数据写入 ----------
    async function saveToDB(storeName, operation, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const db = await openDB();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(storeName, 'readwrite');
                    const store = tx.objectStore(storeName);
                    operation(store);
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(new Error('事务中止'));
                });
            } catch (e) {
                if (i === retries - 1) throw e;
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }

    // ---------- 通用操作 ----------
    async function getAll(storeName, indexName = null) {
        return loadFromDB(storeName, (store) => {
            if (indexName && store.indexNames.contains(indexName)) {
                return store.index(indexName).getAll();
            }
            return store.getAll();
        });
    }

    async function get(storeName, id) {
        return loadFromDB(storeName, (store) => store.get(id));
    }

    async function put(storeName, item) {
        return saveToDB(storeName, (store) => { store.put(item); });
    }

    async function remove(storeName, id) {
        return saveToDB(storeName, (store) => { store.delete(id); });
    }

    async function clear(storeName) {
        return saveToDB(storeName, (store) => { store.clear(); });
    }

    // ---------- 便捷设置方法 ----------
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

    // ---------- 暴露全局对象 ----------
    window.MuyeDB = {
        getAll,
        get,
        put,
        remove,
        clear,
        getSettings,
        saveSettings
    };

})();
