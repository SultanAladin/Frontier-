import http.server, socketserver, os
os.chdir('/home/user/Frontier-')
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/','/index.html'):
            self.send_response(302)
            self.send_header('Location','/Scratchpad/RockFieldPreview/index.html')
            self.end_headers(); return
        return super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def log_message(self,f,*a): pass
socketserver.TCPServer.allow_reuse_address=True
with socketserver.TCPServer(("0.0.0.0",8080),H) as s: s.serve_forever()
