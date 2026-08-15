/**
 * MD5 (RFC 1321) — implémentation locale : WebCrypto n'expose pas MD5,
 * et le HA1 Digest (RFC 2617) en a besoin. Vecteurs de test dans
 * test/ha1.test.ts.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

const K = new Uint32Array(64);
for (let j = 0; j < 64; j++) {
  K[j] = Math.floor(Math.abs(Math.sin(j + 1)) * 0x100000000);
}

function wordToHexLE(n: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return s;
}

export function md5(input: string): string {
  const msg = new TextEncoder().encode(input);
  const nWords = (((msg.length + 8) >> 6) + 1) * 16;
  const words = new Uint32Array(nWords);
  for (let i = 0; i < msg.length; i++) {
    words[i >> 2]! |= msg[i]! << ((i % 4) * 8);
  }
  words[msg.length >> 2]! |= 0x80 << ((msg.length % 4) * 8);
  const bitLen = msg.length * 8;
  words[nWords - 2] = bitLen >>> 0;
  words[nWords - 1] = Math.floor(bitLen / 0x100000000);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < nWords; i += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;
    for (let j = 0; j < 64; j++) {
      let f: number;
      let g: number;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }
      const shift = S[j]!;
      const x = (a + f + K[j]! + words[i + g]!) | 0;
      const rotated = (x << shift) | (x >>> (32 - shift));
      a = d;
      d = c;
      c = b;
      b = (b + rotated) | 0;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }

  return wordToHexLE(a) + wordToHexLE(b) + wordToHexLE(c) + wordToHexLE(d);
}
