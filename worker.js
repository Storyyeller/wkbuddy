'use strict';
const {log, error, trace, assert} = console;

function display_progress() {self.postMessage(['progress']);}

function query(key, endpoint) {
    const url = 'https://api.wanikani.com/v2/' + endpoint;
    console.log(`Fetching ${url}...`);
    return fetch(url, {
            headers: new Headers({Authorization: 'Bearer ' + key}),
            mode: 'cors',
        }).then(r => r.json());
}

async function query_all(key, endpoint) {
    const data = [];

    let res = await query(key, endpoint);
    display_progress();
    while (res.pages.next_url) {
        data.push(...res.data);

        const url = res.pages.next_url.split('v2/')[1];
        res = await query(key, url);
        display_progress();
    }
    data.push(...res.data);
    return data;
}


const VERSION = 1;
const META_KEY = 'last-updated';

function open_db(name) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, VERSION);
        req.onerror = reject;
        req.onupgradeneeded = e => {
            log('open req upgrade needed', e);
            const db = e.target.result;
            console.log(db.name, db.version, db.objectStoreNames);
            for (const name of db.objectStoreNames) {db.deleteObjectStore(name);}

            console.log(db.name, db.version, db.objectStoreNames);
            for (const table of 'reviews subjects'.split(' ')) {
                db.createObjectStore(table, {keyPath: 'id'});
                db.createObjectStore(table + '-meta');
            }
            console.log(db.name, db.version, db.objectStoreNames);
        };
        req.onsuccess = e => {
            log('open req success', e);
            const db = e.target.result;
            assert(db);
            resolve(db);
        };
    });
}
function idbreq(objs, method, ...args) {
    return new Promise((resolve, reject) => {
        const req = objs[method](...args);
        req.onsuccess = e => resolve(req.result);
        req.onerror = e => reject(req.error);
    });
}
async function get_cached(db, table, fetch_cb) {
    const main_name = table;
    const meta_name = table + '-meta';
    const new_time = (new Date).toISOString();


    const [old_data, last_time] = await (() => {
        const t = db.transaction([main_name, meta_name], 'readonly');
        return Promise.all([
            idbreq(t.objectStore(main_name), 'getAll'),
            idbreq(t.objectStore(meta_name), 'get', META_KEY),
        ]);
    })();

    const new_data = await fetch_cb(last_time);

    (async () => {
        const t = db.transaction([main_name, meta_name], 'readwrite');
        const os_main = t.objectStore(main_name);
        const os_meta = t.objectStore(meta_name);
        const last_time2 = await idbreq(os_meta, 'get', META_KEY);
        log(table, 'last_time', last_time, 'last_time2', last_time2, 'new_time', new_time);
        if (!last_time2 || last_time2 < new_time) {
            os_meta.put(new_time, META_KEY);
            new_data.forEach(obj => os_main.put(obj));
        }
    })();

    return new Map([...old_data, ...new_data].map(obj => [obj.id, obj]));
}

async function get_data(key, tables) {
    const db = await open_db(key);
    return Promise.all(tables.map(table => get_cached(db, table,
        async function(last_time) {
            const new_data_raw = await query_all(key, table + (last_time ? '?updated_after=' + last_time : ''));
            return new_data_raw.map(({id, object, data}) => {
                data.id = id;
                if (table === 'subjects') {data.type = object;}
                return data
            });
        }
    )));
}


self.addEventListener('message', e => {
    console.log('worker got', e.data);
    get_data(...e.data).then(
        res => self.postMessage(['result', res])
    ).catch(e => {
        console.log('Error occured in webworker', e);
        console.error(e);
    });
});
