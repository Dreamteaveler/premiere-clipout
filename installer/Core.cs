using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;
namespace MarkerExportSetup {
 public sealed class Payload {
  public string Version,CoreVersion,License;
  public Dictionary<string,byte[]> Files=new Dictionary<string,byte[]>(StringComparer.OrdinalIgnoreCase);
  public Dictionary<string,string> Hashes=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
  public static string Hash(byte[] bytes){using(var s=SHA256.Create())return BitConverter.ToString(s.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
  public static string FileHash(string file){return Hash(File.ReadAllBytes(file));}
  public static XDocument ParseXml(string text){using(var reader=XmlReader.Create(new StringReader(text),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=4000000}))return XDocument.Load(reader);}
  public static Payload Load(){
   byte[] resource;using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload")){if(stream==null)throw new Exception("安装资源缺失。");using(var ms=new MemoryStream()){stream.CopyTo(ms);resource=ms.ToArray();}}
   if(Hash(resource)!=PayloadBuild.Digest)throw new Exception("安装资源校验失败，请重新获取安装器。");
   string xml;using(var input=new MemoryStream(resource))using(var gzip=new GZipStream(input,CompressionMode.Decompress))using(var reader=new StreamReader(gzip,Encoding.UTF8))xml=reader.ReadToEnd();
   var doc=ParseXml(xml);var p=new Payload{Version=(string)doc.Root.Attribute("Version"),CoreVersion=(string)doc.Root.Attribute("CoreVersion"),License=doc.Root.Element("License").Value};
   string[] allowed={"CSXS/manifest.xml","index.html","js/CSInterface.js","js/client.js","js/encoder-discovery.js","host/export-markers.jsx"};
   foreach(var item in doc.Root.Elements("File")){string name=(string)item.Attribute("Path"),hash=(string)item.Attribute("SHA256");if(!allowed.Contains(name)||p.Files.ContainsKey(name))throw new Exception("安装资源路径不合法。");byte[] bytes=Convert.FromBase64String(item.Value);if(bytes.Length!=(int)item.Attribute("Length")||Hash(bytes)!=hash)throw new Exception("安装文件校验失败："+name);p.Files.Add(name,bytes);p.Hashes.Add(name,hash);}
   if(!allowed.Take(6).All(p.Files.ContainsKey))throw new Exception("插件文件不完整。");
   if(p.Hashes["host/export-markers.jsx"]!="d09964ed0bed9cfd88b26c38fcd9368c66a556d1f985043ec99e956b3186f495")throw new Exception("已验证核心不匹配。");
   byte[] core=p.Files["host/export-markers.jsx"];if(core.Length<3||core[0]!=239||core[1]!=187||core[2]!=191)throw new Exception("核心 UTF-8 BOM 缺失。");
   string client=Encoding.UTF8.GetString(p.Files["js/client.js"]);if(!client.Contains("MediaIO/systempresets/")||!client.Contains("EncoderDiscovery.find")||p.Files.Count!=6)throw new Exception("本机预设检测资源校验失败。");return p;
  }
 }
 public sealed class InstallRecord {
  public string Id,Status,Target,PreviousBackup="",PreviousStateBackup="",Uninstaller="",RemovalBackup="",DebugKey="";
  public bool DebugChanged,DebugReadbackVerified;
  public RegistryImage DebugBefore=new RegistryImage(),DebugAfter=new RegistryImage(),RegistrationBefore=new RegistryImage();
  public Dictionary<string,string> PreviousFiles=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
  public XElement Xml(){return new XElement("Install",new XAttribute("Owner",Engine.Owner),new XAttribute("Id",Id),new XAttribute("Status",Status),new XElement("Target",Target),new XElement("PreviousBackup",PreviousBackup),new XElement("PreviousStateBackup",PreviousStateBackup),new XElement("Uninstaller",Uninstaller),new XElement("RemovalBackup",RemovalBackup),new XElement("DebugKey",DebugKey),new XElement("DebugChanged",DebugChanged),new XElement("DebugReadbackVerified",DebugReadbackVerified),DebugBefore.Xml("DebugBefore"),DebugAfter.Xml("DebugAfter"),RegistrationBefore.Xml("RegistrationBefore"),new XElement("PreviousFiles",PreviousFiles.Select(x=>new XElement("File",new XAttribute("Path",x.Key),new XAttribute("Hash",x.Value)))));}
  public static InstallRecord Parse(string xml){var x=Payload.ParseXml(xml).Root;if(x.Name!="Install"||(string)x.Attribute("Owner")!=Engine.Owner)throw new Exception("安装记录不属于此插件。");return new InstallRecord{Id=(string)x.Attribute("Id"),Status=(string)x.Attribute("Status"),Target=x.Element("Target").Value,PreviousBackup=x.Element("PreviousBackup").Value,PreviousStateBackup=x.Element("PreviousStateBackup").Value,Uninstaller=x.Element("Uninstaller").Value,RemovalBackup=x.Element("RemovalBackup").Value,DebugKey=x.Element("DebugKey").Value,DebugChanged=(bool)x.Element("DebugChanged"),DebugReadbackVerified=(bool)x.Element("DebugReadbackVerified"),DebugBefore=RegistryImage.Parse(x.Element("DebugBefore")),DebugAfter=RegistryImage.Parse(x.Element("DebugAfter")),RegistrationBefore=RegistryImage.Parse(x.Element("RegistrationBefore")),PreviousFiles=x.Element("PreviousFiles").Elements("File").ToDictionary(y=>(string)y.Attribute("Path"),y=>(string)y.Attribute("Hash"),StringComparer.OrdinalIgnoreCase)};}
 }
 public sealed class Engine {
  public const string Owner="com.texs.markerexport.exe-installer";
  public readonly Locations Paths;readonly IPlatform Platform;readonly Payload Content;
  public readonly List<string> Notes=new List<string>();
  public Engine(Locations paths,IPlatform platform,Payload payload){Paths=paths;Platform=platform;Content=payload;}
  static bool EqualPath(string a,string b){return Path.GetFullPath(a).TrimEnd('\\').Equals(Path.GetFullPath(b).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);}
  public static void Guard(string path){string p=Path.GetFullPath(path);while(p!=null){if(File.Exists(p)||Directory.Exists(p)){if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new Exception("目录包含链接或重解析点，已停止："+p);}var parent=Directory.GetParent(p);p=parent==null?null:parent.FullName;}}
  static void Below(string path,string parent){if(string.IsNullOrEmpty(path))return;string p=Path.GetFullPath(parent).TrimEnd('\\')+Path.DirectorySeparatorChar;if(!Path.GetFullPath(path).StartsWith(p,StringComparison.OrdinalIgnoreCase))throw new Exception("安装记录路径超出本插件范围。");Guard(path);}
  string Unique(string root,string suffix){Guard(root);Directory.CreateDirectory(root);string p=Path.Combine(root,DateTime.UtcNow.ToString("yyMMdd-HHmmssfff")+"-"+Guid.NewGuid().ToString("N").Substring(0,12)+"-"+suffix);Below(p,root);if(Directory.Exists(p)||File.Exists(p))throw new Exception("备份名称冲突。");return p;}
  void PrepareLocations(){Guard(Paths.Target);Guard(Paths.Backups);Guard(Paths.Home);Directory.CreateDirectory(Paths.Home);Directory.CreateDirectory(Paths.History);Directory.CreateDirectory(Paths.Builds);}
  static Dictionary<string,string> TreeHashes(string dir){Guard(dir);var r=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(string child in Directory.GetDirectories(dir,"*",SearchOption.AllDirectories))Guard(child);foreach(string f in Directory.GetFiles(dir,"*",SearchOption.AllDirectories)){Guard(f);r.Add(f.Substring(dir.TrimEnd('\\').Length+1).Replace('\\','/'),Payload.FileHash(f));}return r;}
  static void VerifyTree(string dir,Dictionary<string,string> expected){if(!Directory.Exists(dir))throw new Exception("待核对目录缺失："+dir);var actual=TreeHashes(dir);if(actual.Count!=expected.Count||!expected.All(x=>actual.ContainsKey(x.Key)&&actual[x.Key]==x.Value))throw new Exception("文件发生变化，未进行覆盖或删除："+dir);}
  public bool PayloadMatchesTarget(){try{VerifyTree(Paths.Target,Content.Hashes);return true;}catch{return false;}}
  static string ManifestVersion(string dir){string f=Path.Combine(dir,"CSXS","manifest.xml");if(!File.Exists(f))throw new Exception("同名文件夹没有本插件清单，安装已停止。");var doc=Payload.ParseXml(File.ReadAllText(f));if((string)doc.Root.Attribute("ExtensionBundleId")!="com.texs.markerexport")throw new Exception("同名文件夹属于其他插件，安装已停止。");return (string)doc.Root.Attribute("ExtensionBundleVersion")??"未知";}
  public string ExistingVersion(){return Directory.Exists(Paths.Target)?ManifestVersion(Paths.Target):"未安装";}
  public InstallRecord ReadState(){if(!File.Exists(Paths.State))return null;Guard(Paths.State);var r=InstallRecord.Parse(File.ReadAllText(Paths.State));if(!EqualPath(r.Target,Paths.Target))throw new Exception("安装记录目标不匹配。");Below(r.PreviousBackup,Paths.Backups);Below(r.RemovalBackup,Paths.Backups);Below(r.Uninstaller,Paths.Builds);Below(r.PreviousStateBackup,Paths.History);return r;}
  static void WriteAtomic(string path,string text){Guard(path);Directory.CreateDirectory(Path.GetDirectoryName(path));string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{File.WriteAllText(temp,text,new UTF8Encoding(false));if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}finally{if(File.Exists(temp))File.Delete(temp);}}
  void SaveState(InstallRecord r){WriteAtomic(Paths.State,new XDocument(r.Xml()).ToString());}
  void EnsureClosed(){if(Platform.AdobeRunning())throw new Exception("Premiere 或 AME 仍在运行。请先保存工程并自行关闭，再重试；安装器不会强制结束进程。");}
  void EnsureInstallEnvironment(){EnsureClosed();AppInfo apps=Platform.InspectApps();if(!apps.Compatible)throw new Exception("未检测到 Premiere Pro。请先安装 Premiere；自定义位置可在窗口中选择 Adobe Premiere Pro.exe。");if(!apps.PresetsReady)Notes.Add("插件文件可以安装；未找到本机 AME 的 H.264 / WAV 预设，实际导出前需补齐并在面板重新检查。");if(apps.CepMajor<=0)Notes.Add("未识别 CEP：仅安装插件文件，不猜测或修改任何 CEP 调试设置。请在实际 Premiere 中检查加载。");}

