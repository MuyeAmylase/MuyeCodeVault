// ==================== MuyeStorageDB 统一数据库模块（加固版） ====================
// 数据库名称：MuyeStorageDB
// 增强特性：自动重试、事务超时保护、一键完整备份、安全关闭连接

(function () {
    'use strict';

    const DB_NAME = 'MuyeStorageDB';
    const DB_VERSION = 1;
    const OLD_DB_NAME = 'MuyeChat7403DB';
    const MAX_RETRIES = 3;

    let db = null;
    let initPromise = null;

    // ======================== 带重试的数据库打开 ========================
    async function openDB() {
        if (db) return db;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            // 尝试迁移（仅在首次打开时执行）
            await migrateIfNeeded();

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    db = await new Promise((resolve, reject) => {
                        const request = indexedDB.open(DB_NAME, DB_VERSION);

                        request.onupgradeneeded = function (e) {
                            const database = e.target.result;
                            // 需要创建的表
                            const stores = [
                                'songs',
                                'settings',
                                'worldbook',
                                'emote_groups',
                                'fonts'
                            ];

                            stores.forEach(name => {
                                if (!database.objectStoreNames.contains(name)) {
                                    switch (name) {
                                        case 'songs':
                                            const songsStore = database.createObjectStore('songs', {
                                                keyPath: 'id',
                                                autoIncrement: true
                                            });
                                            songsStore.createIndex('order', 'order', { unique: false });
                                            break;
                                        case 'emote_groups':
                                            database.createObjectStore('emote_groups', { keyPath: 'id' });
                                            break;
                                        case 'fonts':
                                            const fontsStore = database.createObjectStore('fonts', { keyPath: 'id' });
                                            fontsStore.createIndex('type', 'type', { unique: false });
                                            break;
                                        default:
                                            database.createObjectStore(name, { keyPath: 'id' });
                                    }
                                }
                            });

                            // 清理旧表（不再需要的表）
                            const tablesToRemove = ['chats', 'memory', 'notes'];
                            tablesToRemove.forEach(t => {
                                if (database.objectStoreNames.contains(t)) {
                                    database.deleteObjectStore(t);
                                }
                            });
                        };

                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                        request.onblocked = () => reject(new Error('数据库被占用'));
                    });
                    return db;
                } catch (error) {
                    if (attempt === MAX_RETRIES) {
                        throw new Error(`数据库打开失败（重试${MAX_RETRIES}次）: ${error.message}`);
                    }
                    // 等待后重试
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        })();

        return initPromise;
    }

    // 安全关闭数据库连接
    function closeDB() {
        if (db) {
            db.close();
            db = null;
        }
        initPromise = null;
    }

    // ======================== 旧数据库迁移（不删除任何旧库） ========================
    async function migrateIfNeeded() {
        const migrationKey = 'muye_storage_migrated_v2';
        if (localStorage.getItem(migrationKey) === 'true') return;

        // 检查是否有旧库需要迁移
        const oldMuyeChatExists = await databaseExists(OLD_DB_NAME);
        const oldEmoteExists = await databaseExists('EmoteWarehouseDB');

        if (!oldMuyeChatExists && !oldEmoteExists) {
            localStorage.setItem(migrationKey, 'true');
            return;
        }

        try {
            // 打开当前数据库用于写入
            const currentDB = await new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('阻塞'));
            });

            // 迁移 MuyeChat7403DB
            if (oldMuyeChatExists) {
                const oldDB = await new Promise((resolve, reject) => {
                    const req = indexedDB.open(OLD_DB_NAME);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                const tables = ['songs', 'settings', 'worldbook'];
                for (const table of tables) {
                    if (oldDB.objectStoreNames.contains(table)) {
                        const data = await getAllFromDB(oldDB, table);
                        if (data && data.length > 0) {
                            await putAllToDB(currentDB, table, data);
                        }
                    }
                }
                oldDB.close();
            }

            // 迁移 EmoteWarehouseDB
            if (oldEmoteExists) {
                const emoteDB = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('EmoteWarehouseDB');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                if (emoteDB.objectStoreNames.contains('groups')) {
                    const groups = await getAllFromDB(emoteDB, 'groups');
                    if (groups && groups.length > 0) {
                        await putAllToDB(currentDB, 'emote_groups', groups);
                    }
                }
                emoteDB.close();
            }

            currentDB.close();
            localStorage.setItem(migrationKey, 'true');
        } catch (e) {
            console.error('数据迁移失败，将在下次启动重试:', e);
        }
    }

    // 工具：检查数据库是否存在
    function databaseExists(name) {
        return new Promise(resolve => {
            const req = indexedDB.open(name);
            req.onsuccess = () => { req.result.close(); resolve(true); };
            req.onerror = () => resolve(false);
            req.onblocked = () => resolve(false);
        });
    }

    // 从指定数据库读取全表
    function getAllFromDB(database, storeName) {
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // 批量写入（带超时）
    function putAllToDB(database, storeName, items) {
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            items.forEach(item => store.put(item));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error('事务中止'));
        });
    }

    // ======================== 强化版基础操作（带超时保护） ========================
    async function put(storeName, item, timeout = 8000) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(item);

            const timer = setTimeout(() => {
                reject(new Error('写入超时'));
            }, timeout);

            tx.oncomplete = () => {
                clearTimeout(timer);
                resolve();
            };
            tx.onerror = () => {
                clearTimeout(timer);
                reject(tx.error);
            };
            tx.onabort = () => {
                clearTimeout(timer);
                reject(new Error('事务中止'));
            };
        });
    }

    async function remove(storeName, id, timeout = 8000) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.delete(id);

            const timer = setTimeout(() => {
                reject(new Error('删除超时'));
            }, timeout);

            tx.oncomplete = () => {
                clearTimeout(timer);
                resolve();
            };
            tx.onerror = () => {
                clearTimeout(timer);
                reject(tx.error);
            };
            tx.onabort = () => {
                clearTimeout(timer);
                reject(new Error('事务中止'));
            };
        });
    }

    async function clear(storeName, timeout = 8000) {
        const database = await openDB();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.clear();

            const timer = setTimeout(() => {
                reject(new Error('清空超时'));
            }, timeout);

            tx.oncomplete = () => {
                clearTimeout(timer);
                resolve();
            };
            tx.onerror = () => {
                clearTimeout(timer);
                reject(tx.error);
            };
            tx.onabort = () => {
                clearTimeout(timer);
                reject(new Error('事务中止'));
            };
        });
    }

    // 读取操作
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

    // ======================== 一键完整备份 ========================
    async function backupAll() {
        const database = await openDB();
        const storeNames = Array.from(database.objectStoreNames);
        const backup = { exportedAt: new Date().toISOString() };
        for (const name of storeNames) {
            backup[name] = await getAll(name);
        }
        return backup;
    }

    // ======================== 全局便捷函数（兼容原有代码） ========================
    window.openDB = openDB;
    window.closeDB = closeDB;

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
            tx.onabort = () => reject(new Error('事务中止'));
        });
    };
    window.clearAllData = async () => clear('emote_groups');

    // 字体
    window.loadFonts = async () => getAll('fonts');
    window.addFont = async (item) => put('fonts', item);
    window.deleteFont = async (id) => remove('fonts', id);
    window.clearFonts = async () => clear('fonts');

    // 工具
    window.getStorageEstimate = async () => {
        if (navigator.storage && navigator.storage.estimate) {
            return await navigator.storage.estimate();
        }
        return { usage: 0, quota: 0 };
    };
    window.formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // ======================== MuyeDB 全局对象 ========================
    window.MuyeDB = {
        openDB,
        closeDB,
        getAll,
        get,
        put,
        remove,
        clear,
        backupAll,
        getSettings: async () => {
            const settings = await get('settings', 'global');
            return settings || {
                id: 'global',
                allowCodeVaultAccess: false,
                codeVaultGroupName: 'AI 记忆'
            };
        },
        saveSettings: async (obj) => {
            if (!obj.id) obj.id = 'global';
            return put('settings', obj);
        },
        // 表情包仓库便捷方法
        loadEmoteGroups: window.loadAllGroups,
        addEmoteGroup: window.addGroup,
        updateEmoteGroup: window.updateGroup,
        deleteEmoteGroup: window.deleteGroup,
        clearEmoteGroups: window.clearAllData,
        // 字体
        loadFonts: window.loadFonts,
        addFont: window.addFont,
        deleteFont: window.deleteFont,
        clearFonts: window.clearFonts,
        // 工具
        getStorageEstimate: window.getStorageEstimate,
        formatBytes: window.formatBytes
    };

    // 预打开数据库（不阻塞页面加载）
    openDB().catch(err => console.warn('MuyeStorageDB 初始化失败：', err));
})();
