// @ts-nocheck
// Terminal formatting: ANSI codes and width-aware string helpers (CJK counts 2).
export const E = "\x1b[";
export const RST = E + "0m";
export const BOLD = E + "1m";
export const DIM = E + "2m";
export const GRAY = E + "90m";
export const WHITE = E + "37m";
export const YELLOW = E + "33m";
export const GREEN = E + "32m";
export const CYAN = E + "36m";
export const RED = E + "31m";
export const BLUE = E + "34m";
export const MAGENTA = E + "35m";
export const BG_SEL = E + "48;5;236m";
export const CLR = E + "K";

export function stringWidth(str) {
  var w = 0;
  str = String(str || "").replace(/\x1b\[[0-9;]*m/g, "");
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0x1100 && c <= 0xD7AF || c >= 0x3040 && c <= 0x313F || c >= 0xF900 && c <= 0xFAFF || c >= 0xFF00 && c <= 0xFFEF) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

export function pad(s, len) {
  s = String(s || "");
  var w = stringWidth(s);
  var padStr = "";
  while (w < len) { padStr += " "; w++; }
  return s + padStr;
}

export function trunc(s, len) {
  s = String(s || "");
  if (stringWidth(s) <= len) return s;
  var res = "";
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var cw = stringWidth(s[i]);
    if (w + cw > len - 3) break;
    w += cw;
    res += s[i];
  }
  return res + "...";
}

export function timeAgo(ts) {
  if (!ts) return "--";
  var d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}
