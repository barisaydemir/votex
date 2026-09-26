import pyaudio

def list_devices():
    print("Mevcut Ses Giriş Cihazları (Mikrofonlar):\n" + "-"*40)
    p = pyaudio.PyAudio()
    info = p.get_host_api_info_by_index(0)
    numdevices = info.get('deviceCount')
    
    for i in range(0, numdevices):
        device = p.get_device_info_by_host_api_device_index(0, i)
        if device.get('maxInputChannels') > 0:
            print(f"Index [{i}]: {device.get('name')} (Kanal: {device.get('maxInputChannels')}, Hız: {device.get('defaultSampleRate')})")
    
    print("\nLütfen kullanmak istediğiniz mikrofonun solundaki Index [X] numarasını not alın.")
    p.terminate()

if __name__ == '__main__':
    list_devices()
    input("Kapatmak için Enter'a basın...")
