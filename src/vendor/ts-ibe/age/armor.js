import { Buffer } from "buffer";
import { chunked } from "./utils.js";
var header = "-----BEGIN AGE ENCRYPTED FILE-----";
var footer = "-----END AGE ENCRYPTED FILE-----";
// takes some payload and encodes it as armor with the AGE armor headers in lines of size `chunkSize`
export function encodeArmor(input, chunkSize) {
    if (chunkSize === void 0) { chunkSize = 64; }
    var base64Input = Buffer.from(input, "binary").toString("base64");
    var columnisedInput = chunked(base64Input, chunkSize).join("\n");
    // if the last line is exactly 64 columns, add an extra newline
    var paddedFooter = footer;
    if (columnisedInput.length > 0 &&
        columnisedInput[columnisedInput.length - 1].length === 64) {
        paddedFooter = "\n" + footer;
    }
    return "".concat(header, "\n").concat(columnisedInput, "\n").concat(paddedFooter, "\n");
}
// takes an armored payload and decodes it if it is an AGE armor payload
// and it satisfies some security properties
export function decodeArmor(armor, chunkSize) {
    if (chunkSize === void 0) { chunkSize = 64; }
    // could start/end with space or newlines, let's strip them
    armor = armor.trimStart();
    var lengthBeforeEndTrim = armor.length;
    armor = armor.trimEnd();
    var lengthAfterTrim = armor.length;
    // for compliance with the go age implementation, we deny more than 1024 whitespace chars:
    // see: https://github.com/FiloSottile/age/blob/8e3f74c283b2e9b3cd0ec661fa4008504e536d20/armor/armor.go#L104
    var trimmedWhitespace = lengthBeforeEndTrim - lengthAfterTrim;
    if (trimmedWhitespace > 1024) {
        throw Error("too much whitespace at the end of the armor payload");
    }
    if (!armor.startsWith(header)) {
        throw Error("Armor cannot be decoded if it does not start with a header! i.e. ".concat(header));
    }
    if (!armor.endsWith(footer)) {
        throw Error("Armor cannot be decoded if it does not end with a footer! i.e. ".concat(footer));
    }
    var base64Payload = armor.slice(header.length, armor.length - footer.length);
    var lines = base64Payload.split("\n");
    if (lines.some(function (line) { return line.length > chunkSize; })) {
        throw Error("Armor to decode cannot have lines longer than ".concat(chunkSize, " (configurable) in order to stop padding attacks"));
    }
    if (lines[lines.length - 1].length >= chunkSize) {
        throw Error("The last line of an armored payload must be less than ".concat(chunkSize, " (configurable) to stop padding attacks"));
    }
    return Buffer.from(base64Payload, "base64").toString("binary");
}
export function isProbablyArmored(input) {
    return input.startsWith(header);
}
//# sourceMappingURL=armor.js.map