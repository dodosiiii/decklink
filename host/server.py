import os, sys, json, socket, subprocess, platform, base64, io, time, math, re, threading, urllib.request, urllib.parse, struct, ctypes, tempfile
from pathlib import Path
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit
import psutil

BASE_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = BASE_DIR / "client"
CONFIG_PATH = BASE_DIR / "host" / "config.json"
SCRIPT_DIR = BASE_DIR / "host"

app = Flask(__name__, static_folder=str(CLIENT_DIR), static_url_path="")
app.config["SECRET_KEY"] = "decklink_secret"
socketio = SocketIO(app, cors_allowed_origins="*")

config = {}
_cached_net_io = psutil.net_io_counters()
_is_admin = False
_cached_media = {"data":None,"time":0}
_media_rich_cache = {"data":None,"key":"","time":0}

try: _is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
except: pass

def load_config():
    global config
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            config = json.load(f)
    except:
        config = {"server": {"port": 5000}, "theme": {}, "setup": {"done": False}, "buttons": [], "quick_actions": []}
    return config

def save_config(n):
    global config; config = n
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    return config

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except: return "127.0.0.1"

def run_ps(script, timeout=15):
    try:
        proc = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                            capture_output=True, text=True, timeout=timeout)
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except subprocess.TimeoutExpired: return "", "Timeout", -1
    except Exception as e: return "", str(e), -1

def run_ps_file(script_name, timeout=15):
    path = SCRIPT_DIR / script_name
    try:
        proc = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(path)],
                            capture_output=True, text=True, timeout=timeout)
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except subprocess.TimeoutExpired: return "", "Timeout", -1
    except Exception as e: return "", str(e), -1

def launch_app(item):
    path = item.get("path","").strip().strip('"').strip("'"); args = item.get("args",[]); typ = item.get("type","app"); wd = item.get("working_dir")
    try:
        if typ == "url": import webbrowser; webbrowser.open(path); return {"success":True,"message":"URL ouverte"}
        if typ == "command":
            subprocess.Popen(f'start "" "{path}"', shell=True, cwd=wd)
            return {"success":True,"message":"Commande exécutée"}
        if platform.system() == "Windows":
            resolved = path
            # Add .exe if missing
            if not os.path.isfile(resolved) and not resolved.lower().endswith(".exe"):
                resolved += ".exe"
            if not os.path.isfile(resolved):
                # Try as is (might be a Windows command like "calc", "notepad")
                pass
            wd = wd or (os.path.dirname(os.path.abspath(resolved)) if os.path.isfile(resolved) else None)
            try:
                subprocess.Popen([resolved] + args, cwd=wd)
            except Exception as e1:
                subprocess.Popen(f'start "" "{resolved}"', shell=True, cwd=wd)
        else:
            subprocess.Popen([path] + args, cwd=wd)
        return {"success":True,"message":f"Lancé: {os.path.basename(path)}"}
    except Exception as e: return {"success":False,"message":str(e)}

def get_system_info():
    global _cached_net_io; net = psutil.net_io_counters()
    ns = net.bytes_sent - _cached_net_io.bytes_sent; nr = net.bytes_recv - _cached_net_io.bytes_recv
    _cached_net_io = net; mem = psutil.virtual_memory(); disk = psutil.disk_usage("/")
    return {
        "hostname": socket.gethostname(), "platform": f"{platform.system()} {platform.release()}",
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "cpu_percent_per_core": psutil.cpu_percent(interval=0.05, percpu=True),
        "cpu_freq": dict(psutil.cpu_freq()._asdict()) if psutil.cpu_freq() else None,
        "memory": {"total":mem.total,"available":mem.available,"used":mem.used,"percent":mem.percent},
        "disk": {"total":disk.total,"used":disk.used,"free":disk.free,"percent":disk.percent},
        "net_sent": ns, "net_recv": nr, "admin": _is_admin,
        "gpu": get_gpu_info(), "temperatures": get_temperatures(),
        "boot_time": psutil.boot_time(), "ip": get_local_ip(), "port": config.get("server",{}).get("port",5000)
    }

def get_gpu_info():
    r = {"name":"","util":0,"memory_used":0,"memory_total":0,"temp":0}
    try:
        import pynvml; pynvml.nvmlInit()
        if pynvml.nvmlDeviceGetCount() > 0:
            h = pynvml.nvmlDeviceGetHandleByIndex(0); n = pynvml.nvmlDeviceGetName(h)
            if isinstance(n, bytes): n = n.decode()
            u = pynvml.nvmlDeviceGetUtilizationRates(h); m = pynvml.nvmlDeviceGetMemoryInfo(h)
            t = pynvml.nvmlDeviceGetTemperature(h, 0); r = {"name":n,"util":u.gpu,"memory_used":m.used,"memory_total":m.total,"temp":t}
        pynvml.nvmlShutdown()
    except:
        try:
            p = subprocess.run(["nvidia-smi","--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu","--format=csv,noheader,nounits"],capture_output=True,text=True,timeout=5)
            if p.returncode==0 and p.stdout.strip():
                parts = p.stdout.strip().split(", ")
                if len(parts)>=5: r = {"name":parts[0],"util":float(parts[1]),"memory_used":float(parts[2])*1048576,"memory_total":float(parts[3])*1048576,"temp":float(parts[4])}
        except: pass
    return r

