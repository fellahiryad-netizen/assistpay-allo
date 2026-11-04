/* Lecteur zip / xlsx en flux, exécuté dans le navigateur : le consolidé CAAT pèse plus de 60 Mo, on ne le charge pas en entier. */

/** Entrée d'une archive zip. */
export interface ZipEntry {
  name: string;
  meth: number;
  cs: number;
  us: number;
  off: number;
}

/** Liste le contenu d'un zip (ou d'un xlsx) sans le lire en entier. */
export async function zipList(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  const tl = Math.min(size, 65558);
  const tail = new DataView(await blob.slice(size - tl).arrayBuffer());
  let e = -1;
  for (let i = tl - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error("Archive illisible (ce n'est pas un zip ou un xlsx valide).");
  const n = tail.getUint16(e + 10, true);
  const cs = tail.getUint32(e + 12, true);
  const co = tail.getUint32(e + 16, true);
  const buf = await blob.slice(co, co + cs).arrayBuffer();
  const cd = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < n && p + 46 <= u8.length; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const fl = cd.getUint16(p + 8, true);
    const nl = cd.getUint16(p + 28, true);
    const xl = cd.getUint16(p + 30, true);
    const cl = cd.getUint16(p + 32, true);
    out.push({
      name: new TextDecoder(fl & 0x800 ? "utf-8" : "windows-1252").decode(u8.subarray(p + 46, p + 46 + nl)),
      meth: cd.getUint16(p + 10, true),
      cs: cd.getUint32(p + 20, true),
      us: cd.getUint32(p + 24, true),
      off: cd.getUint32(p + 42, true),
    });
    p += 46 + nl + xl + cl;
  }
  return out;
}

async function zipStream(blob: Blob, en: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const h = new DataView(await blob.slice(en.off, en.off + 30).arrayBuffer());
  const start = en.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = blob.slice(start, start + en.cs).stream();
  if (en.meth === 0) return raw;
  if (en.meth !== 8) throw new Error("Méthode de compression non gérée.");
  return raw.pipeThrough(new DecompressionStream("deflate-raw")) as ReadableStream<Uint8Array>;
}

/** Contenu binaire d'une entrée. */
export async function zipBuffer(blob: Blob, en: ZipEntry): Promise<ArrayBuffer> {
  return await new Response(await zipStream(blob, en)).arrayBuffer();
}

async function zipText(blob: Blob, en: ZipEntry): Promise<string> {
  return new TextDecoder("utf-8").decode(await zipBuffer(blob, en));
}

async function eachChunk(stream: ReadableStream<Uint8Array>, fn: (text: string) => void | Promise<void>): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    await fn(decoder.decode(r.value, { stream: true }));
  }
  const rest = decoder.decode();
  if (rest) await fn(rest);
}

const unesc = (s: string): string =>
  s.indexOf("&") < 0
    ? s
    : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, k: string) =>
        k === "amp" ? "&" : k === "lt" ? "<" : k === "gt" ? ">" : k === "quot" ? '"' : k === "apos" ? "'" : String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)),
      );

async function sharedStrings(blob: Blob, en: ZipEntry): Promise<string[]> {
  const out: string[] = [];
  let buf = "";
  await eachChunk(await zipStream(blob, en), (t) => {
    buf += t;
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(buf))) {
      last = re.lastIndex;
      const x = (m[1] ?? "").replace(/<rPh[\s\S]*?<\/rPh>/g, "");
      let s = "";
      const rt = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let q: RegExpExecArray | null;
      while ((q = rt.exec(x))) s += q[1] ?? "";
      out.push(unesc(s));
    }
    buf = buf.slice(last);
  });
  return out;
}

const colIdx = (letters: string): number => {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n - 1;
};

/** Cellule lue : texte, nombre, booléen ou vide. */
export type StreamCell = string | number | boolean | null | undefined;

/** Parcourt les lignes d'une feuille en flux ; `onRow(numéro de ligne, cellules)`. */
export async function sheetRows(blob: Blob, en: ZipEntry, sst: string[], onRow: (rn: number, cells: StreamCell[]) => void): Promise<void> {
  let buf = "";
  let seen = 0;
  await eachChunk(await zipStream(blob, en), async (t) => {
    buf += t;
    const re = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(buf))) {
      last = re.lastIndex;
      if (m[1] == null) continue;
      const rn = Number(/\sr="(\d+)"/.exec(m[0])?.[1] ?? 0);
      const cells: StreamCell[] = [];
      const rc = /<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c: RegExpExecArray | null;
      while ((c = rc.exec(m[1]))) {
        if (c[3] == null) continue;
        const ty = /\bt="(\w+)"/.exec(c[2] ?? "")?.[1] ?? "n";
        let v: StreamCell = null;
        if (ty === "inlineStr") {
          let s = "";
          const rt = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
          let q: RegExpExecArray | null;
          while ((q = rt.exec(c[3]))) s += q[1] ?? "";
          v = unesc(s);
        } else {
          const q = /<v>([\s\S]*?)<\/v>/.exec(c[3]);
          if (!q) continue;
          const raw = q[1] ?? "";
          v = ty === "s" ? sst[Number(raw)] : ty === "str" || ty === "e" ? unesc(raw) : ty === "b" ? raw === "1" : Number(raw);
        }
        cells[colIdx(c[1] ?? "A")] = v;
      }
      onRow(rn, cells);
      if (++seen % 20000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    buf = buf.slice(last);
  });
}

/** Ouvre un classeur xlsx : feuilles par nom (majuscules), entrées du zip et libellés partagés. */
export async function openWorkbook(file: Blob): Promise<{ ents: ZipEntry[]; sheets: Record<string, string>; get: (name: string) => ZipEntry | undefined; sst: () => Promise<string[]> }> {
  const ents = await zipList(file);
  const get = (name: string): ZipEntry | undefined => ents.find((e) => e.name === name);
  const wbE = get("xl/workbook.xml");
  const relE = get("xl/_rels/workbook.xml.rels");
  if (!wbE || !relE) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx).");
  const wbx = await zipText(file, wbE);
  const rels = await zipText(file, relE);
  const rid: Record<string, string> = {};
  for (const m of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const i = /\bId="([^"]+)"/.exec(m);
    const t = /\bTarget="([^"]+)"/.exec(m);
    if (i?.[1] && t?.[1]) rid[i[1]] = t[1].replace(/^\/?(xl\/)?/, "xl/");
  }
  const sheets: Record<string, string> = {};
  for (const m of wbx.match(/<sheet\b[^>]*>/g) ?? []) {
    const n = /\bname="([^"]*)"/.exec(m);
    const r = /\br:id="([^"]+)"/.exec(m);
    const target = r?.[1] ? rid[r[1]] : undefined;
    if (n?.[1] !== undefined && target) sheets[unesc(n[1]).trim().toUpperCase()] = target;
  }
  return {
    ents,
    sheets,
    get,
    sst: async () => {
      const e = get("xl/sharedStrings.xml");
      return e ? await sharedStrings(file, e) : [];
    },
  };
}
