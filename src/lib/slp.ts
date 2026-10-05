import net from 'node:net';

const MAX_RESPONSE_BYTES = 1024 * 1024;

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

export function decodeVarInt(buf: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0;
  let size = 0;
  let b: number;
  do {
    if (size >= 5) throw new Error('VarInt too long');
    if (offset + size >= buf.length) return null;
    b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
  } while (b & 0x80);
  return { value: value | 0, size };
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function mcString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([encodeVarInt(b.length), b]);
}

export function handshakePacket(host: string, port: number, protocol = -1): Buffer {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return packet(0x00, Buffer.concat([encodeVarInt(protocol), mcString(host), portBuf, encodeVarInt(1)]));
}

export const STATUS_REQUEST = packet(0x00, Buffer.alloc(0));

export function parseStatusResponse(buf: Buffer): string | null {
  const len = decodeVarInt(buf, 0);
  if (!len) return null;
  if (buf.length < len.size + len.value) return null;
  let off = len.size;
  const id = decodeVarInt(buf, off);
  if (!id) return null;
  if (id.value !== 0x00) throw new Error(`unexpected packet id ${id.value}`);
  off += id.size;
  const strLen = decodeVarInt(buf, off);
  if (!strLen) return null;
  off += strLen.size;
  return buf.subarray(off, off + strLen.value).toString('utf8');
}

export function pingServer(host: string, port: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let data = Buffer.alloc(0);
    const socket = net.createConnection({ host, port });
    const finish = (err: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    socket.once('error', (e) => finish(e));
    socket.once('close', () => finish(new Error('connection closed')));
    socket.once('connect', () => socket.write(Buffer.concat([handshakePacket(host, port), STATUS_REQUEST])));
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_RESPONSE_BYTES) return finish(new Error('response too large'));
      try {
        const json = parseStatusResponse(data);
        if (json !== null) finish(null, JSON.parse(json));
      } catch (e) {
        finish(e as Error);
      }
    });
  });
}
