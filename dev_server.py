#!/usr/bin/env python3
"""Servidor de desenvolvimento com cache DESLIGADO.

Substitui `python3 -m http.server 8000`. Manda `Cache-Control: no-store` em toda
resposta, então o navegador (e o túnel cloudflared) NUNCA servem JS/CSS antigos —
os módulos ES importados sem `?v=` (Game.js → Player.js → Character.js …) sempre
recarregam. Uso:

    python3 dev_server.py          # porta 8000 (mesma do túnel)
    python3 dev_server.py 8123     # outra porta

O túnel continua apontando para localhost:8000; é só reiniciar o server.
"""
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


# Melhorias de conforto no playtest (NÃO são a causa do antigo travamento de
# carregamento no celular — esse era consumo de memória no cliente; ver
# AnimationManager.loadAll).
class Server(ThreadingHTTPServer):
    # ThreadingHTTPServer: o padrão (HTTPServer) atende UMA conexão por vez, e o
    # jogo pede 7 FBX de uma vez (~47MB) — celular e PC testando juntos ficavam
    # em fila atrás de downloads longos.
    #
    # address_family: `http.server` no Windows escuta só em `::` (IPv6) com
    # dual-stack desligado, então o celular na mesma Wi-Fi (que chega por IPv4)
    # tomava "connection refused" e só restava o túnel, bem mais lento
    # (upload de casa medido em ~230KB/s). Bind IPv4 permite testar pela LAN.
    address_family = socket.AF_INET


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = Server(("0.0.0.0", port), NoCacheHandler)
    print(f"Servindo em http://0.0.0.0:{port} (todas as interfaces IPv4)")
    httpd.serve_forever()
