var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import * as bls from "@noble/bls12-381";
import { utils } from "@noble/bls12-381";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToNumberBE, fp12ToBytes, xor } from "./utils.js";
import { Buffer } from "buffer";
export function encryptOnG1(master, ID, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var Qid, Gid, sigma, r, U, rGid, hrGid, V, hsigma, W;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (msg.length >> 8 > 1) {
                        throw new Error("cannot encrypt messages larger than our hash output: 256 bits.");
                    }
                    return [4 /*yield*/, bls.PointG2.hashToCurve(ID)];
                case 1:
                    Qid = _a.sent();
                    Gid = bls.pairing(master, Qid);
                    sigma = utils.randomBytes(msg.length);
                    r = h3(sigma, msg);
                    U = bls.PointG1.BASE.multiply(r);
                    rGid = Gid.pow(r);
                    return [4 /*yield*/, gtToHash(rGid, msg.length)];
                case 2:
                    hrGid = _a.sent();
                    V = xor(sigma, hrGid);
                    hsigma = h4(sigma, msg.length);
                    W = xor(msg, hsigma);
                    return [2 /*return*/, {
                            U: U,
                            V: V,
                            W: W,
                        }];
            }
        });
    });
}
export function encryptOnG2(master, ID, msg) {
    return __awaiter(this, void 0, void 0, function () {
        var Qid, Gid, sigma, r, U, rGid, hrGid, V, hsigma, W;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (msg.length >> 8 > 1) {
                        throw new Error("cannot encrypt messages larger than our hash output: 256 bits.");
                    }
                    return [4 /*yield*/, bls.PointG1.hashToCurve(ID)];
                case 1:
                    Qid = _a.sent();
                    Gid = bls.pairing(Qid, master);
                    sigma = utils.randomBytes(msg.length);
                    r = h3(sigma, msg);
                    U = bls.PointG2.BASE.multiply(r);
                    rGid = Gid.pow(r);
                    return [4 /*yield*/, gtToHash(rGid, msg.length)];
                case 2:
                    hrGid = _a.sent();
                    V = xor(sigma, hrGid);
                    hsigma = h4(sigma, msg.length);
                    W = xor(msg, hsigma);
                    return [2 /*return*/, {
                            U: U,
                            V: V,
                            W: W,
                        }];
            }
        });
    });
}
export function decryptOnG1(p, c) {
    return __awaiter(this, void 0, void 0, function () {
        var gidt, hgidt, sigma, hsigma, msg, r, rP;
        return __generator(this, function (_a) {
            gidt = bls.pairing(c.U, p);
            hgidt = gtToHash(gidt, c.W.length);
            if (hgidt.length != c.V.length) {
                throw new Error("XorSigma is of invalid length");
            }
            sigma = xor(hgidt, c.V);
            hsigma = h4(sigma, c.W.length);
            msg = xor(hsigma, c.W);
            r = h3(sigma, msg);
            rP = bls.PointG1.BASE.multiply(r);
            if (!rP.equals(c.U)) {
                throw new Error("invalid proof: rP check failed");
            }
            return [2 /*return*/, msg];
        });
    });
}
export function decryptOnG2(p, c) {
    return __awaiter(this, void 0, void 0, function () {
        var gidt, hgidt, sigma, hsigma, msg, r, rP;
        return __generator(this, function (_a) {
            gidt = bls.pairing(p, c.U);
            hgidt = gtToHash(gidt, c.W.length);
            if (hgidt.length != c.V.length) {
                throw new Error("XorSigma is of invalid length");
            }
            sigma = xor(hgidt, c.V);
            hsigma = h4(sigma, c.W.length);
            msg = xor(hsigma, c.W);
            r = h3(sigma, msg);
            rP = bls.PointG2.BASE.multiply(r);
            if (!rP.equals(c.U)) {
                throw new Error("invalid proof: rP check failed");
            }
            return [2 /*return*/, msg];
        });
    });
}
export function gtToHash(gt, len) {
    return sha256
        .create()
        .update("IBE-H2")
        .update(fp12ToBytes(gt))
        .digest()
        .slice(0, len);
}
// Our IBE hashes
var BitsToMaskForBLS12381 = 1;
function h3(sigma, msg) {
    var h3ret = sha256
        .create()
        .update("IBE-H3")
        .update(sigma)
        .update(msg)
        .digest();
    // We will hash iteratively: H(i || H("IBE-H3" || sigma || msg)) until we get a
    // value that is suitable as a scalar.
    for (var i = 1; i < 65535; i++) {
        var data = h3ret;
        data = sha256
            .create()
            .update(create16BitUintBuffer(i))
            .update(data)
            .digest();
        // assuming Big Endianness
        data[0] = data[0] >> BitsToMaskForBLS12381;
        var n = bytesToNumberBE(data);
        if (n < bls.CURVE.r) {
            return n;
        }
    }
    throw new Error("invalid proof: rP check failed");
}
function h4(sigma, len) {
    var h4sigma = sha256.create().update("IBE-H4").update(sigma).digest();
    return h4sigma.slice(0, len);
}
function create16BitUintBuffer(input) {
    if (input < 0) {
        throw Error("cannot write a negative value as uint!");
    }
    if (input > Math.pow(2, 16)) {
        throw Error("input value too large to fit in a uint16!");
    }
    var buf = Buffer.alloc(2);
    buf.writeUint16LE(input);
    return buf;
}
//# sourceMappingURL=ibe.js.map