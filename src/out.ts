// @ts-nocheck
// Terminal output: buffered writes to stderr and cursor visibility.

import { E } from "./format.js";
import { S } from "./state.js";

export function b(s) { S._buf += s; }
export function flush() { process.stderr.write(S._buf); S._buf = ""; }
export function hideCur() { process.stderr.write(E + "?25l"); }
export function showCur() { process.stderr.write(E + "?25h"); }
