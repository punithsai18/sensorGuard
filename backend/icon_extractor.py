import win32gui, win32con, win32ui
import base64, io
from PIL import Image

_icon_cache = {}  # exe_path -> base64 string

def get_exe_icon_base64(exe_path: str) -> str | None:
    if exe_path in _icon_cache:
        return _icon_cache[exe_path]
    
    try:
        # Extract the icon handles
        large, small = win32gui.ExtractIconEx(exe_path, 0)
        if not large:
            _icon_cache[exe_path] = None
            return None
        
        icon_handle = large[0]
        
        # Create a device context and bitmap
        hdc = win32ui.CreateDCFromHandle(win32gui.GetDC(0))
        hdc_mem = hdc.CreateCompatibleDC()
        
        bmp = win32ui.CreateBitmap()
        bmp.CreateCompatibleBitmap(hdc, 32, 32)
        hdc_mem.SelectObject(bmp)
        
        # Draw the icon onto the bitmap
        win32gui.DrawIconEx(
            hdc_mem.GetSafeHdc(), 0, 0, 
            icon_handle, 32, 32, 0, None, 
            win32con.DI_NORMAL
        )
        
        # Convert bitmap to PIL Image
        bmp_info = bmp.GetInfo()
        bmp_str = bmp.GetBitmapBits(True)
        img = Image.frombuffer(
            'RGB',
            (bmp_info['bmWidth'], bmp_info['bmHeight']),
            bmp_str, 'raw', 'BGRX', 0, 1
        )
        img = img.resize((32, 32), Image.LANCZOS)
        
        # Convert to base64 PNG
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        b64 = base64.b64encode(buffer.getvalue()).decode()
        result = f"data:image/png;base64,{b64}"
        
        _icon_cache[exe_path] = result
        
        # Cleanup icon handles
        win32gui.DestroyIcon(icon_handle)
        for i in small:
            win32gui.DestroyIcon(i)
        
        return result
        
    except Exception:
        _icon_cache[exe_path] = None
        return None

def get_app_icon(app_name: str, exe_path: str | None) -> str | None:
    # Try exe extraction first
    if exe_path:
        result = get_exe_icon_base64(exe_path)
        if result:
            return result
    
    # Fallback: try to find the exe by app name
    fallback_paths = {
        "Google Chrome": r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "Microsoft Edge": r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "File Explorer":  r"C:\Windows\explorer.exe",
        "VS Code":        r"C:\Users\{user}\AppData\Local\Programs\Microsoft VS Code\Code.exe",
        "Notepad":        r"C:\Windows\notepad.exe",
        "Task Manager":   r"C:\Windows\System32\Taskmgr.exe",
    }
    
    import os
    path = fallback_paths.get(app_name, "")
    path = path.replace("{user}", os.environ.get("USERNAME", ""))
    
    if path and os.path.exists(path):
        return get_exe_icon_base64(path)
    
    return None