def get_temperatures():
    t = {}
    if _is_admin:
        try:
            import wmi
            for z in wmi.WMI(namespace="root\\wmi").MSAcpi_ThermalZoneTemperature():
                try: t[z.InstanceName or "CPU"] = round((z.CurrentTemperature/10.0)-273.15,1)
                except: pass
        except: pass
    if not t:  # fallback: try via powershell
        out, err, _ = run_ps("Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature | Select InstanceName,CurrentTemperature | ConvertTo-Json -Compress")
        if out and out != "null":
            try:
                data = json.loads(out)
                if isinstance(data, dict): data = [data]
                for d in data:
                    name = d.get("InstanceName","CPU")
                    t[name] = round((d.get("CurrentTemperature",0)/10.0)-273.15,1)
            except: pass
    try:
        import pynvml; pynvml.nvmlInit()
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i); n = pynvml.nvmlDeviceGetName(h)
            if isinstance(n, bytes): n = n.decode(); t[f"GPU: {n}"] = pynvml.nvmlDeviceGetTemperature(h,0)
        pynvml.nvmlShutdown()
    except: pass
    if platform.system() == "Linux":
        try:
            for f in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
                with open(f) as fh: t[f.name] = int(fh.read().strip())/1000
        except: pass
    return t

def _deezer_enrich(title, artist):
    """Look up song metadata from Deezer API (album, duration, cover)"""
    global _media_rich_cache
    key = f"{title}|{artist}"
    now = time.time()
    if _media_rich_cache["key"] == key and now - _media_rich_cache["time"] < 60:
        return _media_rich_cache["data"]
    try:
        q = urllib.parse.quote(f'{artist} {title}')
        req = urllib.request.Request(f'https://api.deezer.com/search?q={q}&limit=1',
                                     headers={"User-Agent":"DeckLink/1.0"})
        with urllib.request.urlopen(req, timeout=3) as r:
            data = json.loads(r.read())
            if data.get("data") and len(data["data"]) > 0:
                t = data["data"][0]
                rich = {
                    "album": t.get("album",{}).get("title", ""),
                    "duration": t.get("duration", 0),
                    "cover": t.get("album",{}).get("cover_medium", "") or t.get("album",{}).get("cover", ""),
                }
                _media_rich_cache = {"data":rich,"key":key,"time":now}
                return rich
    except: pass
    _media_rich_cache = {"data":{},"key":key,"time":now}
    return {}

def get_media_info():
    """Detect playing music from window titles or audio sessions"""
    global _cached_media
    now = time.time()
    if _cached_media["data"] and now - _cached_media["time"] < 2:
        return _cached_media["data"]

    media_keywords = ["deezer","spotify","youtube","vlc","music","groove","foobar","winamp","wmp","netflix","prime video","audible","pandora","tidal","apple music"]
    app_names = {"deezer":"Deezer","spotify":"Spotify","youtube":"YouTube","vlc":"VLC","foobar":"foobar2000"}

    try:
        import win32gui
        titles = []
        def enum_cb(hwnd, _):
            if win32gui.IsWindowVisible(hwnd) and win32gui.IsWindowEnabled(hwnd):
                t = win32gui.GetWindowText(hwnd)
                if t and len(t) > 2 and t not in ("Program Manager","Default IME",""):
                    titles.append(t)
        win32gui.EnumWindows(enum_cb, None)

        fg = win32gui.GetForegroundWindow()
        fg_title = win32gui.GetWindowText(fg)
        if fg_title and len(fg_title) > 2 and fg_title not in ("Program Manager","Default IME",""):
            titles.insert(0, fg_title)

        for title in titles:
            lower = title.lower()
            kw = next((k for k in media_keywords if k in lower), None)
            app = app_names.get(kw, kw.title() if kw else None)
            song, artist = None, None

            m = re.match(r'^(.+?)\s*[–\-|—]\s*(.+?)\s*[–\-|—]\s*(?:Deezer|Spotify|YouTube|VLC|Groove|Music|Pandora|Tidal).*$', title)
            if m:
                song, artist = m.group(1).strip(), m.group(2).strip()
            else:
                m = re.match(r'^(.+?)\s*[–\-|—]\s*(.+)$', title)
                if m and (kw or len(title) < 60):
                    s, a = m.group(1).strip(), m.group(2).strip()
                    if 2 < len(s) < 80 and 2 < len(a) < 80:
                        song, artist = s, a

            if song and artist:
                rich = _deezer_enrich(song, artist)
                info = {"title":song,"artist":artist,"album":rich.get("album",""),"app":app or title,"status":"Playing","pos":0,"dur":rich.get("duration",0),"cover":rich.get("cover",""),"source":"window"}
                _cached_media = {"data":info,"time":now}
                return info

            if app and title != app:
                info = {"title":title,"artist":"","album":"","app":app,"status":"Playing","pos":0,"dur":0,"cover":"","source":"window"}
                _cached_media = {"data":info,"time":now}
                return info

        try:
            from pycaw.pycaw import AudioUtilities
            for s in AudioUtilities.GetAllSessions():
                if s.Process and s.Process.name() and s.State == 1:
                    name = s.Process.name().replace(".exe","").capitalize()
                    info = {"title":f"Lecture sur {name}","artist":"","album":"","app":name,"status":"Playing","pos":0,"dur":0,"cover":"","source":"audio"}
                    _cached_media = {"data":info,"time":now}
                    return info
        except: pass
    except: pass

    _cached_media = {"data":None,"time":now}
    return None

