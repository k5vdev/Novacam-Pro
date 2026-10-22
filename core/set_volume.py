import os
import sys
import subprocess
from pycaw.pycaw import AudioUtilities

def set_volume(vol_pct, serial=None, pid=None):
    # 1. Ajustar volumen en Windows para el proceso scrcpy.exe
    level = max(0.0, min(1.0, float(vol_pct) / 100.0))
    try:
        sessions = AudioUtilities.GetAllSessions()
        for session in sessions:
            if session.Process and session.Process.name() and session.Process.name().lower() == "scrcpy.exe":
                # Con varios teléfonos hay varios scrcpy.exe: solo se toca el del dispositivo indicado
                if pid is not None and session.Process.pid != pid:
                    continue
                session.SimpleAudioVolume.SetMasterVolume(level, None)
    except Exception as e:
        pass

    # 2. Si el volumen es mayor a 100% o si se controla audio del sistema en Android, sincronizar con ADB
    if serial:
        try:
            adb_path = os.environ.get("NOVACAM_ADB", "adb")
            # Android fine volume scale es 0-150
            fine_vol = int(max(0, min(150, (float(vol_pct) / 100.0) * 150)))
            subprocess.run(
                [adb_path, "-s", serial, "shell", "cmd", "media_session", "volume", "--stream", "3", "--setfine", str(fine_vol)],
                capture_output=True, timeout=2,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
            )
        except Exception:
            pass

if __name__ == "__main__":
    if len(sys.argv) > 1:
        vol = float(sys.argv[1])
        ser = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
        target_pid = int(sys.argv[3]) if len(sys.argv) > 3 else None
        set_volume(vol, ser, target_pid)
