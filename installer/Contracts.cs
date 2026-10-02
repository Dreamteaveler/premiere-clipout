using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
namespace MarkerExportSetup {
 public sealed class ValueRecord {
  public string Name, Kind, Data;
  public ValueRecord() {}
  public ValueRecord(string name,string kind,string data){Name=name;Kind=kind;Data=data;}
  public XElement Xml(){return new XElement("Value",new XAttribute("Name",Name),new XAttribute("Kind",Kind),Data??"");}
  public static ValueRecord Parse(XElement x){return new ValueRecord((string)x.Attribute("Name"),(string)x.Attribute("Kind"),x.Value);}
 }
 public sealed class RegistryImage {
  public bool Exists; public List<ValueRecord> Values=new List<ValueRecord>();
  public string Get(string name){ValueRecord v=Values.FirstOrDefault(x=>x.Name==name);return v==null?null:v.Data;}
  public ValueRecord Find(string name){return Values.FirstOrDefault(x=>x.Name==name);}
  public XElement Xml(string name){return new XElement(name,new XAttribute("Exists",Exists),Values.Select(x=>x.Xml()));}
  public static RegistryImage Parse(XElement x){var r=new RegistryImage();r.Exists=(bool)x.Attribute("Exists");r.Values=x.Elements("Value").Select(ValueRecord.Parse).ToList();return r;}
  public RegistryImage Copy(){return Parse(Xml("Registry"));}
  public bool Same(RegistryImage other){return Exists==other.Exists&&Values.Count==other.Values.Count&&Values.All(x=>other.Values.Any(y=>y.Name==x.Name&&y.Kind==x.Kind&&y.Data==x.Data));}
  public bool DebugReady {get{var v=Find("PlayerDebugMode");return v!=null&&v.Kind=="String"&&v.Data=="1";}}
 }
 public sealed class AppInfo {
  public string PremierePath="", EncoderPath="", PremiereVersion="", EncoderVersion="",VideoPreset="",AudioPreset="";
  public int PremiereMajor, EncoderMajor, CepMajor; public bool PresetsReady;
  public bool Compatible {get{return PremiereMajor>0;}}
 }
 public interface IPlatform {
  string DebugKey {get;} void UseDebugKey(string key); AppInfo InspectApps(); bool AdobeRunning(); RegistryImage ReadDebug(); void ApplyDebug(RegistryImage image);
  RegistryImage ReadRegistration(); void ApplyRegistration(RegistryImage image); void Checkpoint(string name);
 }
 public sealed class Locations {
  public readonly string Target,Backups,Home,State,History,Builds;
  public Locations(string appData,string localAppData){Target=System.IO.Path.Combine(appData,"Adobe","CEP","extensions","com.texs.markerexport");Backups=System.IO.Path.Combine(appData,"Adobe","CEP","marker-export-backups");Home=System.IO.Path.Combine(localAppData,"PremiereClipExport","Installer");State=System.IO.Path.Combine(Home,"current-state.xml");History=System.IO.Path.Combine(Home,"history");Builds=System.IO.Path.Combine(Home,"builds");}
 }
}