KNOWN_APPS = {
    "chrome.exe":("Chrome","language","#4285f4","multimedia"),
    "firefox.exe":("Firefox","language","#ff7139","multimedia"),
    "msedge.exe":("Edge","language","#0078d7","multimedia"),
    "brave.exe":("Brave","language","#fb542b","multimedia"),
    "opera.exe":("Opera","language","#ff1b2d","multimedia"),
    "deezer.exe":("Deezer","music_note","#ff0050","multimedia"),
    "spotify.exe":("Spotify","audiotrack","#1db954","multimedia"),
    "vlc.exe":("VLC","play_circle","#ff7f00","multimedia"),
    "code.exe":("VS Code","terminal","#007acc","dev"),
    "cursor.exe":("Cursor","terminal","#6c47ff","dev"),
    "github.exe":("GitHub Desktop","code","#6e40c9","dev"),
    "gitkraken.exe":("GitKraken","code","#179287","dev"),
    "sublime_text.exe":("Sublime Text","description","#ff9800","dev"),
    "notepad++.exe":("Notepad++","description","#009e49","dev"),
    "idea64.exe":("IntelliJ IDEA","psychology","#fc3756","dev"),
    "pycharm64.exe":("PyCharm","psychology","#21d789","dev"),
    "webstorm64.exe":("WebStorm","psychology","#07c3f2","dev"),
    "android-studio.exe":("Android Studio","android","#3ddc84","dev"),
    "steam.exe":("Steam","sports_esports","#1b2838","games"),
    "discord.exe":("Discord","forum","#5865f2","games"),
    "epicgameslauncher.exe":("Epic Games","sports_esports","#2a2a2a","games"),
    "gog.exe":("GOG Galaxy","sports_esports","#5a2f8c","games"),
    "battle.net.exe":("Battle.net","sports_esports","#00aeff","games"),
    "xbox.exe":("Xbox","sports_esports","#107c10","games"),
    "obs64.exe":("OBS Studio","videocam","#000000","multimedia"),
    "obs.exe":("OBS Studio","videocam","#000000","multimedia"),
    "audacity.exe":("Audacity","graphic_eq","#003399","multimedia"),
    "blender.exe":("Blender","3d_rotation","#ea7600","multimedia"),
    "photoshop.exe":("Photoshop","image","#001d34","multimedia"),
    "mspaint.exe":("Paint","brush","#0078d4","multimedia"),
    "outlook.exe":("Outlook","mail","#0072c6","multimedia"),
    "winword.exe":("Word","description","#2b579a","multimedia"),
    "excel.exe":("Excel","table_chart","#217346","multimedia"),
    "powerpnt.exe":("PowerPoint","slideshow","#d24726","multimedia"),
    "teams.exe":("Teams","group","#6264a7","multimedia"),
    "slack.exe":("Slack","forum","#4a154b","multimedia"),
    "zoom.exe":("Zoom","videocam","#0b5cff","multimedia"),
    "explorer.exe":("Explorateur","folder","#ffb900","system"),
    "cmd.exe":("Terminal","terminal","#4d4d4d","system"),
    "powershell.exe":("PowerShell","terminal","#0078d4","system"),
    "wt.exe":("Windows Terminal","terminal","#0078d4","system"),
    "notepad.exe":("Bloc-notes","description","#0078d4","system"),
    "calc.exe":("Calculatrice","calculate","#1a9fff","system"),
    "taskmgr.exe":("Gestionnaire","monitoring","#0078d4","system"),
    "control.exe":("Panneau config","settings","#0078d4","system"),
    "regedit.exe":("Registre","settings","#0078d4","system"),
    "magnify.exe":("Loupe","zoom_in","#0078d4","system"),
    "osk.exe":("Clavier visuel","keyboard","#0078d4","system"),
    "snippingtool.exe":("Capture","crop","#0078d4","system"),
    "7zfm.exe":("7-Zip","folder_zip","#7f7f7f","system"),
    "winrar.exe":("WinRAR","folder_zip","#e67e22","system"),
    "qbittorrent.exe":("qBittorrent","download","#2f67ba","multimedia"),
    "telegram.exe":("Telegram","send","#26a5e4","multimedia"),
    "whatsapp.exe":("WhatsApp","chat","#25d366","multimedia"),
}

