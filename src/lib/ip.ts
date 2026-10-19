export function ipToBytes(ip: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return new Uint8Array(v4.split('.').map(Number));
  return null;
}
