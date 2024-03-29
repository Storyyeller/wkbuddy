'use strict';
const {log, error, trace, assert} = console;

let t0 = performance.now();
function elapsed() {return Math.round(performance.now() - t0);}

function display_progress(debug_msg) {self.postMessage(['progress', elapsed(), debug_msg]);}

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
    display_progress(endpoint);
    while (res.pages.next_url) {
        data.push(...res.data);

        const url = res.pages.next_url.split('v2/')[1];
        res = await query(key, url);
        display_progress(url);
    }
    data.push(...res.data);
    return data;
}


const VERSION = 2;
const META_KEY = 'last-updated';
const TABLES = 'reviews subjects assignments'.split(' ');

function open_db(name) {
    return new Promise((resolve, reject) => {
        console.log(`opening db ${name} v${VERSION}`);
        const req = indexedDB.open(name, VERSION);
        req.onerror = reject;
        req.onupgradeneeded = e => {
            log('open req upgrade needed', e);
            const db = e.target.result;
            console.log(db.name, db.version, db.objectStoreNames);
            for (const name of db.objectStoreNames) {db.deleteObjectStore(name);}

            console.log(db.name, db.version, db.objectStoreNames);
            for (const table of TABLES) {
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
        log('finished setting up db req');
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

    const read_start = elapsed();
    const [old_data, last_time] = await (() => {
        const t = db.transaction([main_name, meta_name], 'readonly');
        return Promise.all([
            idbreq(t.objectStore(main_name), 'getAll'),
            idbreq(t.objectStore(meta_name), 'get', META_KEY),
        ]);
    })();
    const read_end = elapsed();

    const new_data = await fetch_cb(last_time);
    const fetch_end = elapsed();

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

    const data = new Map([...old_data, ...new_data].map(obj => [obj.id, obj]));
    const debug_msg = `${table}: read_start ${read_start} read_end ${read_end} fetch_end ${fetch_end}`;
    display_progress(debug_msg);
    return [table, data];
}
async function get_user(key) {
    return ['user', (await query(key, 'user')).data];
}

async function get_data(key, tables) {
    const db = await open_db(key);
    return Promise.all(tables.map(table =>
        table === 'user' ? get_user(key) :
        get_cached(db, table,
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
    const [sig, key, tables] = e.data;
    t0 = performance.now();
    get_data(key, tables).then(
        res => self.postMessage(['result', sig, Object.fromEntries(res), elapsed()])
    ).catch(e => {
        console.log('Error occured in webworker', e);
        console.error(e);
    });
});