def _auto_category(name, path, exe):
    """Guess category from app name and path"""
    path_lower = path.lower()
    name_lower = name.lower()
    if "system32" in path_lower or "syswow64" in path_lower: return "system"
    if any(kw in name_lower for kw in ["jeu","game","play","steam","epic","battle","xbox","gog"]): return "games"
    if any(kw in name_lower for kw in ["code","dev","develop","studio","sdk","tool","git","python","node","java","c++","c#","visual","webstorm","pycharm","idea","android"]): return "dev"
    if any(kw in name_lower for kw in ["music","player","deezer","spotify","vlc","media","video","photo","image","paint","photoshop","audacity","obs"]): return "multimedia"
    if any(kw in name_lower for kw in ["note","calc","explorer","terminal","cmd","powershell","manager","config","control"]): return "system"
    if any(kw in name_lower for kw in ["browser","chrome","firefox","edge","brave","opera","safari"]): return "multimedia"
    if any(kw in name_lower for kw in ["discord","telegram","whatsapp","slack","teams","outlook","zoom","chat","mail"]): return "multimedia"
    if "program files" in path_lower or "programs" in path_lower: return "multimedia"
    return "system"

def extract_icon_b64(path):
    """Extract icon from .exe and return as base64 PNG data URL"""
    import win32gui
    large, small = [], []
    try:
        import win32ui, win32con
        from PIL import Image
        large, small = win32gui.ExtractIconEx(path, 0)
        hicon = small[0] if small else (large[0] if large else None)
        if not hicon: return None
        hwnd_desk = win32gui.GetDesktopWindow()
        hdc_screen = win32gui.GetWindowDC(hwnd_desk)
        hdc = win32ui.CreateDCFromHandle(hdc_screen)
        hdc_comp = hdc.CreateCompatibleDC()
        info = win32gui.GetIconInfo(hicon)
        bmp_src = win32ui.CreateBitmapFromHandle(info[3])
        bmp_info = bmp_src.GetInfo()
        w, h = bmp_info['bmWidth'], bmp_info['bmHeight']
        bmp_dst = win32ui.CreateBitmap()
        bmp_dst.CreateCompatibleBitmap(hdc, w, h)
        hdc_comp.SelectObject(bmp_dst)
        win32gui.DrawIconEx(hdc_comp.GetSafeHdc(), 0, 0, hicon, w, h, 0, None, win32con.DI_NORMAL)
        bits = bmp_dst.GetBitmapBits(True)
        img = Image.frombuffer('RGBA', (w, h), bits, 'raw', 'BGRA', 0, 1)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/png;base64,{b64}"
    except: return None
    finally:
        try:
            for icon in large: win32gui.DestroyIcon(icon)
            for icon in small: win32gui.DestroyIcon(icon)
        except: pass

def detect_installed_apps():
    """Scan Start Menu for installed apps (fast: only Start Menu + PATH)"""
    found = {}
    known = dict(KNOWN_APPS)
    start_menu_dirs = [
        os.path.expandvars("%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs"),
        os.path.expandvars("%PROGRAMDATA%\\Microsoft\\Windows\\Start Menu\\Programs"),
    ]
    _icon_cache = {}
    def _get_icon(p):
        if p in _icon_cache: return _icon_cache[p]
        r = extract_icon_b64(p)
        _icon_cache[p] = r
        return r

    exes_found = set()
    exts = {".exe", ".com", ".bat", ".cmd"}

    for sd in start_menu_dirs:
        if not os.path.isdir(sd): continue
        try:
            for root, dirs, files in os.walk(sd):
                for f in files:
                    if not f.lower().endswith(".lnk"): continue
                    try:
                        import win32com.client
                        shell = win32com.client.Dispatch("WScript.Shell")
                        sc = shell.CreateShortCut(os.path.join(root, f))
                        target = sc.Targetpath
                        if not target: continue
                        ext = os.path.splitext(target)[1].lower()
                        if ext not in exts: continue
                        exe = os.path.basename(target).lower()
                        if exe in exes_found: continue
                        exes_found.add(exe)
                        name = os.path.splitext(f)[0]
                        cat = _auto_category(name, target, exe)
                        icon_name, color = "apps", "#1991ff"
                        icon_b64 = None
                        if exe in known:
                            n, i, c, cat2 = known[exe]
                            name, icon_name, color = n, i, c
                            cat = cat2
                        if os.path.isfile(target):
                            icon_b64 = _get_icon(target)
                            # If extraction failed and shortcut has arguments, try the real app exe
                            if not icon_b64:
                                args = sc.Arguments or ""
                                m = re.search(r'--processStart\s+(\S+)', args, re.I)
                                if m:
                                    real_exe = m.group(1)
                                    real_path = os.path.join(os.path.dirname(target), real_exe)
                                    if os.path.isfile(real_path):
                                        icon_b64 = _get_icon(real_path)
                        found[exe] = {"name":name,"path":target,"icon":icon_name,"icon_b64":icon_b64,"color":color,"category":cat,"source":"startmenu"}
                    except: pass
        except: pass

    for exe_name, (name, icon_name, color, cat) in list(known.items()):
        if exe_name in exes_found: continue
        try:
            p = subprocess.run(["where", exe_name], capture_output=True, text=True, timeout=3)
            if p.returncode == 0 and p.stdout.strip():
                pth = p.stdout.strip().split("\n")[0].strip()
                if os.path.isfile(pth):
                    icon_b64 = _get_icon(pth)
                    found[exe_name] = {"name":name,"path":pth,"icon":icon_name,"icon_b64":icon_b64,"color":color,"category":cat,"source":"where"}
                    exes_found.add(exe_name)
        except: pass

    return sorted(found.values(), key=lambda x: x["name"].lower())

