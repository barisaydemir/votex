"""
Model Manager — Model indirme, yükleme ve yaşam döngüsü yönetimi.
"""

import json
import os
from pathlib import Path
from typing import Optional


# Önerilen modeller — VOTEX için optimize edilmiş
RECOMMENDED_MODELS = {
    "llm_small": {
        "name": "gemma2:2b",
        "description": "Hızlı, hafif LLM — genel sohbet ve kısa raporlar",
        "size_approx": "1.6 GB",
        "use_case": "Hızlı yanıtlar, basit analiz",
    },
    "llm_medium": {
        "name": "gemma2:9b",
        "description": "Dengeli LLM — detaylı analiz ve raporlama",
        "size_approx": "5.5 GB",
        "use_case": "Derin analiz, profesyonel raporlar",
    },
    "llm_large": {
        "name": "llama3.1:8b",
        "description": "Güçlü LLM — karmaşık jeofizik yorumlama",
        "size_approx": "4.7 GB",
        "use_case": "Karmaşık yapı analizi, çok dilli rapor",
    },
    "vision": {
        "name": "llava:7b",
        "description": "Görüntü + metin — manyetik harita görsel analizi",
        "size_approx": "4.7 GB",
        "use_case": "Harita görsellerinden yapı tespiti",
    },
    "vision_small": {
        "name": "moondream",
        "description": "Hafif vision modeli — hızlı görsel yorumlama",
        "size_approx": "1.7 GB",
        "use_case": "Hızlı görsel tarama",
    },
}


class ModelManager:
    """Model lifecycle yönetimi."""

    def __init__(self, config_dir: str = ".votex-ai"):
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(exist_ok=True)
        self.config_file = self.config_dir / "models.json"
        self._config = self._load_config()

    def _load_config(self) -> dict:
        if self.config_file.exists():
            return json.loads(self.config_file.read_text())
        return {"custom_models": [], "preferred": {}, "history": []}

    def _save_config(self):
        self.config_file.write_text(json.dumps(self._config, indent=2, default=str))

    def get_recommended(self) -> list[dict]:
        """Önerilen modelleri listele."""
        return [
            {"id": k, **v}
            for k, v in RECOMMENDED_MODELS.items()
        ]

    def get_preferred(self, task: str) -> Optional[str]:
        """Belirli bir görev için tercih edilen modeli döndür."""
        return self._config.get("preferred", {}).get(task)

    def set_preferred(self, task: str, model_name: str):
        """Belirli bir görev için tercih edilen modeli kaydet."""
        if "preferred" not in self._config:
            self._config["preferred"] = {}
        self._config["preferred"][task] = model_name
        self._save_config()

    def add_history(self, task: str, model: str, success: bool):
        """Model kullanım geçmişini kaydet."""
        import time
        self._config.setdefault("history", []).append({
            "task": task,
            "model": model,
            "success": success,
            "time": time.time(),
        })
        # Son 100 kaydı tut
        self._config["history"] = self._config["history"][-100:]
        self._save_config()
