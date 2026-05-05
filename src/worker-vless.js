// Deno Deploy 原生 VLESS 完整实现版
// 协议：VLESS over WebSocket + TLS
// 支持：TCP代理（IPv4 / IPv6 / 域名）

const userID = '6eb45ed4-2fe5-4a6d-9775-377ebcb3c0d7';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function validateUUID(buf, offset) {
  const expected = uuidToBytes(userID);
  for (let i = 0; i < 16; i++) {
    if (buf[offset + i] !== expected[i]) return false;
  }
  return true;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 访问 /{uuid} 返回节点链接
    if (url.pathname === `/${userID}`) {
      const host = url.hostname;
      const link = `vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=%2F#Deno-${host}`;
      return new Response(
        `<html><body><h3>✅ Deno VLESS 节点</h3><textarea rows="3" cols="90">${link}</textarea></body></html>`,
        { headers: { 'content-type': 'text/html;charset=UTF-8' } }
      );
    }

    // WebSocket 升级 → VLESS 代理
    if (request.headers.get('upgrade') === 'websocket') {
      return handleVLESS(request);
    }

    return new Response('OK');
  }
};

async function handleVLESS(request) {
  const { socket: ws, response } = Deno.upgradeWebSocket(request);
  let tcpConn = null;
  let headerParsed = false;

  ws.binaryType = 'arraybuffer';

  ws.onmessage = async (event) => {
    const raw = event.data;
    const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;

    if (!headerParsed) {
      // ── 解析 VLESS 协议头 ──
      let offset = 0;
      offset += 1; // version（跳过）

      if (!validateUUID(data, offset)) {
        ws.close(1008, 'Invalid UUID');
        return;
      }
      offset += 16;

      const addonLen = data[offset++];
      offset += addonLen; // 跳过 addon 字段

      const cmd = data[offset++];
      if (cmd !== 1) { // 仅支持 TCP(0x01)
        ws.close(1008, 'Unsupported command');
        return;
      }

      const port = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      const addrType = data[offset++];
      let host;

      if (addrType === 1) {         // IPv4
        host = `${data[offset]}.${data[offset+1]}.${data[offset+2]}.${data[offset+3]}`;
        offset += 4;
      } else if (addrType === 2) {  // 域名
        const len = data[offset++];
        host = new TextDecoder().decode(data.slice(offset, offset + len));
        offset += len;
      } else if (addrType === 3) {  // IPv6
        const parts = [];
        for (let i = 0; i < 8; i++) {
          parts.push(((data[offset] << 8) | data[offset + 1]).toString(16));
          offset += 2;
        }
        host = `[${parts.join(':')}]`;
      } else {
        ws.close(1008, 'Unknown addr type');
        return;
      }

      const payload = data.slice(offset);
      headerParsed = true;

      try {
        // 建立到目标的 TCP 连接
        tcpConn = await Deno.connect({ hostname: host, port });

        // 回复 VLESS 响应头（版本0 + addon长度0）
        ws.send(new Uint8Array([0x00, 0x00]));

        // 发送剩余 payload
        if (payload.length > 0) {
          await tcpConn.write(payload);
        }

        // TCP → WebSocket（持续读取转发）
        (async () => {
          const buf = new Uint8Array(32 * 1024);
          while (true) {
            let n;
            try { n = await tcpConn.read(buf); } catch { break; }
            if (n === null) break;
            try { ws.send(buf.slice(0, n).buffer); } catch { break; }
          }
          try { ws.close(); } catch {}
        })();

      } catch {
        try { ws.close(1011, 'Connect failed'); } catch {}
      }

    } else {
      // WebSocket → TCP（后续数据直接转发）
      if (tcpConn) {
        try {
          const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
          await tcpConn.write(chunk);
        } catch {
          try { ws.close(); } catch {}
        }
      }
    }
  };

  ws.onclose = () => { try { tcpConn?.close(); } catch {} };
  ws.onerror = () => { try { tcpConn?.close(); } catch {} };

  return response;
}
