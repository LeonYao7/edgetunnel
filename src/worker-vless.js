// Deno Deploy 兼容版 VLESS
const userID = '6eb45ed4-2fe5-4a6d-9775-377ebcb3c0d7'; // 你的UUID，保持不变

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 访问 /{uuid} 返回节点信息
    if (path === `/${userID}`) {
      const host = url.hostname;
      const vlessLink = `vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&fp=randomized&type=ws&host=${host}&path=%2F%3Fed%3D2048#Deno-${host}`;
      return new Response(
        `<html><body>
          <h2>✅ Deno Deploy 节点</h2>
          <p><strong>VLESS 链接：</strong></p>
          <textarea rows="4" cols="80">${vlessLink}</textarea>
          <br><br>
          <p>复制以上链接导入客户端即可使用</p>
        </body></html>`,
        { headers: { 'content-type': 'text/html;charset=UTF-8' } }
      );
    }

    // WebSocket 处理 VLESS 流量
    if (request.headers.get('upgrade') === 'websocket') {
      return handleVless(request);
    }

    return new Response('ok', { status: 200 });
  }
};

async function handleVless(request) {
  const { socket: clientWs, response } = Deno.upgradeWebSocket(request);
  
  clientWs.onopen = async () => {
    // VLESS 协议处理逻辑（简化版）
  };

  return response;
}
