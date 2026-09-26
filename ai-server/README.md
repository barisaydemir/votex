# VOTEX AI Server 🤖

Yerel yapay zeka modelleri için FastAPI servisi.
VOTEX masaüstü uygulamasıyla entegre çalışır.

## Kurulum

```bash
cd ai-server
pip install -r requirements.txt
```

## Çalıştırma

```bash
# Varsayılan (port 8080, Ollama localhost:11434)
python server.py

# Özel port
python server.py --port 9090

# Özel Ollama URL
python server.py --ollama http://192.168.1.100:11434
```

## Gereksinimler

- Python 3.10+
- [Ollama](https://ollama.ai) kurulu ve çalışıyor olmalı

### Önerilen Modeller

```bash
# Hızlı LLM (genel sohbet)
ollama pull gemma2:2b

# Görüntü analizi (manyetik harita yorumlama)
ollama pull llava:7b

# Hafif vision
ollama pull moondream
```

## API Endpoints

| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/status` | GET | Sunucu durumu |
| `/analyze/image` | POST | Görsel analiz (vision model) |
| `/detect/anomaly` | POST | Manyetik anomali tespiti |
| `/generate/report` | POST | Profesyonel rapor üretme |
| `/chat` | POST | Genel sohbet |
| `/chat` (stream) | POST | Streaming sohbet (SSE) |
| `/ws` | WebSocket | Canlı bağlantı |
| `/models/list` | GET | Kullanılabilir modeller |
| `/models/pull?name=...` | POST | Model indirme |

## VOTEX Entegrasyonu

VOTEX uygulamasında:
- **🤖 Yapay Zeka** butonuna tıklayın veya **Ctrl+I** tuşlayın
- Sunucu URL'sini ayarlayın (varsayılan: `http://127.0.0.1:8080`)
- **Bağlan** butonuna tıklayın
- Model seçin ve analizleri çalıştırın

## Bağımsız Kullanım

```bash
# Görsel analiz
curl -X POST http://localhost:8080/analyze/image \
  -H "Content-Type: application/json" \
  -d '{"image_base64": "BASE64_IMAGE", "prompt": "Bu haritada yapıları analiz et"}'

# Chat
curl -X POST http://localhost:8080/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Manyetik anomali nedir?"}'
```
