'use strict';

function get_api_key() {
    return new Promise((resolve, reject) => {
        const saved = localStorage.getItem('api-key');
        if (saved) {return resolve(saved);}

        const form = document.getElementById('key-input-form');
        form.hidden = false;
        form.addEventListener('submit', e => {
            e.preventDefault();
            const key = document.getElementById('key-input').value;
            form.hidden = true;
            form.disabled = true;

            localStorage.setItem('api-key', key);
            resolve(key);
        }, {once: true});
    });
}

const progress = document.getElementById('progress');
function append_progress(s) {
    progress.appendChild(document.createTextNode(s));
}

const worker = new Worker('worker.js');
const worker_callbacks = new Map;
worker.addEventListener('message', e => {
    console.log('got message from worker', e.data);
    switch (e.data[0]) {
        case 'progress':
            append_progress('+');
            break;
        case 'result':
            progress.hidden = true;
            const [, sig, res] = e.data;
            const cb = worker_callbacks.get(sig);
            worker_callbacks.delete(sig);
            cb(res);
            break;
    }
});

async function fetch_data(tables) {
    const key = await get_api_key();
    const sig = [key, ...tables].join(',');
    const args = [sig, key, tables];
    console.assert(!worker_callbacks.has(sig));
    return new Promise((resolve, reject) => {
        worker_callbacks.set(sig, resolve);
        progress.hidden = false;
        worker.postMessage(args);
    });
}
