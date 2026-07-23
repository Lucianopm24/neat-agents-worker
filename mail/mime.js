// 📮 Mini parser MIME (byte-fiel vía latin1: 1 char = 1 byte, sin corrupción)
// Suficiente para correo real: headers plegados, encoded-words RFC2047, multipart,
// base64/quoted-printable, charsets vía TextDecoder, adjuntos (solo metadatos).
const LATIN1 = new TextDecoder("latin1");

export const strToBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const b64ToBytes = (s) => { const bin = atob(s.replace(/\s+/g, "")); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
const qpToBytes = (s) => {
  s = s.replace(/=\r?\n/g, ""); // soft breaks
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && i + 2 < s.length && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
};
const charsetDecode = (bytes, cs) => { try { return new TextDecoder(String(cs || "utf-8").toLowerCase()).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); } };

// RFC2047: =?UTF-8?B?...?= y =?ISO-8859-1?Q?...?= (varios seguidos incluidos)
export function decodeWords(s = "") {
  // 1) RFC2047: whitespace ENTRE encoded-words no cuenta (se concatenan)
  s = s.replace(/(\?=)[ \t\r\n]+(?==\?)/g, "$1");
  // 2) decodifica =?charset?B/Q?texto?= (varios seguidos incluidos)
  return s.replace(/=\?([^?]+)\?([bBqQ])\?((?:[^?]|\?(?!=))\S*)\?=/g, (m, cs, enc, txt) => {
    try { return charsetDecode(enc.toUpperCase() === "B" ? b64ToBytes(txt) : qpToBytes(txt.replace(/_/g, " ")), cs); }
    catch { return m; }
  });
}

const unfold = (head) => head.split(/\r?\n/).reduce((acc, l) => { if (l && /^[ \t]/.test(l) && acc.length) acc[acc.length - 1] += " " + l.trim(); else if (l) acc.push(l.trimEnd()); return acc; }, []);

function splitHeadBody(text) {
  const m = text.match(/\r?\n\r?\n/);
  if (!m) return { head: text, body: "" };
  return { head: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

export function parseHeaders(head) {
  const h = {};
  for (const line of unfold(head)) {
    const i = line.indexOf(":"); if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    (h[k] = h[k] || []).push(v);
  }
  h.get = (k) => (h[k.toLowerCase()] || [null])[0];
  return h;
}

// "Nombre Bonito <a@b.c>" → {name (decodificado), addr}
export function parseAddr(v = "") {
  const m = v.match(/^(.*)<([^>]+)>\s*$/);
  if (m) return { name: decodeWords(m[1].trim().replace(/^"|"$/g, "")), addr: m[2].trim().toLowerCase() };
  return { name: "", addr: v.trim().toLowerCase() };
}

// content-type/disposition: valor + params (soporta comillas; ignora RFC2231 avanzado)
function parseParams(v = "") {
  const parts = v.split(";").map((p) => p.trim());
  const out = { value: (parts.shift() || "").toLowerCase(), params: {} };
  for (const p of parts) { const i = p.indexOf("="); if (i < 1) continue; let val = p.slice(i + 1).trim(); val = val.replace(/^"|"$/g, ""); out.params[p.slice(0, i).trim().toLowerCase()] = val; }
  return out;
}

function parsePart(text, parts) {
  const { head, body } = splitHeadBody(text);
  const h = parseHeaders(head);
  const ct = parseParams(h.get("content-type") || "text/plain");
  const cd = parseParams(h.get("content-disposition") || "");
  const cte = (h.get("content-transfer-encoding") || "7bit").toLowerCase();
  if (ct.value.startsWith("multipart/")) {
    const bnd = ct.params.boundary;
    if (bnd) {
      const segs = body.split("--" + bnd);
      for (let i = 1; i < segs.length; i++) {
        let seg = segs[i];
        if (seg.startsWith("--")) break;
        if (seg.startsWith("\r\n")) seg = seg.slice(2); else if (seg.startsWith("\n")) seg = seg.slice(1);
        parsePart(seg, parts);
      }
      return parts;
    }
  }
  const isAttach = cd.value === "attachment" || !!cd.params.filename || !!ct.params.name;
  if (!isAttach && (ct.value === "text/plain" || ct.value === "text/html")) {
    const bytes = cte === "base64" ? b64ToBytes(body) : cte === "quoted-printable" ? qpToBytes(body) : strToBytes(body);
    parts.push({ kind: ct.value === "text/html" ? "html" : "text", content: charsetDecode(bytes, ct.params.charset) });
  } else {
    const name = decodeWords(cd.params.filename || ct.params.name || "");
    let size = 0;
    try { size = cte === "base64" ? b64ToBytes(body).length : body.length; } catch { size = body.length; }
    parts.push({ kind: "attachment", filename: name || ct.value, ctype: ct.value, size });
  }
  return parts;
}

// parseMime(Uint8Array) → {subject, from:{name,addr}, to, date, text, html, attachments:[{filename,ctype,size}]}
export function parseMime(buf) {
  const raw = LATIN1.decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const { head, body } = splitHeadBody(raw);
  const h = parseHeaders(head);
  const ct = parseParams(h.get("content-type") || "text/plain");
  let parts;
  if (ct.value.startsWith("multipart/")) parts = parsePart(raw, []);
  else {
    parts = [];
    const cte = (h.get("content-transfer-encoding") || "7bit").toLowerCase();
    const bytes = cte === "base64" ? b64ToBytes(body) : cte === "quoted-printable" ? qpToBytes(body) : strToBytes(body);
    parts.push({ kind: ct.value === "text/html" ? "html" : "text", content: charsetDecode(bytes, ct.params.charset) });
  }
  return {
    subject: decodeWords(h.get("subject") || ""),
    from: parseAddr(h.get("from") || ""),
    to: parseAddr(h.get("to") || ""),
    date: h.get("date") || null,
    text: (parts.find((p) => p.kind === "text") || {}).content || null,
    html: (parts.find((p) => p.kind === "html") || {}).content || null,
    attachments: parts.filter((p) => p.kind === "attachment").map(({ filename, ctype, size }) => ({ filename, ctype, size })),
  };
}
