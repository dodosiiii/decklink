# WinRT PowerShell - may not work on all systems
$winmd = "C:\Windows\System32\WinMetadata\Windows.Media.winmd"
if (-not (Test-Path $winmd)) { "null"; exit }
try {
  Add-Type -ReferencedAssemblies $winmd -TypeDefinition @'
using System;
using Windows.Media.Control;
public class MediaHelper {
    public static string Get() {
        try {
            var mgr = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().GetAwaiter().GetResult();
            var s = mgr.GetCurrentSession();
            if (s == null) return "null";
            var p = s.TryGetMediaPropertiesAsync().AsTask().GetAwaiter().GetResult();
            var tl = s.GetTimelineProperties();
            var pl = s.GetPlaybackInfo();
            return "{\"title\":\"" + Esc(p.Title) + "\",\"artist\":\"" + Esc(p.Artist) + "\",\"album\":\"" + Esc(p.AlbumTitle) + "\",\"status\":\"" + pl.PlaybackStatus + "\",\"pos\":" + (int)tl.Position.TotalSeconds + ",\"dur\":" + (int)tl.EndTime.TotalSeconds + ",\"app\":\"" + Esc(s.SourceAppUserModelId) + "\"}";
        } catch { return "null"; }
    }
    private static string Esc(string s) {
        if (s == null) return "";
        return s.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\n","\\n").Replace("\r","\\r").Replace("\t","\\t");
    }
}
'@
  [MediaHelper]::Get()
} catch { "null" }
