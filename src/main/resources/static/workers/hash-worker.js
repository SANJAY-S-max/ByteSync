importScripts('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js');

let sha256Algo;

self.onmessage = function(e) {
    const data = e.data;
    if (data.type === 'init') {
        sha256Algo = CryptoJS.algo.SHA256.create();
    } else if (data.type === 'update') {
        const wordArray = arrayBufferToWordArray(data.chunk);
        sha256Algo.update(wordArray);
    } else if (data.type === 'finalize') {
        const hash = sha256Algo.finalize().toString(CryptoJS.enc.Hex);
        self.postMessage({ type: 'hash_result', hash: hash });
    }
};

function arrayBufferToWordArray(arrayBuffer) {
    const i8a = new Uint8Array(arrayBuffer);
    const a = [];
    for (let i = 0; i < i8a.length; i += 4) {
        a.push(
            (i8a[i] << 24) |
            (i8a[i + 1] << 16) |
            (i8a[i + 2] << 8) |
            (i8a[i + 3])
        );
    }
    return CryptoJS.lib.WordArray.create(a, i8a.length);
}