  RegistryImage RegistrationFor(InstallRecord r){var d=new RegistryImage{Exists=true};foreach(var v in new[]{new ValueRecord("InstallOwner","String",Owner),new ValueRecord("InstallToken","String",r.Id),new ValueRecord("DisplayName","String","Premiere ClipOut · 剪辑批量导出（Premiere Pro）"),new ValueRecord("DisplayVersion","String",Content.Version),new ValueRecord("Publisher","String","Premiere ClipOut · 剪辑批量导出"),new ValueRecord("InstallLocation","String",Paths.Target),new ValueRecord("DisplayIcon","String",r.Uninstaller),new ValueRecord("UninstallString","String","\""+r.Uninstaller+"\" --uninstall"),new ValueRecord("NoModify","DWord","1"),new ValueRecord("NoRepair","DWord","1"),new ValueRecord("EstimatedSize","DWord",((Content.Files.Values.Sum(x=>x.Length)+new FileInfo(r.Uninstaller).Length)/1024+1).ToString(System.Globalization.CultureInfo.InvariantCulture))})d.Values.Add(v);return d;}
  void RegistrationOwned(InstallRecord r){RegistryImage reg=Platform.ReadRegistration();if(reg.Get("InstallOwner")!=Owner||reg.Get("InstallToken")!=r.Id)throw new Exception("卸载记录已经被替换，不移除其他安装或新版本。");}
  public bool IsCurrentOwned(){try{var r=ReadState();if(r==null||r.Status!="Installed")return false;RegistrationOwned(r);ManifestVersion(Paths.Target);VerifyTree(Paths.Target,Content.Hashes);return true;}catch{return false;}}
  void RestoreDebugIfUnchanged(InstallRecord r,bool consent){if(!r.DebugChanged||!consent)return;string originalKey=Platform.DebugKey;try{Platform.UseDebugKey(r.DebugKey);RegistryImage now=Platform.ReadDebug();if(!now.Same(r.DebugAfter)){Notes.Add("共享 CEP 设置已发生变化，已保留新设置，不自动恢复。");return;}Platform.ApplyDebug(r.DebugBefore);var after=Platform.ReadDebug();var desired=r.DebugBefore.Copy();desired.Exists=after.Exists;if(!after.Same(desired))throw new Exception("CEP 原设置恢复后读回不一致，请查看安装记录。");}finally{Platform.UseDebugKey(originalKey);}}
  void RestorePreviousState(InstallRecord r){if(!string.IsNullOrEmpty(r.PreviousStateBackup)){Below(r.PreviousStateBackup,Paths.History);InstallRecord.Parse(File.ReadAllText(r.PreviousStateBackup));WriteAtomic(Paths.State,File.ReadAllText(r.PreviousStateBackup));}else if(File.Exists(Paths.State))File.Delete(Paths.State);}
  void RestoreRegistration(InstallRecord r){var now=Platform.ReadRegistration();if((now.Get("InstallOwner")==Owner&&now.Get("InstallToken")==r.Id)||(r.Status=="Uninstalled"&&!now.Exists))Platform.ApplyRegistration(r.RegistrationBefore);else if(!now.Same(r.RegistrationBefore))Notes.Add("卸载入口已被其他安装改动，保留该入口。");}
  public InstallRecord Install(string executable,bool debugConsent){
   Notes.Clear();EnsureInstallEnvironment();Guard(executable);if(!File.Exists(executable))throw new Exception("安装程序文件不可用。");
   bool configureDebug=debugConsent&&!string.IsNullOrEmpty(Platform.DebugKey);var debugBefore=configureDebug?Platform.ReadDebug():new RegistryImage();if(!configureDebug)Notes.Add("未修改共享 CEP 调试设置。若面板未显示，请检查该 Premiere 对应的 CEP 未签名扩展加载设置。");
   var regBefore=Platform.ReadRegistration();if(regBefore.Exists&&regBefore.Get("InstallOwner")!=Owner)throw new Exception("同名卸载入口不属于此安装器，已停止。");
   if(Directory.Exists(Paths.Target))ManifestVersion(Paths.Target);PrepareLocations();var prior=ReadState();
   var r=new InstallRecord{Id=Guid.NewGuid().ToString("N"),Status="Preparing",Target=Paths.Target,DebugKey=Platform.DebugKey,DebugBefore=debugBefore.Copy(),DebugAfter=debugBefore.Copy(),RegistrationBefore=regBefore.Copy()};
   if(File.Exists(Paths.State)){r.PreviousStateBackup=Unique(Paths.History,"previous-state.xml");File.Copy(Paths.State,r.PreviousStateBackup);}
   string staged=Unique(Paths.Backups,"staged"),build=Path.Combine(Paths.Builds,r.Id);bool oldMoved=false,newMoved=false,stateSaved=false,debugTouched=false;var recovery=new List<string>();
   try{
    Directory.CreateDirectory(staged);foreach(var item in Content.Files){string outFile=Path.Combine(staged,item.Key.Replace('/',Path.DirectorySeparatorChar));Below(outFile,staged);Directory.CreateDirectory(Path.GetDirectoryName(outFile));File.WriteAllBytes(outFile,item.Value);}VerifyTree(staged,Content.Hashes);Platform.Checkpoint("after-staging");EnsureClosed();
    if(Directory.Exists(Paths.Target)){r.PreviousFiles=TreeHashes(Paths.Target);r.PreviousBackup=Unique(Paths.Backups,"previous");Directory.Move(Paths.Target,r.PreviousBackup);oldMoved=true;VerifyTree(r.PreviousBackup,r.PreviousFiles);}Platform.Checkpoint("after-old-backup");
    EnsureClosed();Directory.CreateDirectory(Path.GetDirectoryName(Paths.Target));Directory.Move(staged,Paths.Target);newMoved=true;VerifyTree(Paths.Target,Content.Hashes);Platform.Checkpoint("after-new-target");
    Directory.CreateDirectory(build);r.Uninstaller=Path.Combine(build,"Uninstall.exe");File.Copy(executable,r.Uninstaller);if(Payload.FileHash(executable)!=Payload.FileHash(r.Uninstaller))throw new Exception("卸载程序复制校验失败。");File.WriteAllText(Path.Combine(build,"LICENSE"),Content.License,new UTF8Encoding(false));Platform.Checkpoint("after-uninstaller");
    if(configureDebug&&!debugBefore.DebugReady){debugTouched=true;var intended=new RegistryImage{Exists=true,Values=new List<ValueRecord>{new ValueRecord("PlayerDebugMode","String","1")}};r.DebugAfter=intended;Platform.ApplyDebug(intended);var after=Platform.ReadDebug();if(!after.DebugReady)throw new Exception("CEP 调试设置写入后未读回 REG_SZ 字符串 1，安装未完成。");r.DebugAfter=after.Copy();r.DebugChanged=!after.Same(debugBefore);}else if(configureDebug){if(!Platform.ReadDebug().DebugReady)throw new Exception("CEP 设置在安装时被改变，请重新确认。");}
    r.DebugReadbackVerified=configureDebug;var wanted=RegistrationFor(r);Platform.ApplyRegistration(wanted);RegistrationOwned(r);if(!Platform.ReadRegistration().Same(wanted))throw new Exception("卸载入口读回校验失败，安装未完成。");Platform.Checkpoint("after-registration");r.Status="Installed";Platform.Checkpoint("before-state");SaveState(r);stateSaved=true;return r;
   }catch(Exception original){
    try{RestoreRegistration(r);}catch(Exception x){recovery.Add("卸载入口恢复："+x.Message);}
    try{if(newMoved&&Directory.Exists(Paths.Target)){VerifyTree(Paths.Target,Content.Hashes);string failed=Unique(Paths.Backups,"failed-install");Directory.Move(Paths.Target,failed);}if(oldMoved&&Directory.Exists(r.PreviousBackup)&&!Directory.Exists(Paths.Target)){VerifyTree(r.PreviousBackup,r.PreviousFiles);Directory.Move(r.PreviousBackup,Paths.Target);}if(stateSaved)RestorePreviousState(r);}catch(Exception x){recovery.Add("插件恢复："+x.Message);}
    try{if(debugTouched){var now=Platform.ReadDebug();if(now.DebugReady){r.DebugAfter=now;r.DebugChanged=true;RestoreDebugIfUnchanged(r,true);}else if(!debugBefore.Exists&&now.Exists&&now.Values.Count==0)Platform.ApplyDebug(debugBefore);}}catch(Exception x){recovery.Add("共享设置恢复："+x.Message);}
    string message=original.Message+(recovery.Count==0?"\n已恢复安装前的插件与卸载入口；未报告安装成功。":"\n部分恢复未完成，文件和备份均保留：\n"+string.Join("\n",recovery));
    try{WriteAtomic(Path.Combine(Paths.Home,"last-failure.txt"),DateTime.UtcNow.ToString("o")+"\n"+message);}catch{}throw new Exception(message,original);
   }
  }
  public InstallRecord Uninstall(bool restoreDebug){
   Notes.Clear();EnsureClosed();PrepareLocations();var r=ReadState();if(r==null||r.Status!="Installed")throw new Exception("没有本安装器当前安装记录，未移除任何插件。");RegistrationOwned(r);ManifestVersion(Paths.Target);VerifyTree(Paths.Target,Content.Hashes);
   r.RemovalBackup=Unique(Paths.Backups,"uninstalled");bool moved=false;RegistryImage reg=Platform.ReadRegistration();try{EnsureClosed();Directory.Move(Paths.Target,r.RemovalBackup);moved=true;VerifyTree(r.RemovalBackup,Content.Hashes);Platform.Checkpoint("uninstall-after-move");Platform.ApplyRegistration(new RegistryImage());r.Status="Uninstalled";Platform.Checkpoint("uninstall-before-state");SaveState(r);}catch{if(moved&&!Directory.Exists(Paths.Target)&&Directory.Exists(r.RemovalBackup))Directory.Move(r.RemovalBackup,Paths.Target);Platform.ApplyRegistration(reg);r.Status="Installed";SaveState(r);throw;}
   RestoreDebugIfUnchanged(r,restoreDebug);SaveState(r);return r;
  }
  public InstallRecord Rollback(bool restoreDebug){
   Notes.Clear();EnsureClosed();PrepareLocations();var r=ReadState();if(r==null||string.IsNullOrEmpty(r.PreviousBackup))throw new Exception("没有可恢复的安装前版本。");VerifyTree(r.PreviousBackup,r.PreviousFiles);
   if(r.Status=="Installed"){RegistrationOwned(r);ManifestVersion(Paths.Target);VerifyTree(Paths.Target,Content.Hashes);}else if(r.Status=="Uninstalled"){if(Platform.ReadRegistration().Exists)throw new Exception("卸载后出现了新的卸载入口，停止回滚以保留其他安装。");if(Directory.Exists(Paths.Target))throw new Exception("目标目录已出现其他安装，不覆盖。");}else throw new Exception("当前记录不允许回滚。");
   string removed="";bool oldRestored=false;RegistryImage reg=Platform.ReadRegistration();try{EnsureClosed();if(Directory.Exists(Paths.Target)){removed=Unique(Paths.Backups,"rollback-current");Directory.Move(Paths.Target,removed);}Directory.Move(r.PreviousBackup,Paths.Target);oldRestored=true;VerifyTree(Paths.Target,r.PreviousFiles);Platform.Checkpoint("rollback-after-old");RestoreRegistration(r);RestorePreviousState(r);}catch{if(oldRestored&&Directory.Exists(Paths.Target)&&!Directory.Exists(r.PreviousBackup))Directory.Move(Paths.Target,r.PreviousBackup);if(!string.IsNullOrEmpty(removed)&&Directory.Exists(removed)&&!Directory.Exists(Paths.Target))Directory.Move(removed,Paths.Target);Platform.ApplyRegistration(reg);SaveState(r);throw;}
   RestoreDebugIfUnchanged(r,restoreDebug);r.Status="RolledBack";r.RemovalBackup=removed;return r;
  }
 }
}
