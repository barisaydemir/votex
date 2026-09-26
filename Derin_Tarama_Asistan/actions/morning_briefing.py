from actions.weather import get_weather_summary
from actions.calendar import get_calendar_events
from actions.reminders import get_reminders
from actions.sys_info import sys_info

def get_morning_briefing() -> str:
    parts = []
    
    # 1. Hava Durumu (Bursa varsayılan)
    weather = get_weather_summary()
    parts.append("HAVA DURUMU:")
    parts.append(weather)
    
    # 2. Takvim Etkinlikleri
    calendar = get_calendar_events("today", 5)
    parts.append("\nBUGÜNKÜ TAKVİM:")
    parts.append(calendar)
    
    # 3. Anımsatıcılar
    reminders = get_reminders("today", 5, "")
    parts.append("\nBUGÜNKÜ YAPILACAKLAR:")
    parts.append(reminders)
    
    # 4. Sistem Saati/Tarihi
    time_info = sys_info("time")
    parts.insert(0, f"GÜNLÜK ÖZET ({time_info}):\n")
    
    return "\n".join(parts)
