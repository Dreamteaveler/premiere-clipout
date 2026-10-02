using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
namespace MarkerExportSetup {
 sealed class FakePlatform:IPlatform {
  internal AppInfo Apps=new AppInfo{PremiereMajor=26,EncoderMajor=26,CepMajor=12,PresetsReady=true,PremiereVersion="26.0",EncoderVersion="26.0"};
  internal bool Running,FailDebugWrite,BadDebugReadback;
  internal string FailAt="";
  internal RegistryImage Debug=new RegistryImage(),Reg=new RegistryImage();
  internal int DebugWrites,RegistrationWrites;
  string debugKey="Software\\Adobe\\CSXS.12"; public string DebugKey {get{return debugKey;}} public void UseDebugKey(string key){debugKey=key;}
  public AppInfo InspectApps(){return Apps;} public bool AdobeRunning(){return Running;}
  public RegistryImage ReadDebug(){return Debug.Copy();}
  public void ApplyDebug(RegistryImage image){DebugWrites++;if(FailDebugWrite)throw new IOException("Simulated registry access denied");Debug=image.Copy();if(BadDebugReadback&&image.DebugReady){Debug.Values[0].Kind="DWord";}}
  public RegistryImage ReadRegistration(){return Reg.Copy();}
  public void ApplyRegistration(RegistryImage image){RegistrationWrites++;Reg=image.Copy();}
  public void Checkpoint(string name){if(FailAt==name){FailAt="";throw new IOException("Simulated failure at "+name);}}
 }
 static class Tests {
  static string Root;static Payload Payload;static int Passed,Failed;
  static void Assert(bool ok,string message){if(!ok)throw new Exception(message);}
  static void ExpectFailure(Action action){bool failed=false;try{action();}catch{failed=true;}Assert(failed,"Operation incorrectly succeeded");}
  static RegistryImage Ready(){return new RegistryImage{Exists=true,Values=new List<ValueRecord>{new ValueRecord("PlayerDebugMode","String","1")}};}
  static void Case(string name,Action<Engine,FakePlatform> test){string folder=Path.Combine(Root,Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(folder);var l=new Locations(Path.Combine(folder,"Roaming"),Path.Combine(folder,"Local"));var p=new FakePlatform{Debug=Ready()};var e=new Engine(l,p,Payload);try{test(e,p);Passed++;Console.WriteLine("PASS "+name);}catch(Exception x){Failed++;Console.WriteLine("FAIL "+name+": "+x.Message);}}
  static void SeedOld(Engine e){Directory.CreateDirectory(Path.Combine(e.Paths.Target,"CSXS"));File.WriteAllText(Path.Combine(e.Paths.Target,"CSXS","manifest.xml"),"<ExtensionManifest ExtensionBundleId=\"com.texs.markerexport\" ExtensionBundleVersion=\"1.0.0\"/>");File.WriteAllText(Path.Combine(e.Paths.Target,"old.txt"),"old plugin content");Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(e.Paths.Target),"other.plugin"));File.WriteAllText(Path.Combine(Path.GetDirectoryName(e.Paths.Target),"other.plugin","keep.txt"),"other plugin");}
  static void OldIntact(Engine e){Assert(File.ReadAllText(Path.Combine(e.Paths.Target,"old.txt"))=="old plugin content","Old plugin not restored");Assert(File.ReadAllText(Path.Combine(Path.GetDirectoryName(e.Paths.Target),"other.plugin","keep.txt"))=="other plugin","Other plugin touched");}
  internal static int Run(string[] args){return Main(args);}
  static int Main(string[] args){Root=Path.GetFullPath(args[0]);Directory.CreateDirectory(Root);Payload=Payload.Load();string self=System.Reflection.Assembly.GetExecutingAssembly().Location;
   Case("fresh install with existing debug ready",(e,p)=>{var r=e.Install(self,false);Assert(e.IsCurrentOwned(),"Owned install missing");Assert(p.DebugWrites==0,"Existing security setting changed");Assert(p.Reg.Get("InstallOwner")==Engine.Owner&&p.Reg.Get("InstallToken")==r.Id,"Uninstall registration absent");});
   Case("upgrade backs up all old files and preserves another plugin",(e,p)=>{SeedOld(e);var r=e.Install(self,false);Assert(File.ReadAllText(Path.Combine(r.PreviousBackup,"old.txt"))=="old plugin content","Backup missing");Assert(File.Exists(Path.Combine(Path.GetDirectoryName(e.Paths.Target),"other.plugin","keep.txt")),"Other plugin changed");});
   Case("uninstall moves only owned plugin to backup",(e,p)=>{SeedOld(e);e.Install(self,false);var r=e.Uninstall(false);Assert(!Directory.Exists(e.Paths.Target),"Plugin not disabled");Assert(Directory.Exists(r.RemovalBackup),"Uninstalled backup missing");Assert(!p.Reg.Exists,"Uninstall entry remains");Assert(File.Exists(Path.Combine(Path.GetDirectoryName(e.Paths.Target),"other.plugin","keep.txt")),"Other plugin removed");});
   Case("rollback restores old plugin",(e,p)=>{SeedOld(e);e.Install(self,false);e.Rollback(false);OldIntact(e);Assert(!p.Reg.Exists,"Unexpected legacy uninstall entry");});
   Case("rollback after uninstall restores old plugin",(e,p)=>{SeedOld(e);e.Install(self,false);e.Uninstall(false);e.Rollback(false);OldIntact(e);});
   Case("second EXE upgrade rollback restores prior state and registration",(e,p)=>{e.Install(self,false);string first=p.Reg.Get("InstallToken");e.Install(self,false);e.Rollback(false);Assert(e.IsCurrentOwned()&&p.Reg.Get("InstallToken")==first,"Prior EXE install state not restored");e.Uninstall(false);});
   Case("Adobe running blocks install",(e,p)=>{p.Running=true;ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target)&&p.RegistrationWrites==0,"Running Adobe changed");});
   Case("Adobe running blocks uninstall",(e,p)=>{e.Install(self,false);p.Running=true;ExpectFailure(()=>e.Uninstall(false));Assert(e.IsCurrentOwned(),"Running Adobe uninstall changed files");});
   Case("unsupported Premiere blocks installation",(e,p)=>{p.Apps.PremiereMajor=25;ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target),"Unsupported version installed");});
   Case("missing AME blocks installation",(e,p)=>{p.Apps.EncoderMajor=0;ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target),"AME requirement bypassed");});
   Case("missing debug setting without consent aborts",(e,p)=>{p.Debug=new RegistryImage();ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target)&&p.DebugWrites==0,"No-consent security change");});
   Case("explicit consent writes and verifies String 1",(e,p)=>{p.Debug=new RegistryImage();var r=e.Install(self,true);Assert(p.Debug.DebugReady&&r.DebugChanged&&r.DebugReadbackVerified,"Debug verification not recorded");});
   Case("registry write failure never reports success and restores old plugin",(e,p)=>{SeedOld(e);p.Debug=new RegistryImage();p.FailDebugWrite=true;ExpectFailure(()=>e.Install(self,true));OldIntact(e);Assert(!p.Reg.Exists,"Failed install registered");});
   Case("wrong-type readback stops installation",(e,p)=>{SeedOld(e);p.Debug=new RegistryImage();p.BadDebugReadback=true;ExpectFailure(()=>e.Install(self,true));OldIntact(e);Assert(!p.Reg.Exists,"Wrong-type readback registered as success");});
   Case("uninstall retains shared debug flag by default",(e,p)=>{p.Debug=new RegistryImage();e.Install(self,true);e.Uninstall(false);Assert(p.Debug.DebugReady,"Shared setting silently restored");});
   Case("explicit restore returns original missing debug setting",(e,p)=>{p.Debug=new RegistryImage();e.Install(self,true);e.Uninstall(true);Assert(!p.Debug.Exists,"Original missing key not restored");});
   Case("changed shared flag is preserved",(e,p)=>{p.Debug=new RegistryImage();e.Install(self,true);p.Debug=new RegistryImage{Exists=true,Values=new List<ValueRecord>{new ValueRecord("PlayerDebugMode","DWord","0")}};e.Uninstall(true);Assert(p.Debug.Find("PlayerDebugMode").Kind=="DWord"&&p.Debug.Get("PlayerDebugMode")=="0","Newer setting overwritten");});
   Case("rollback restores original debug value and type on explicit consent",(e,p)=>{SeedOld(e);p.Debug=new RegistryImage{Exists=true,Values=new List<ValueRecord>{new ValueRecord("PlayerDebugMode","DWord","0")}};e.Install(self,true);e.Rollback(true);OldIntact(e);Assert(p.Debug.Find("PlayerDebugMode").Kind=="DWord"&&p.Debug.Get("PlayerDebugMode")=="0","Original kind/value lost");});
   foreach(string stage in new[]{"after-staging","after-old-backup","after-new-target","after-uninstaller","after-registration","before-state"}){string at=stage;Case("failure recovery "+at,(e,p)=>{SeedOld(e);p.FailAt=at;ExpectFailure(()=>e.Install(self,false));OldIntact(e);Assert(!p.Reg.Exists,"Failed install registration retained");});}
   Case("failed fresh install leaves no owned target",(e,p)=>{p.FailAt="after-registration";ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target)&&!p.Reg.Exists,"Fresh failure not recovered");});
   Case("installation corruption blocks uninstall",(e,p)=>{e.Install(self,false);File.AppendAllText(Path.Combine(e.Paths.Target,"index.html"),"changed");ExpectFailure(()=>e.Uninstall(false));Assert(Directory.Exists(e.Paths.Target),"Modified/newer plugin removed");});
   Case("newer uninstall registration is preserved",(e,p)=>{e.Install(self,false);p.Reg.Values.First(v=>v.Name=="InstallToken").Data="other-newer-install";ExpectFailure(()=>e.Uninstall(false));Assert(Directory.Exists(e.Paths.Target),"Newer registration ignored");});
   Case("foreign same-name folder is never replaced",(e,p)=>{Directory.CreateDirectory(e.Paths.Target);File.WriteAllText(Path.Combine(e.Paths.Target,"foreign.txt"),"do not touch");ExpectFailure(()=>e.Install(self,false));Assert(File.ReadAllText(Path.Combine(e.Paths.Target,"foreign.txt"))=="do not touch","Foreign folder modified");});
   Case("embedded core BOM, hashes and local preset discovery",(e,p)=>{e.Install(self,false);byte[] core=File.ReadAllBytes(Path.Combine(e.Paths.Target,"host","export-markers.jsx"));Assert(core[0]==239&&core[1]==187&&core[2]==191,"Core BOM lost");string client=File.ReadAllText(Path.Combine(e.Paths.Target,"js","client.js"));Assert(client.Contains("MediaIO/systempresets/")&&client.Contains("Folder.startup.parent.fsName"),"Local preset discovery lost");Assert(e.PayloadMatchesTarget(),"Payload hash mismatch");Assert(Directory.GetFiles(e.Paths.Target,"*.epr",SearchOption.AllDirectories).Length==0,"Adobe presets bundled");});
   Case("missing local presets stops before any writes",(e,p)=>{p.Apps.PresetsReady=false;ExpectFailure(()=>e.Install(self,false));Assert(!Directory.Exists(e.Paths.Target)&&p.DebugWrites==0&&p.RegistrationWrites==0,"Missing presets installed");});
   Case("rollback after EXE uninstall restores prior owned registration",(e,p)=>{e.Install(self,false);string first=p.Reg.Get("InstallToken");e.Install(self,false);e.Uninstall(false);e.Rollback(false);Assert(e.IsCurrentOwned()&&p.Reg.Get("InstallToken")==first,"Prior EXE registration missing");e.Uninstall(false);});
   foreach(string point in new[]{"uninstall-after-move","uninstall-before-state"}){string stage=point;Case("uninstall failure recovery "+stage,(e,p)=>{e.Install(self,false);p.FailAt=stage;ExpectFailure(()=>e.Uninstall(false));Assert(e.IsCurrentOwned(),"Failed uninstall did not restore plugin");});}
   Case("rollback failure restores current installed version",(e,p)=>{SeedOld(e);e.Install(self,false);p.FailAt="rollback-after-old";ExpectFailure(()=>e.Rollback(false));Assert(e.IsCurrentOwned(),"Failed rollback lost current installation");});
   Case("new registration after uninstall blocks rollback",(e,p)=>{SeedOld(e);e.Install(self,false);e.Uninstall(false);p.Reg=new RegistryImage{Exists=true,Values=new List<ValueRecord>{new ValueRecord("InstallOwner","String","foreign")}};ExpectFailure(()=>e.Rollback(false));Assert(!Directory.Exists(e.Paths.Target)&&p.Reg.Get("InstallOwner")=="foreign","New uninstall registration overwritten");});

   Console.WriteLine("RESULT passed="+Passed+" failed="+Failed);return Failed==0?0:1;
  }
 }
}