def get_deezer_top():
    for pid in ["3155776842","3070885702","3195795102","140726935"]:
        try:
            req = urllib.request.Request(f"https://api.deezer.com/playlist/{pid}", headers={"User-Agent":"DeckLink/1.0"})
            with urllib.request.urlopen(req, timeout=8) as r:
                d = json.loads(r.read())
                if "tracks" in d and "data" in d["tracks"]:
                    return {"id":pid,"name":d.get("title","Top"),"picture":d.get("picture_medium",""),"tracks":[{"id":t["id"],"title":t["title"],"artist":t["artist"]["name"],"duration":t.get("duration",0)} for t in d["tracks"]["data"]]}
        except: pass
    return None

def get_deezer_tracks(pid):
    try:
        req = urllib.request.Request(f"https://api.deezer.com/playlist/{pid}/tracks?limit=100", headers={"User-Agent":"DeckLink/1.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read())
            if "data" in d: return [{"id":t["id"],"title":t["title"],"artist":t["artist"]["name"],"duration":t.get("duration",0)} for t in d["data"]]
    except: pass
    return None

def take_screenshot():
    try:
        import pyautogui
        img = pyautogui.screenshot()
        buf = io.BytesIO(); img.save(buf, format="JPEG", quality=50)
        buf.seek(0); return base64.b64encode(buf.read()).decode()
    except:
        try:
            import mss
            with mss.mss() as sct:
                raw = sct.grab(sct.monitors[1])
                from PIL import Image
                pil = Image.frombytes("RGB", raw.size, raw.rgb)
                buf = io.BytesIO(); pil.save(buf, format="JPEG", quality=50)
                buf.seek(0); return base64.b64encode(buf.read()).decode()
        except: return None

def get_audio_devices():
    try:
        from pycaw.pycaw import AudioUtilities, MMDeviceEnumerator, EDataFlow, ERole
        devs = AudioUtilities.GetSpeakers()
        sessions = AudioUtilities.GetAllSessions()
        result = []
        for s in sessions:
            if s.Process and s.Process.name():
                import comtypes
                vol = s.SimpleAudioVolume
                result.append({"name":s.Process.name().replace(".exe",""),"pid":s.Process.pid,"volume":round(vol.GetMasterVolume()*100),"muted":vol.GetMute()})
        return result
    except: return []

def set_volume(pid, volume):
    try:
        from pycaw.pycaw import AudioUtilities
        for s in AudioUtilities.GetAllSessions():
            if s.Process and s.Process.pid == pid:
                s.SimpleAudioVolume.SetMasterVolume(volume/100, None)
                return True
    except: pass
    return False

def get_services():
    try:
        out, err, _ = run_ps("Get-Service | Where-Object { $_.Status -eq 'Running' -or $_.StartType -eq 'Automatic' } | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress")
        if out and out != "null":
            data = json.loads(out)
            if isinstance(data, dict): data = [data]
            return [{"name":s["Name"],"display":s.get("DisplayName",s["Name"]),"status":s.get("Status",""),"start":s.get("StartType","")} for s in data]
    except: pass
    return []

def control_service(name, action):
    out, err, _ = run_ps(f"{action}-Service -Name '{name}'")
    return err == "" or "success" in err.lower() or out != ""

def set_wallpaper(path):
    try:
        import ctypes
        SPI_SETDESKWALLPAPER = 0x0014
        ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, path, 2)
        return True
    except: return False

def get_wallpaper():
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(512)
        ctypes.windll.user32.SystemParametersInfoW(0x0073, 512, buf, 0)
        return buf.value
    except: return ""

def mouse_click(button="left", x=None, y=None):
    try:
        import pyautogui
        if x is not None and y is not None: pyautogui.moveTo(x, y)
        if button == "left": pyautogui.click(button="left")
        elif button == "right": pyautogui.click(button="right")
        elif button == "middle": pyautogui.click(button="middle")
        elif button == "double": pyautogui.doubleClick()
        return True
    except: return False

def mouse_move(x, y):
    try: import pyautogui; pyautogui.moveTo(x, y); return True
    except: return False

def mouse_scroll(amount):
    try: import pyautogui; pyautogui.scroll(amount); return True
    except: return False

def mouse_drag(x, y):
    try: import pyautogui; pyautogui.dragTo(x, y, duration=0.2); return True
    except: return False

def list_directory(path):
    if not os.path.exists(path): return None
    try:
        items = []
        for entry in os.scandir(path):
            try:
                items.append({"name":entry.name,"path":entry.path,"is_dir":entry.is_dir(),"size":entry.stat().st_size if not entry.is_dir() else 0,"modified":entry.stat().st_mtime})
            except: pass
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return items
    except: return None

def get_clipboard():
    try:
        import win32clipboard
        win32clipboard.OpenClipboard()
        try: data = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT); return data
        except: return None
        finally: win32clipboard.CloseClipboard()
    except: return None

