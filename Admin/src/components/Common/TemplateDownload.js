import React from "react";
import { Button } from "reactstrap";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

/* ---------- Excel templates ---------- */

// rows: array of objects. The keys of the first row become the heading row.
export const downloadExcelTemplate = ({ fileName, sheetName = "Sheet1", rows }) => {
  const header = rows.length ? Object.keys(rows[0]) : [];
  const sheet = XLSX.utils.json_to_sheet(rows, { header });
  sheet["!cols"] = header.map((key) => {
    const longest = rows.reduce((max, row) => Math.max(max, String(row[key] ?? "").length), key.length);
    return { wch: Math.min(Math.max(longest + 2, 12), 80) };
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, fileName);
};

/* ---------- Sample images ---------- */

const ICON_COLORS = ["#626ed4", "#02a499", "#38a4f8", "#f8b425", "#ec4561", "#7a6fbe"];

const initialsOf = (label) => {
  const words = String(label || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
};

const colorFor = (label) => {
  let hash = 0;
  for (const ch of String(label || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ICON_COLORS[hash % ICON_COLORS.length];
};

const drawIconBlob = (label, size = 256) =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const radius = size * 0.18;
    ctx.fillStyle = colorFor(label);
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.arcTo(size, 0, size, size, radius);
    ctx.arcTo(size, size, 0, size, radius);
    ctx.arcTo(0, size, 0, 0, radius);
    ctx.arcTo(0, 0, size, 0, radius);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(size * 0.4)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(label), size / 2, size / 2);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create image."))), "image/png");
  });

export const downloadSampleIcon = async (fileName, label) => {
  const blob = await drawIconBlob(label);
  saveAs(blob, fileName);
};

/* ---------- Minimal "stored" (uncompressed) ZIP writer ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

// entries: [{ name: string, data: Uint8Array }]. Returns an array of Uint8Array parts.
export const buildStoredZip = (entries, date = new Date()) => {
  const encoder = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  entries.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    // extra len, comment len, disk start, internal attrs, external attrs = 0
    cv.setUint32(42, offset, true); // local header offset
    cd.set(nameBytes, 46);

    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  });

  const cdSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true); // central directory offset

  return [...parts, ...central, end];
};

const PROFILE_PICS_README =
  "Profile pictures upload\n\n" +
  "- One image per student, named with the student's roll number, e.g. 21A91A0501.png\n" +
  "- PNG or JPG, at most 5 MB each\n" +
  "- Only students of your college are matched; other files are skipped\n" +
  "- Put all images in one .zip (max 50 MB) and upload it on the Profile Pictures page\n" +
  "- Square images (e.g. 256x256 or larger) look best\n";

export const downloadProfilePicsZipTemplate = async () => {
  const toBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const entries = [
    { name: "README.txt", data: new TextEncoder().encode(PROFILE_PICS_README) },
    { name: "21A91A0501.png", data: await toBytes(await drawIconBlob("21A91A0501")) },
    { name: "21A91A0502.png", data: await toBytes(await drawIconBlob("21A91A0502")) },
  ];
  saveAs(new Blob(buildStoredZip(entries), { type: "application/zip" }), "profile_pics_template.zip");
};

/* ---------- Button ---------- */

export const TemplateButton = ({ onClick, label = "Download template", className }) => (
  <Button color="secondary" outline size="sm" type="button" className={className} onClick={onClick}>
    <i className="bx bx-download me-1" />
    {label}
  </Button>
);

export default TemplateButton;
