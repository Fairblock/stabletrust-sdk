import { Buffer } from "buffer";
// returns a new array with the xor of a ^ b
export function xor(a, b) {
    if (a.length != b.length) {
        throw new Error("Error: incompatible sizes");
    }
    var ret = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) {
        ret[i] = a[i] ^ b[i];
    }
    return ret;
}
// code from Noble:
// https://github.com/paulmillr/noble-bls12-381/blob/6380415f1b7e5078c8883a5d8d687f2dd3bff6c2/index.ts#L132-L145
export function bytesToNumberBE(uint8a) {
    return BigInt("0x" + bytesToHex(Uint8Array.from(uint8a)));
}
var hexes = Array.from({ length: 256 }, function (v, i) {
    return i.toString(16).padStart(2, "0");
});
export function bytesToHex(uint8a) {
    // pre-caching chars could speed this up 6x.
    var hex = "";
    for (var i = 0; i < uint8a.length; i++) {
        hex += hexes[uint8a[i]];
    }
    return hex;
}
////// end of code from Noble.
// Function to convert Noble's FPs to byte arrays compatible with Kilic library.
// weirdly all the child FPs have to be reversed when serialising to bytes
export function fpToBytes(fp) {
    // 48 bytes = 96 hex bytes
    var hex = BigInt(fp.value).toString(16).padStart(96, "0");
    var buf = Buffer.alloc(hex.length / 2);
    buf.write(hex, "hex");
    return buf;
}
export function fp2ToBytes(fp2) {
    return Buffer.concat([fp2.c1, fp2.c0].map(fpToBytes));
}
// fp6 isn't exported by noble... let's take off the guard rails
// eslint-disable-next-line  @typescript-eslint/no-explicit-any
export function fp6ToBytes(fp6) {
    return Buffer.concat([fp6.c2, fp6.c1, fp6.c0].map(fp2ToBytes));
}
export function fp12ToBytes(fp12) {
    return Buffer.concat([fp12.c1, fp12.c0].map(fp6ToBytes));
}
//# sourceMappingURL=utils.js.map