def set_clipboard(text):
    try:
        import win32clipboard
        win32clipboard.OpenClipboard(); win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard(); return True
    except: return False

def wake_on_lan(mac):
    mac = mac.replace("-","").replace(":","")
    if len(mac) != 12: return False
    try:
        packet = bytes.fromhex("FF"*6 + mac*16)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(packet, ("255.255.255.255",9)); s.close(); return True
    except: return False

@app.route("/")
def index(): return send_from_directory(CLIENT_DIR, "index.html")
@app.route("/api/config")
def api_get_config(): return jsonify(load_config())
@app.route("/api/info")
def api_get_info(): return jsonify(get_system_info())

@socketio.on("connect")
def handle_connect():
    load_config()
    emit("config", config); emit("system_info", get_system_info())
    if not config.get("setup",{}).get("done",False) and len(config.get("buttons",[])) == 0:
        emit("first_launch", {"show":True})
@socketio.on("get_config")
def handle_get_config(): load_config(); emit("config", config)

@socketio.on("update_config")
def handle_update_config(data):
    if "setup_done" in data and data["setup_done"]:
        load_config(); config.setdefault("setup",{}); config["setup"]["done"] = True; save_config(config)
    else:
        save_config(data)
    socketio.emit("config", config); emit("config_updated", {"success":True})

@socketio.on("detect_apps")
def handle_detect_apps():
    sid = request.sid
    def do_scan(sid):
        apps = detect_installed_apps()
        socketio.emit("detected_apps", apps, room=sid)
    socketio.start_background_task(do_scan, sid)

@socketio.on("import_detected_apps")
def handle_import_detected_apps(data):
    load_config()
    selected = data.get("apps", [])
    for a in selected:
        aid = a["path"].lower().replace("\\","/").replace(":","").replace("/","_").replace(" ","_")[:30]
        aid = "app_"+aid
        btn = {
            "id": aid, "name": a.get("name","App"), "path": a.get("path",""),
            "icon": a.get("icon","apps"), "color": a.get("color","#1991ff"),
            "category": a.get("category",""), "type": "app", "args": [], "favorite": False
        }
        if a.get("icon_b64"): btn["icon_b64"] = a["icon_b64"]
        config.setdefault("buttons",[]).append(btn)
    config.setdefault("setup",{})["done"] = True
    save_config(config)
    socketio.emit("config", config); emit("config_updated", {"success":True,"count":len(selected)})

@socketio.on("launch")
def handle_launch(data):
    bid = data.get("id")
    for b in config.get("buttons",[]):
        if b["id"]==bid: return emit("launch_result",{"id":bid,**launch_app(b)})
    for a in config.get("quick_actions",[]):
        if a["id"]==bid: return emit("launch_result",{"id":bid,**launch_app(a)})
    emit("launch_result",{"id":bid,"success":False,"message":"Bouton non trouvé"})

@socketio.on("get_system_info")
def handle_get_system_info(): emit("system_info", get_system_info())
@socketio.on("get_media_info")
def handle_get_media_info(): emit("media_info", get_media_info() or {})
@socketio.on("get_gpu_info")
def handle_get_gpu_info(): emit("gpu_info", get_gpu_info())

@socketio.on("update_theme")
def handle_update_theme(data): load_config(); config["theme"]=data; save_config(config); socketio.emit("config", config)
@socketio.on("update_logo")
def handle_update_logo(data): load_config(); config["logo"]=data; save_config(config); socketio.emit("config", config)
@socketio.on("add_button")
def handle_add_button(data): load_config(); config["buttons"].append(data); save_config(config); socketio.emit("config", config)

@socketio.on("update_button")
def handle_update_button(data):
    load_config(); idx = data.get("index")
    if 0 <= idx < len(config["buttons"]):
        config["buttons"][idx] = data.get("button"); save_config(config); socketio.emit("config", config); emit("config_updated",{"success":True})

