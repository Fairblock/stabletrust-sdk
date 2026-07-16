import { Buffer } from "buffer";
import { chunked, unpaddedBase64 } from "./utils.js";
import { createMacKey } from "./utils-crypto.js";
// takes the model to be encrypted and encodes everything to a string
// inserting newlines, other tags and the hmac as per the spec
export function writeAge(input) {
    var headerStr = header(input);
    var macKey = mac(createMacKey(input.fileKey, input.headerMacMessage, headerStr));
    var payload = Buffer.from(input.body).toString("binary");
    return "".concat(headerStr, " ").concat(macKey, "\n").concat(payload);
}
// ends with a `---`, as this is included in the header when
// calculating the MAC
export function header(input) {
    return "".concat(input.version, "\n").concat(recipients(input.recipients), "---");
}
var recipients = function (stanzas) {
    return stanzas.map(function (it) { return recipient(it) + "\n"; });
};
var recipient = function (stanza) {
    var type = stanza.type;
    var encodedBody = unpaddedBase64(stanza.body);
    var chunkedEncodedBody = chunked(encodedBody, 64).join("\n");
    return "-> ".concat(type, "\n") + chunkedEncodedBody;
};
// The `---` preceding the MAC is technically part of the MAC-able text
// so it's included in the header instead
var mac = function (macStr) { return unpaddedBase64(macStr); };
// parses an AGE encrypted string into a model object with all the
// relevant parts encoded correctly
// throws an error if things are missing, in the wrong place or cannot
// be parsed
export function readAge(input) {
    var _a;
    var _b = input.split("\n"), version = _b[0], lines = _b.slice(1);
    var recipients = parseRecipients(lines);
    var macStartingTag = "--- ";
    var macLine = lines.shift();
    if (!macLine || !macLine.startsWith(macStartingTag)) {
        throw Error("Expected mac, but there were no more lines left!");
    }
    var mac = Buffer.from(macLine.slice(macStartingTag.length, macLine.length), "base64");
    // any remaining newlines are actually part of the payload
    var ciphertext = Buffer.from((_a = lines.join("\n")) !== null && _a !== void 0 ? _a : "", "binary");
    return {
        header: { version: version, recipients: recipients, mac: mac },
        body: ciphertext,
    };
}
// validates the code points of the characters of the args in line with the go implementation
// see: https://github.com/FiloSottile/age/blob/8e3f74c283b2e9b3cd0ec661fa4008504e536d20/internal/format/format.go#L301
function validateArguments(args) {
    args.forEach(function (arg) {
        for (var i = 0; i < arg.length; i++) {
            var charCode = arg.charCodeAt(i);
            if (charCode < 33 || charCode > 126) {
                throw Error("Invalid character ".concat(arg[i], " in argument ").concat(arg));
            }
        }
    });
}
// parses all the recipient stanzas from `lines`
// modifies `lines`!!
function parseRecipients(lines) {
    var recipients = [];
    for (var current = peek(lines); current != null && current.startsWith("->"); current = peek(lines)) {
        var _a = current.slice(3, current.length).split(" "), type = _a[0], args = _a.slice(1);
        lines.shift();
        validateArguments(args);
        var body = parseRecipientBody(lines);
        if (!body) {
            throw Error("expected stanza '".concat(type, " to have a body, but it didn't"));
        }
        recipients.push({ type: type, args: args, body: Buffer.from(body, "base64") });
    }
    if (recipients.length === 0) {
        throw Error("Expected at least one stanza! (beginning with -->)");
    }
    return recipients;
}
function parseRecipientBody(lines) {
    var body = "";
    for (var next = peek(lines); next != null; next = peek(lines)) {
        body += lines.shift();
        if (next.length < 64) {
            break;
        }
    }
    return body;
}
function peek(arr) {
    return arr[0];
}
//# sourceMappingURL=age-reader-writer.js.map