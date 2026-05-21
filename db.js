// ==================== MuyeChat 公共数据库模块（增强版） ====================
// 数据库名称：MuyeChat7403DB
// 使用方式：<script src="db.js"></script>  后通过 MuyeDB.xxx() 调用

(function () {
    'use strict';

    const DB_NAME = 'MuyeChat7403DB';
    const DB_VERSION = 2;

    let currentDB = null;   // 保存当前打开的数据库实例

    // ---------- 打开数据库 ----------
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                const database = e.target.result;
                const oldVersion = e.oldVersion;

                if (oldVersion < 1) {
                    if (!database.objectStoreNames.contains('songs')) {
                        const songsStore = database.createObjectStore('songs', {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        songsStore.createIndex('order', 'order', { unique: false });
                    }
                }

                if (oldVersion < 2) {
                    if (!database.objectStoreNames.contains('settings')) {
                        database.createObjectStore('settings', {
                            keyPath: 'id'
                        });
                    }
                }
            };

            request.onsuccess = function (e) {
                currentDB = e.target.result;   // 保存实例，供 close 使用
                resolve(currentDB);
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

    // ---------- 关闭当前数据库连接 ----------
    function closeDB() {
        if (currentDB) {
            currentDB.close();
            currentDB = null;
        }
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
                    tx.oncomplete = () => {
                        db.close();
                        currentDB = null;   // 连接已关闭，清除引用
                    };
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
                    tx.oncomplete = () => {
                        db.close();
                        currentDB = null;
                        resolve();
                    };
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
        saveSettings,
        close: closeDB   // 新增：手动关闭数据库连接
    };

})();
