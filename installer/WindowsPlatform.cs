using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Win32;
namespace MarkerExportSetup {
 public sealed class WindowsPlatform:IPlatform {
  const string RegistrationKey="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PremiereClipExport.ComTexs.MarkerExport";
  string debugKey="";public string DebugKey{get{return debugKey;}}
  public void UseDebugKey(string key){if(!string.IsNullOrEmpty(key)&&!Regex.IsMatch(key,@"^Software\\Adobe\\CSXS\.[1-9][0-9]?$"))throw new Exception("CEP 注册表路径不合法。");debugKey=key;}
  public AppInfo InspectApps(){
   var result=new AppInfo();result.PremierePath=FindApplication("Adobe Premiere Pro.exe","Adobe Premiere Pro 2026");result.EncoderPath=FindApplication("Adobe Media Encoder.exe","Adobe Media Encoder 2026");
   if(File.Exists(result.PremierePath)){var v=FileVersionInfo.GetVersionInfo(result.PremierePath);result.PremiereVersion=v.ProductVersion;result.PremiereMajor=v.ProductMajorPart;
    string cep=Path.Combine(Path.GetDirectoryName(result.PremierePath),"CEPHtmlEngine","CEPHtmlEngine.exe");if(File.Exists(cep))result.CepMajor=FileVersionInfo.GetVersionInfo(cep).ProductMajorPart;
   }
   if(File.Exists(result.EncoderPath)){var v=FileVersionInfo.GetVersionInfo(result.EncoderPath);result.EncoderVersion=v.ProductVersion;result.EncoderMajor=v.ProductMajorPart;}
   if(result.CepMajor>0)UseDebugKey("Software\\Adobe\\CSXS."+result.CepMajor.ToString(CultureInfo.InvariantCulture));else UseDebugKey("");
   // These roots deliberately match the CEP client's Folder.startup/ProgramFiles lookup.
   var roots=new List<string>();if(File.Exists(result.PremierePath))roots.Add(Path.Combine(Directory.GetParent(Path.GetDirectoryName(result.PremierePath)).FullName,"Adobe Media Encoder 2026"));
   foreach(string env in new[]{"ProgramW6432","ProgramFiles"}){string pf=Environment.GetEnvironmentVariable(env);if(!string.IsNullOrEmpty(pf))roots.Add(Path.Combine(pf,"Adobe","Adobe Media Encoder 2026"));}
   foreach(string root in roots.Distinct(StringComparer.OrdinalIgnoreCase)){
    string video=Path.Combine(root,"MediaIO","systempresets","4E49434B_48323634","01 - Match Source - High bitrate.epr"),audio=Path.Combine(root,"MediaIO","systempresets","3F3F3F3F_57415645","Waveform Audio 48kHz 16-bit.epr");
    if(File.Exists(video)&&File.Exists(audio)&&ValidPreset(video)&&ValidPreset(audio)){result.VideoPreset=video;result.AudioPreset=audio;result.PresetsReady=true;break;}
   }return result;
  }
  static bool ValidPreset(string p){try{Engine.Guard(p);var x=Payload.ParseXml(File.ReadAllText(p));return x.Root!=null&&x.Root.Name.LocalName=="PremiereData";}catch{return false;}}
  static string FindApplication(string executable,string folder){
   var candidates=new List<string>();foreach(string env in new[]{"ProgramW6432","ProgramFiles"}){string p=Environment.GetEnvironmentVariable(env);if(!string.IsNullOrEmpty(p))candidates.Add(Path.Combine(p,"Adobe",folder,executable));}
   foreach(RegistryView view in new[]{RegistryView.Registry64,RegistryView.Registry32})foreach(RegistryHive hive in new[]{RegistryHive.LocalMachine,RegistryHive.CurrentUser}){
    try{using(var root=RegistryKey.OpenBaseKey(hive,view)){
     using(var app=root.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\"+executable)){if(app!=null){var p=app.GetValue("") as string;if(!string.IsNullOrEmpty(p))candidates.Add(p.Trim('"'));}}
     using(var uninstall=root.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall")){if(uninstall!=null)foreach(string name in uninstall.GetSubKeyNames())using(var item=uninstall.OpenSubKey(name)){if(item==null)continue;string display=item.GetValue("DisplayName") as string,location=item.GetValue("InstallLocation") as string;if(display!=null&&display.IndexOf(folder,StringComparison.OrdinalIgnoreCase)>=0&&!string.IsNullOrEmpty(location))candidates.Add(Path.Combine(location.Trim('"'),executable));}}
    }}catch{}
   }
   foreach(string p in candidates.Distinct(StringComparer.OrdinalIgnoreCase))try{if(File.Exists(p)&&FileVersionInfo.GetVersionInfo(p).ProductMajorPart==26)return Path.GetFullPath(p);}catch{}return "";
  }
  public bool AdobeRunning(){foreach(var p in Process.GetProcesses())using(p){try{string name=p.ProcessName;if(name.IndexOf("Adobe Premiere Pro",StringComparison.OrdinalIgnoreCase)>=0||name.IndexOf("Adobe Media Encoder",StringComparison.OrdinalIgnoreCase)>=0)return true;}catch{}}return false;}
  static ValueRecord ReadValue(RegistryKey key,string name){var kind=key.GetValueKind(name);object value=key.GetValue(name,null,RegistryValueOptions.DoNotExpandEnvironmentNames);string data;
   if(kind==RegistryValueKind.Binary||kind==RegistryValueKind.None)data=Convert.ToBase64String((byte[])value);
   else if(kind==RegistryValueKind.MultiString)data=new XElement("Items",((string[])value).Select(x=>new XElement("Item",x))).ToString(SaveOptions.DisableFormatting);
   else data=Convert.ToString(value,CultureInfo.InvariantCulture);return new ValueRecord(name,kind.ToString(),data);
  }
  static void SetValue(RegistryKey key,ValueRecord v){var kind=(RegistryValueKind)Enum.Parse(typeof(RegistryValueKind),v.Kind);object data=v.Data;
   if(kind==RegistryValueKind.DWord)data=int.Parse(v.Data,CultureInfo.InvariantCulture);else if(kind==RegistryValueKind.QWord)data=long.Parse(v.Data,CultureInfo.InvariantCulture);else if(kind==RegistryValueKind.Binary||kind==RegistryValueKind.None)data=Convert.FromBase64String(v.Data);else if(kind==RegistryValueKind.MultiString)data=Payload.ParseXml(v.Data).Root.Elements("Item").Select(x=>x.Value).ToArray();key.SetValue(v.Name,data,kind);
  }
  public RegistryImage ReadDebug(){var result=new RegistryImage();if(string.IsNullOrEmpty(debugKey))return result;using(var key=Registry.CurrentUser.OpenSubKey(debugKey)){if(key==null)return result;result.Exists=true;if(key.GetValueNames().Contains("PlayerDebugMode"))result.Values.Add(ReadValue(key,"PlayerDebugMode"));}return result;}
  public void ApplyDebug(RegistryImage image){if(string.IsNullOrEmpty(debugKey))throw new Exception("未检测到 CEP 运行时，不能修改共享调试设置。");if(image.Values.Any(v=>v.Name!="PlayerDebugMode"))throw new Exception("禁止修改其他 CEP 设置。");var value=image.Find("PlayerDebugMode");
   if(value!=null){using(var key=Registry.CurrentUser.CreateSubKey(debugKey))SetValue(key,value);return;}
   bool empty=false;using(var key=Registry.CurrentUser.OpenSubKey(debugKey,true)){if(key==null)return;key.DeleteValue("PlayerDebugMode",false);empty=key.GetValueNames().Length==0&&key.GetSubKeyNames().Length==0;}
   if(!image.Exists&&empty)Registry.CurrentUser.DeleteSubKey(debugKey,false);
  }
  public RegistryImage ReadRegistration(){var r=new RegistryImage();using(var key=Registry.CurrentUser.OpenSubKey(RegistrationKey)){if(key==null)return r;r.Exists=true;r.Values=key.GetValueNames().Select(n=>ReadValue(key,n)).ToList();}return r;}
  public void ApplyRegistration(RegistryImage image){using(var key=Registry.CurrentUser.OpenSubKey(RegistrationKey)){if(key!=null){string owner=key.GetValue("InstallOwner") as string;if(owner!=Engine.Owner&&(key.GetValueNames().Length>0||key.GetSubKeyNames().Length>0))throw new Exception("卸载入口归属不匹配，停止修改。");if(key.GetSubKeyNames().Length>0)throw new Exception("卸载入口含未知子项，停止修改。");}}
   if(!image.Exists){Registry.CurrentUser.DeleteSubKey(RegistrationKey,false);return;}
   if(image.Get("InstallOwner")!=Engine.Owner)throw new Exception("禁止写入其他安装器的卸载入口。");using(var key=Registry.CurrentUser.CreateSubKey(RegistrationKey)){foreach(string name in key.GetValueNames())if(!image.Values.Any(v=>v.Name==name))key.DeleteValue(name,false);foreach(var v in image.Values)SetValue(key,v);}
  }
  public void Checkpoint(string name){}
 }
}
