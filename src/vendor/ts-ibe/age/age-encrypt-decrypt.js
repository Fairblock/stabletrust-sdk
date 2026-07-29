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
import { Buffer } from "buffer";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { STREAM } from "./stream-cipher.js";
import { NoOpEncDec } from "./no-op-encdec.js";
import { readAge, writeAge } from "./age-reader-writer.js";
import { sliceUntil, unpaddedBase64Buffer } from "./utils.js";
import { createMacKey, random } from "./utils-crypto.js";
var ageVersion = "age-encryption.org/v1";
var headerMacMessage = "header"; // some plaintext used to generate the mac
var hkdfBodyMessage = "payload"; // some plaintext used for generating the key for encrypting the body
var fileKeyLengthBytes = 32;
var bodyHkdfNonceLengthBytes = 16;
var hkdfKeyLengthBytes = 32;
// encrypts a plaintext payload using AGE by generating a fileKey
// and passing the fileKey to another `EncryptionWrapper` for handling
export function encryptAge(plaintext, wrapFileKey) {
    if (wrapFileKey === void 0) { wrapFileKey = NoOpEncDec.wrap; }
    return __awaiter(this, void 0, void 0, function () {
        var fileKey, recipients, body;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, random(fileKeyLengthBytes)];
                case 1:
                    fileKey = _a.sent();
                    return [4 /*yield*/, wrapFileKey(fileKey)];
                case 2:
                    recipients = _a.sent();
                    return [4 /*yield*/, encryptedPayload(fileKey, plaintext)];
                case 3:
                    body = _a.sent();
                    return [2 /*return*/, writeAge({
                            fileKey: fileKey,
                            version: ageVersion,
                            recipients: recipients,
                            headerMacMessage: headerMacMessage,
                            body: body,
                        })];
            }
        });
    });
}
function encryptedPayload(fileKey, payload) {
    return __awaiter(this, void 0, void 0, function () {
        var nonce, hkdfKey, ciphertext;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, random(bodyHkdfNonceLengthBytes)];
                case 1:
                    nonce = _a.sent();
                    hkdfKey = hkdf(sha256, fileKey, nonce, Buffer.from(hkdfBodyMessage, "utf8"), hkdfKeyLengthBytes);
                    ciphertext = STREAM.seal(payload, hkdfKey);
                    return [2 /*return*/, Buffer.concat([nonce, ciphertext])];
            }
        });
    });
}
// decrypts a payload that has been encrypted using AGE can unwrap
// any internal encryption by passing a `DecryptionWrapper` that can
// provide the `fileKey` created during encryption
export function decryptAge(payload, unwrapFileKey) {
    if (unwrapFileKey === void 0) { unwrapFileKey = NoOpEncDec.unwrap; }
    return __awaiter(this, void 0, void 0, function () {
        var encryptedPayload, version, fileKey, header, expectedMac, actualMac, nonce, cipherText, hkdfKey, plaintext;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    encryptedPayload = readAge(payload);
                    version = encryptedPayload.header.version;
                    if (version !== ageVersion) {
                        throw Error("The payload version ".concat(version, " is not supported, only ").concat(ageVersion));
                    }
                    return [4 /*yield*/, unwrapFileKey(encryptedPayload.header.recipients)];
                case 1:
                    fileKey = _a.sent();
                    header = sliceUntil(payload, "---");
                    expectedMac = unpaddedBase64Buffer(createMacKey(fileKey, headerMacMessage, header));
                    actualMac = encryptedPayload.header.mac;
                    if (Buffer.compare(actualMac, expectedMac) !== 0) {
                        throw Error("The MAC did not validate for the fileKey and payload!");
                    }
                    nonce = Buffer.from(encryptedPayload.body.slice(0, bodyHkdfNonceLengthBytes));
                    cipherText = encryptedPayload.body.slice(bodyHkdfNonceLengthBytes);
                    hkdfKey = hkdf(sha256, fileKey, nonce, Buffer.from(hkdfBodyMessage, "utf8"), hkdfKeyLengthBytes);
                    plaintext = STREAM.open(cipherText, hkdfKey);
                    return [2 /*return*/, Buffer.from(plaintext)];
            }
        });
    });
}
//# sourceMappingURL=age-encrypt-decrypt.js.map