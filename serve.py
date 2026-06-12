"""
serve.py — Servidor HTTP simples para o Painel DER-PR.

Uso:
    python serve.py           # porta padrão 8080
    python serve.py 9090      # porta customizada

O painel estará disponível em:
    http://localhost:8080/dashboard/painel_der.html
"""

import json
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

JSON_PATH = "data/der_precomputed.json"
PIPELINE  = "pipeline/assemble_der.py"
PORT      = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
URL       = f"http://localhost:{PORT}/dashboard/painel_der.html"


class ThreadedServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class QuietHandler(SimpleHTTPRequestHandler):
    """Handler silencioso — suprime logs de cada requisição."""
    def log_message(self, *args):
        pass


def main():
    # Garante que o JSON existe; se não, gera via pipeline
    if not os.path.exists(JSON_PATH):
        print(f"JSON não encontrado em '{JSON_PATH}'. Executando pipeline…")
        result = subprocess.run([sys.executable, PIPELINE], check=True)
        if result.returncode != 0:
            print("Erro ao executar o pipeline. Verifique as planilhas em data/.")
            sys.exit(1)
    else:
        with open(JSON_PATH, encoding="utf-8") as f:
            meta = json.load(f)
        print(f"JSON carregado — gerado em: {meta.get('generated', '?')}")

    # Abre o browser após breve delay (aguarda servidor iniciar)
    threading.Timer(0.8, lambda: webbrowser.open(URL)).start()

    # Inicia servidor HTTP
    server = ThreadedServer(("", PORT), QuietHandler)
    print(f"Servidor rodando em http://localhost:{PORT}")
    print(f"Painel: {URL}")
    print("Pressione Ctrl+C para encerrar.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")


if __name__ == "__main__":
    main()
