#!/usr/bin/env python3
import http.server, socketserver, sys, os

DEFAULT_PORT = 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'unsafe-none')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        super().end_headers()

with socketserver.TCPServer(("", DEFAULT_PORT), Handler) as httpd:
    print(f"Serving at http://localhost:{DEFAULT_PORT}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