@socketio.on("remove_button")
def handle_remove_button(data):
    load_config(); config["buttons"]=[b for b in config["buttons"] if b["id"]!=data.get("id")]; save_config(config); socketio.emit("config", config)

@socketio.on("keyboard_input")
def handle_keyboard_input(data):
    text = data.get("text","")
    try: import pyautogui; pyautogui.write(text,interval=0.01); emit("keyboard_result",{"success":True}); return
    except: pass
    try:
        sp = {"\n":0x0D,"\b":0x08,"\t":0x09," ":0x20}
        for ch in text:
            vk = sp.get(ch, ord(ch.upper()))
            ctypes.windll.user32.keybd_event(vk,0,0,0); ctypes.windll.user32.keybd_event(vk,0,2,0); time.sleep(0.01)
        emit("keyboard_result",{"success":True})
    except Exception as e: emit("keyboard_result",{"success":False,"message":str(e)})

@socketio.on("key_press")
def handle_key_press(data):
    key = data.get("key","")
    sp = {"enter":0x0D,"backspace":0x08,"tab":0x09,"escape":0x1B,"space":0x20,"delete":0x2E,"up":0x26,"down":0x28,"left":0x25,"right":0x27,"home":0x24,"end":0x23,"pgup":0x21,"pgdn":0x22}
    try:
        if key in sp: v=sp[key]; ctypes.windll.user32.keybd_event(v,0,0,0); ctypes.windll.user32.keybd_event(v,0,2,0)
        elif len(key)==1: v=ord(key.upper()); ctypes.windll.user32.keybd_event(v,0,0,0); ctypes.windll.user32.keybd_event(v,0,2,0)
        elif key.startswith("mod+"):
            m,k=key.split("+",1); ms={"ctrl":0x11,"alt":0x12,"shift":0x10,"win":0x5B}
            vm=ms.get(m); vk=sp.get(k, ord(k.upper()) if len(k)==1 else None)
            if vm and vk: ctypes.windll.user32.keybd_event(vm,0,0,0); ctypes.windll.user32.keybd_event(vk,0,0,0); ctypes.windll.user32.keybd_event(vk,0,2,0); ctypes.windll.user32.keybd_event(vm,0,2,0)
        emit("keyboard_result",{"success":True})
    except Exception as e: emit("keyboard_result",{"success":False,"message":str(e)})

@socketio.on("media_command")
def handle_media_command(data):
    cmd = data.get("command","")
    ks = {"play_pause":0xB3,"next":0xB0,"prev":0xB1,"stop":0xB2,"volume_up":0xAF,"volume_down":0xAE,"mute":0xAD}
    try:
        v=ks.get(cmd)
        if v: ctypes.windll.user32.keybd_event(v,0,0,0); ctypes.windll.user32.keybd_event(v,0,2,0)
        emit("media_result",{"success":True})
    except Exception as e: emit("media_result",{"success":False,"message":str(e)})

@socketio.on("screenshot")
def handle_screenshot():
    img = take_screenshot()
    if img: emit("screenshot_result",{"success":True,"image":img})
    else: emit("screenshot_result",{"success":False,"message":"pyautogui ou mss requis"})

@socketio.on("screenshot_stream")
def handle_screenshot_stream():
    img = take_screenshot()
    if img: emit("screenshot_stream_frame",{"image":img})
    else: emit("screenshot_stream_frame",{"error":"Erreur"})

@socketio.on("get_processes")
def handle_get_processes():
    procs = []
    for p in psutil.process_iter(["pid","name","cpu_percent","memory_percent","status"]):
        try: procs.append(p.info)
        except: pass
    procs.sort(key=lambda x: x.get("cpu_percent",0) or 0, reverse=True)
    emit("processes", procs[:50])

@socketio.on("kill_process")
def handle_kill_process(data):
    try: psutil.Process(data.get("pid")).terminate(); emit("kill_result",{"success":True})
    except Exception as e: emit("kill_result",{"success":False,"message":str(e)})

# Deezer
@socketio.on("deezer_top")
def handle_deezer_top(): emit("deezer_top", get_deezer_top())
@socketio.on("deezer_tracks")
def handle_deezer_tracks(data): emit("deezer_tracks", get_deezer_tracks(data.get("playlist_id")))
@socketio.on("deezer_play")
def handle_deezer_play(data):
    tid=data.get("track_id"); pid=data.get("playlist_id")
    url = f"https://www.deezer.com/track/{tid}" if tid else f"https://www.deezer.com/playlist/{pid}" if pid else None
    if url: import webbrowser; webbrowser.open(url); emit("launch_result",{"id":"deezer","success":True,"message":"Lecture Deezer"})

# Files
@socketio.on("file_list")
def handle_file_list(data):
    path = data.get("path","C:\\"); items = list_directory(path)
    if items is None:
        drives = [d.device for d in psutil.disk_partitions()]
        items = [{"name":d.rstrip("\\"),"path":d+"\\","is_dir":True,"size":0,"modified":0} for d in drives if d]
    emit("file_list", items)

