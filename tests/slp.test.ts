import { describe, expect, it, afterEach } from 'vitest';
import net from 'node:net';
import {
  encodeVarInt, decodeVarInt, handshakePacket, STATUS_REQUEST, parseStatusResponse, pingServer,
} from '../src/lib/slp';

function frame(id: number, payload: Buffer) {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}
function statusPacket(json: string) {
  const s = Buffer.from(json, 'utf8');
  return frame(0, Buffer.concat([encodeVarInt(s.length), s]));
}

describe('VarInt', () => {
  it.each([0, 1, 127, 128, 255, 25565, 2097151, 2147483647, -1])('round-trips %i', (n) => {
    const enc = encodeVarInt(n);
    expect(decodeVarInt(enc)).toEqual({ value: n, size: enc.length });
  });
  it('encodes known values', () => {
    expect([...encodeVarInt(300)]).toEqual([0xac, 0x02]);
    expect([...encodeVarInt(-1)]).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
  });
  it('returns null when incomplete', () => {
    expect(decodeVarInt(Buffer.from([0x80]))).toBeNull();
  });
  it('throws when longer than 5 bytes', () => {
    expect(() => decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]))).toThrow();
  });
});

describe('packets', () => {
  it('builds a handshake for the status state', () => {
    const p = handshakePacket('a.b', 25565);
    const len = decodeVarInt(p)!;
    expect(p.length).toBe(len.size + len.value);
    expect(p[len.size]).toBe(0x00);           // packet id
    expect(p.subarray(-3, -1).readUInt16BE()).toBe(25565);
    expect(p[p.length - 1]).toBe(0x01);        // next state = status
  });
  it('status request is an empty packet 0x00', () => {
    expect([...STATUS_REQUEST]).toEqual([0x01, 0x00]);
  });
  it('parses a complete status response', () => {
    expect(parseStatusResponse(statusPacket('{"a":1}'))).toBe('{"a":1}');
  });
  it('returns null for a partial response', () => {
    const full = statusPacket('{"a":1}');
    expect(parseStatusResponse(full.subarray(0, full.length - 2))).toBeNull();
  });
  it('throws on an unexpected packet id', () => {
    expect(() => parseStatusResponse(frame(5, Buffer.alloc(1)))).toThrow(/packet id/);
  });
});

describe('pingServer', () => {
  let server: net.Server | undefined;
  afterEach(() => server?.close());

  function listen(onConn: (s: net.Socket) => void): Promise<number> {
    return new Promise((resolve) => {
      server = net.createServer(onConn);
      server.listen(0, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port));
    });
  }

  it('resolves the JSON from a server that answers in two chunks', async () => {
    const port = await listen((s) => {
      s.once('data', () => {
        const pkt = statusPacket('{"version":{"name":"1.21.1"}}');
        s.write(pkt.subarray(0, 4));
        setTimeout(() => s.write(pkt.subarray(4)), 20);
      });
    });
    await expect(pingServer('127.0.0.1', port, 1000)).resolves.toEqual({ version: { name: '1.21.1' } });
  });

  it('rejects on timeout when the server never answers', async () => {
    const port = await listen(() => {});
    await expect(pingServer('127.0.0.1', port, 200)).rejects.toThrow(/timeout/);
  });

  it('rejects when the connection is refused', async () => {
    const port = await listen(() => {});
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await expect(pingServer('127.0.0.1', port, 1000)).rejects.toThrow();
  });
});
