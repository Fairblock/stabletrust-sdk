// largely taken from https://github.com/paulmillr/jage,
// but hooking in a browser compatible ChaCha20 implementation
// STREAM cipher
// https://eprint.iacr.org/2015/189.pdf
// age spec:
// After the header the binary payload is nonce || STREAM[HKDF[nonce, "payload"](file key)](plaintext) where nonce is random(16) and STREAM is from Online Authenticated-Encryption and its Nonce-Reuse Misuse-Resistance with ChaCha20-Poly1305 in 64KiB chunks and a nonce structure of 11 bytes of big endian counter, and 1 byte of last block flag (0x00 / 0x01). (The STREAM scheme is similar to the one Tink and Miscreant use, but without nonce prefix as we use HKDF, and with ChaCha20-Poly1305 instead of AES-GCM because the latter is unreasonably hard to do well or fast without hardware support.)
import { ChaCha20Poly1305 } from "@stablelib/chacha20poly1305";
var CHUNK_SIZE = 64 * 1024; // 64 KiB
var TAG_SIZE = 16; // Poly1305 MAC size
var ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + TAG_SIZE;
var NONCE_SIZE = 12; // STREAM nonce size
// due to using a 32bit uint for the counter, this is the max
// value the counter can be without risking a nonce reuse
var COUNTER_MAX = Math.pow(2, 32) - 1;
var STREAM = /** @class */ (function () {
    function STREAM(key) {
        this.key = key.slice();
        this.nonce = new Uint8Array(NONCE_SIZE);
        this.nonceView = new DataView(this.nonce.buffer);
        this.counter = 0;
    }
    STREAM.seal = function (plaintext, privateKey) {
        var stream = new STREAM(privateKey);
        var chunks = Math.ceil(plaintext.length / CHUNK_SIZE);
        var ciphertext = new Uint8Array(plaintext.length + chunks * TAG_SIZE);
        for (var chunk64kb = 1; chunk64kb <= chunks; chunk64kb++) {
            var start = chunk64kb - 1;
            var end = chunk64kb;
            var isLast = chunk64kb === chunks;
            var input = plaintext.slice(start * CHUNK_SIZE, end * CHUNK_SIZE);
            var output = ciphertext.subarray(start * ENCRYPTED_CHUNK_SIZE, end * ENCRYPTED_CHUNK_SIZE);
            stream.encryptChunk(input, isLast, output);
        }
        stream.clear();
        return ciphertext;
    };
    STREAM.open = function (ciphertext, privateKey) {
        var stream = new STREAM(privateKey);
        var chunks = Math.ceil(ciphertext.length / ENCRYPTED_CHUNK_SIZE);
        var plaintext = new Uint8Array(ciphertext.length - chunks * TAG_SIZE);
        for (var chunk64kb = 1; chunk64kb <= chunks; chunk64kb++) {
            var start = chunk64kb - 1;
            var end = chunk64kb;
            var isLast = chunk64kb === chunks;
            var input = ciphertext.slice(start * ENCRYPTED_CHUNK_SIZE, end * ENCRYPTED_CHUNK_SIZE);
            var output = plaintext.subarray(start * CHUNK_SIZE, end * CHUNK_SIZE);
            stream.decryptChunk(input, isLast, output);
        }
        stream.clear();
        return plaintext;
    };
    STREAM.prototype.encryptChunk = function (chunk, isLast, output) {
        if (chunk.length > CHUNK_SIZE)
            throw new Error("Chunk is too big");
        if (this.nonce[11] === 1)
            throw new Error("Last chunk has been processed");
        if (isLast)
            this.nonce[11] = 1;
        var ciphertext = new ChaCha20Poly1305(this.key).seal(this.nonce, chunk);
        output.set(ciphertext);
        this.incrementCounter();
    };
    STREAM.prototype.decryptChunk = function (chunk, isLast, output) {
        if (chunk.length > ENCRYPTED_CHUNK_SIZE)
            throw new Error("Chunk is too big");
        if (this.nonce[11] === 1)
            throw new Error("Last chunk has been processed");
        if (isLast)
            this.nonce[11] = 1;
        var plaintext = new ChaCha20Poly1305(this.key).open(this.nonce, chunk);
        if (plaintext == null) {
            throw Error("Error during decryption!");
        }
        output.set(plaintext);
        this.incrementCounter();
    };
    // Increments Big Endian Uint8Array-based counter.
    // [0, 0, 0] => [0, 0, 1] ... => [0, 0, 255] => [0, 1, 0]
    STREAM.prototype.incrementCounter = function () {
        if (this.counter == COUNTER_MAX) {
            throw new Error("Stream cipher counter has already hit max value! Aborting to avoid nonce reuse - tlock only supports payloads up to 256TB");
        }
        this.counter += 1;
        this.nonceView.setUint32(7, this.counter, false);
    };
    STREAM.prototype.clear = function () {
        function clear(arr) {
            for (var i = 0; i < arr.length; i++) {
                arr[i] = 0;
            }
        }
        clear(this.key);
        clear(this.nonce);
        this.counter = 0;
    };
    return STREAM;
}());
export { STREAM };
//# sourceMappingURL=stream-cipher.js.map