@socketio.on("file_download")
def handle_file_download(data):
    path = data.get("path")
    try:
        with open(path,"rb") as f: b64=base64.b64encode(f.read()).decode()
        emit("file_download_data",{"path":path,"name":os.path.basename(path),"data":b64})
    except Exception as e: emit("file_download_data",{"error":str(e)})

# Clipboard
@socketio.on("clipboard_get")
def handle_clipboard_get(): emit("clipboard_data",{"text":get_clipboard() or ""})
@socketio.on("clipboard_set")
def handle_clipboard_set(data): emit("clipboard_result",{"success":set_clipboard(data.get("text",""))})

# WOL
@socketio.on("wol")
def handle_wol(data): emit("wol_result",{"success":wake_on_lan(data.get("mac",""))})

# PowerShell
@socketio.on("run_powershell")
def handle_run_powershell(data):
    out, err, rc = run_ps(data.get("script",""), timeout=30)
    emit("powershell_result",{"stdout":out[:5000],"stderr":err[:2000],"returncode":rc})

# System commands
@socketio.on("system_command")
def handle_system_command(data):
    cmd = data.get("command","")
    cmds = {
        "lock": lambda: run_ps("rundll32.exe user32.dll,LockWorkStation"),
        "sleep": lambda: run_ps("rundll32.exe powrprof.dll,SetSuspendState 0,1,0"),
        "shutdown": lambda: run_ps("shutdown /s /t 10"),
        "restart": lambda: run_ps("shutdown /r /t 10"),
        "empty_recycle": lambda: run_ps("(New-Object -ComObject Shell.Application).NameSpace(0x0a).Items() | %{ $_.InvokeVerb('delete') }"),
        "admin_check": lambda: (True, {"admin":_is_admin}),
    }
    fn = cmds.get(cmd)
    if fn: result = fn(); emit("system_command_result",{"command":cmd, **({"success":True} if result is True else (result[1] if isinstance(result, tuple) else result) if result else {"success":True})})
    else: emit("system_command_result",{"command":cmd,"error":"Commande inconnue"})

# Mouse control
@socketio.on("mouse_click")
def handle_mouse_click(data):
    ok = mouse_click(data.get("button","left"), data.get("x"), data.get("y"))
    emit("mouse_result",{"success":ok})

@socketio.on("mouse_move")
def handle_mouse_move(data):
    ok = mouse_move(data.get("x",0), data.get("y",0))
    emit("mouse_result",{"success":ok})

@socketio.on("mouse_scroll")
def handle_mouse_scroll(data):
    ok = mouse_scroll(data.get("amount",0))
    emit("mouse_result",{"success":ok})

@socketio.on("mouse_drag")
def handle_mouse_drag(data):
    ok = mouse_drag(data.get("x",0), data.get("y",0))
    emit("mouse_result",{"success":ok})

@socketio.on("mouse_pos")
def handle_mouse_pos():
    try:
        import pyautogui; x,y = pyautogui.position()
        emit("mouse_position",{"x":x,"y":y})
    except: emit("mouse_position",{"x":0,"y":0})

# Audio/Volume mixer
@socketio.on("get_audio_devices")
def handle_get_audio_devices(): emit("audio_devices", get_audio_devices())

@socketio.on("set_volume_pid")
def handle_set_volume_pid(data):
    ok = set_volume(data.get("pid"), data.get("volume",50))
    emit("volume_set_result",{"success":ok})

# Services
@socketio.on("get_services")
def handle_get_services(): emit("services_list", get_services())

@socketio.on("control_service")
def handle_control_service(data):
    ok = control_service(data.get("name"), data.get("action","Start"))
    emit("service_result",{"success":ok,"name":data.get("name"),"action":data.get("action")})

# Wallpaper
@socketio.on("get_wallpaper")
def handle_get_wallpaper(): emit("wallpaper_path", {"path":get_wallpaper()})

@socketio.on("set_wallpaper")
def handle_set_wallpaper(data):
    ok = set_wallpaper(data.get("path",""))
    emit("wallpaper_result",{"success":ok})

@socketio.on("browse_wallpapers")
def handle_browse_wallpapers():
    wall_dir = os.path.expanduser("~/Pictures")
    if not os.path.exists(wall_dir): wall_dir = os.path.expanduser("~")
    items = list_directory(wall_dir)
    if items: items = [i for i in items if not i["is_dir"] and i["name"].lower().endswith((".jpg",".jpeg",".png",".bmp",".gif"))]
    emit("file_list", items)

if __name__ == "__main__":
    load_config()
    port = config.get("server",{}).get("port",5000)
    ip = get_local_ip()
    adm = "ADMIN" if _is_admin else "utilisateur"
    print(f"  DeckLink Host v5 ({'ADMIN' if _is_admin else 'utilisateur'})")
    print(f"  Adresse: http://{ip}:{port}")
    if not _is_admin: print(f"  [!] Lancez en ADMIN pour les temperatures")
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
