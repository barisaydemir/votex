import threading
from flask import Flask, request, jsonify

app = Flask(__name__)
_message_callback = None

@app.route('/api/message', methods=['POST'])
def handle_message():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({"error": "Invalid request. 'message' field is required."}), 400
    
    message = data['message']
    
    if _message_callback:
        # Mesajı Jarvis çekirdeğine ilet
        _message_callback(message)
        return jsonify({"status": "success", "message": "Message delivered to Jarvis."}), 200
    else:
        return jsonify({"error": "Jarvis core is not ready."}), 503

def start_api_server(callback, port=5000):
    global _message_callback
    _message_callback = callback
    
    def run_server():
        # Flask'ın kendi loglarını kapatıyoruz (ekranda kirlilik yapmasın diye)
        import logging
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)
        
        # Sadece yerel ağdan gelecek isteklere açıyoruz (0.0.0.0)
        app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)

    # Arka planda sunucuyu başlatıyoruz
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    return server_thread
