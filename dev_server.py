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
import sys
from http.server import SimpleHTTPRequestHandler, test


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    test(HandlerClass=NoCacheHandler, port=port)
