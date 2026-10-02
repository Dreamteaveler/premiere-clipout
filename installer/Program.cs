using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Xml.Linq;
namespace MarkerExportSetup {
 static class Program {
  [STAThread] static int Main(string[] args){
   try{
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    if(args.Length==2&&args[0]=="--probe")return Probe(args[1]);
    if(args.Length==2&&args[0]=="--sandbox-test")return SandboxTest(args[1]);
    if(args.Length>0&&args[0]!="--uninstall"){MessageBox.Show("此安装器只支持交互安装、--uninstall 和只读 --probe 检查。","参数无效");return 2;}
    string sid=WindowsIdentity.GetCurrent().User.Value;bool created;
    using(var mutex=new Mutex(true,"Local\\PremiereClipExportInstaller-"+sid,out created)){
     if(!created){MessageBox.Show("当前用户已有安装或卸载窗口，请先完成该操作。","Premiere ClipOut · 剪辑批量导出");return 2;}
     try{bool uninstall=args.Contains("--uninstall")||Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location).IndexOf("Uninstall",StringComparison.OrdinalIgnoreCase)>=0;Application.Run(new SetupForm(uninstall));}finally{mutex.ReleaseMutex();}
    }return 0;
   }catch(Exception e){if(args.Length==2&&(args[0]=="--probe"||args[0]=="--sandbox-test")){string report=args[0]=="--probe"?args[1]+".error.txt":Path.Combine(args[1],"error.txt");try{SafeReportPath(report);Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report)));File.WriteAllText(report,e.ToString(),new UTF8Encoding(false));}catch{}return 1;}MessageBox.Show(e.Message,"Premiere ClipOut · 剪辑批量导出：未完成",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
  }
  static void SafeReportPath(string path){string full=Path.GetFullPath(path);string[] allowed={Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('\\')+"\\",Path.GetFullPath(Path.GetTempPath()).TrimEnd('\\')+"\\"};if(!allowed.Any(p=>full.StartsWith(p,StringComparison.OrdinalIgnoreCase)))throw new Exception("检查报告只能写到当前工作目录或临时目录下。");Engine.Guard(full);}
  static int Probe(string output){SafeReportPath(output);var p=new WindowsPlatform();var apps=p.InspectApps();var content=Payload.Load();var locations=new Locations(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));var engine=new Engine(locations,p,content);
   bool uninstall=Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location).IndexOf("Uninstall",StringComparison.OrdinalIgnoreCase)>=0;
   using(var form=new SetupForm(uninstall)){form.CreateControl();var handle=form.Handle;var doc=new XDocument(new XElement("InstallerProbe",new XAttribute("Version",content.Version),new XAttribute("Mode",uninstall?"Uninstall":"Install"),new XAttribute("FormCreated",handle!=IntPtr.Zero),new XAttribute("Mutation",false),new XElement("PremierePath",apps.PremierePath),new XElement("PremiereVersion",apps.PremiereVersion),new XElement("AMEPath",apps.EncoderPath),new XElement("AMEVersion",apps.EncoderVersion),new XElement("CepMajor",apps.CepMajor),new XElement("DebugKey",p.DebugKey),new XElement("Running",p.AdobeRunning()),new XElement("PresetsReady",apps.PresetsReady),new XElement("VideoPreset",apps.VideoPreset),new XElement("AudioPreset",apps.AudioPreset),p.ReadDebug().Xml("DebugReadOnly"),new XElement("Target",locations.Target),new XElement("ExistingVersion",engine.ExistingVersion()),new XElement("PayloadFiles",content.Files.Count),new XElement("CoreSHA256",content.Hashes["host/export-markers.jsx"])));Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));File.WriteAllText(output,doc.ToString(),new UTF8Encoding(false));form.PreviewMode=true;form.ShowInTaskbar=false;form.Opacity=0;form.Show();Application.DoEvents();form.PerformLayout();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,form.Width,form.Height));bitmap.Save(output+".png",System.Drawing.Imaging.ImageFormat.Png);}form.Close();}return 0;
  }
  static int SandboxTest(string root){SafeReportPath(Path.Combine(root,"report.txt"));Directory.CreateDirectory(root);using(var writer=new StringWriter()){Console.SetOut(writer);int result=Tests.Run(new[]{root});File.WriteAllText(Path.Combine(root,"installer-tests.txt"),writer.ToString(),new UTF8Encoding(false));return result;}}
 }
 sealed class SetupForm:Form {
  readonly WindowsPlatform platform=new WindowsPlatform();readonly Engine engine;
  readonly Label summary=new Label(),target=new Label(),oldVersion=new Label(),notice=new Label();readonly TextBox log=new TextBox();
  readonly Button install=new Button(),uninstall=new Button(),rollback=new Button(),refresh=new Button(),close=new Button();
  AppInfo apps;bool working,uninstallMode;internal bool PreviewMode;protected override bool ShowWithoutActivation{get{return PreviewMode;}}
  internal SetupForm(bool removeMode){
   uninstallMode=removeMode;var content=Payload.Load();engine=new Engine(new Locations(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)),platform,content);
   Text="Premiere ClipOut · 剪辑批量导出 "+content.Version+" — "+(removeMode?"卸载与恢复":"安装");Font=new Font("Microsoft YaHei UI",9F);ClientSize=new Size(700,510);MinimumSize=new Size(660,500);StartPosition=FormStartPosition.CenterScreen;AutoScaleMode=AutoScaleMode.Dpi;
   var layout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=8,Padding=new Padding(18)};
   foreach(float height in new[]{32F,74F,48F,26F,52F,48F,0F,32F})layout.RowStyles.Add(new RowStyle(height==0?SizeType.Percent:SizeType.Absolute,height==0?100:height));Controls.Add(layout);
   layout.Controls.Add(new Label{Text="Premiere ClipOut · 剪辑批量导出 "+content.Version,Font=new Font(Font.FontFamily,15F,FontStyle.Bold),Dock=DockStyle.Fill},0,0);
   summary.Dock=DockStyle.Fill;layout.Controls.Add(summary,0,1);target.Dock=DockStyle.Fill;target.AutoEllipsis=true;target.Text="仅为当前用户安装：\n"+engine.Paths.Target;layout.Controls.Add(target,0,2);
   oldVersion.Dock=DockStyle.Fill;layout.Controls.Add(oldVersion,0,3);
   notice.Dock=DockStyle.Fill;notice.Text="固定 H.264＋WAV；读取本机 AME 预设，包内不含 .epr。\n只加入 AME 队列，不自动编码。请先保存并关闭 PR 与 AME。";layout.Controls.Add(notice,0,4);
   var buttons=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.LeftToRight,WrapContents=false};layout.Controls.Add(buttons,0,5);
   install.Text="安装 / 更新";uninstall.Text="卸载插件";rollback.Text="恢复上一版本";refresh.Text="重新检查";close.Text="关闭";
   foreach(var button in new[]{install,uninstall,rollback,refresh,close}){button.AutoSize=true;button.Height=34;button.Margin=new Padding(0,5,8,0);buttons.Controls.Add(button);}
   log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;log.Dock=DockStyle.Fill;log.BackColor=SystemColors.Window;layout.Controls.Add(log,0,6);
   layout.Controls.Add(new Label{Text="MIT · 原作者 Tex Jernigan。仅 PR 2026 已有核心实测；新版安装器经过隔离验证。",Dock=DockStyle.Fill,ForeColor=SystemColors.GrayText},0,7);
   install.Click+=(s,e)=>Install();uninstall.Click+=(s,e)=>Remove();rollback.Click+=(s,e)=>Rollback();refresh.Click+=(s,e)=>RefreshInfo();close.Click+=(s,e)=>Close();FormClosing+=(s,e)=>{if(working)e.Cancel=true;};
   AcceptButton=removeMode?uninstall:install;CancelButton=close;RefreshInfo();if(removeMode)install.Visible=false;
  }
  void RefreshInfo(){
   try{apps=platform.InspectApps();bool running=platform.AdobeRunning();var debug=platform.ReadDebug();summary.Text="Premiere："+(apps.PremiereVersion==""?"未找到 2026":apps.PremiereVersion)+"    AME："+(apps.EncoderVersion==""?"未找到 2026":apps.EncoderVersion)+"\nCEP："+(apps.CepMajor>0?apps.CepMajor.ToString():"未识别")+"    本机 H.264 / WAV："+(apps.PresetsReady?"已找到":"未找到")+"\n"+(running?"PR / AME 正在运行，请先保存并自行关闭。":debug.DebugReady?"共享调试设置：已是 REG_SZ 1，无需修改。":"加载未签名插件需要你明确同意开启共享 CEP 调试。");oldVersion.Text="当前插件："+engine.ExistingVersion();var state=engine.ReadState();install.Enabled=!working&&!running&&apps.Compatible&&apps.PresetsReady&&apps.CepMajor>0;uninstall.Enabled=!working&&!running&&engine.IsCurrentOwned();rollback.Enabled=!working&&!running&&state!=null&&!string.IsNullOrEmpty(state.PreviousBackup)&&Directory.Exists(state.PreviousBackup);refresh.Enabled=!working;close.Enabled=!working;
    if(!apps.Compatible)Write("安装暂不可用：需要 Premiere Pro 2026 与 AME 2026。其他版本未测试。");else if(!apps.PresetsReady)Write("安装暂不可用：没有找到本机 AME 2026 的两份系统预设，或预设文件无效。支持默认 Adobe 目录和与 Premiere 同级的 AME 2026 目录。");
   }catch(Exception e){install.Enabled=uninstall.Enabled=rollback.Enabled=false;Write(e.Message);}
  }
  void Write(string text){log.AppendText(text+Environment.NewLine);}
  bool Confirm(string text,string caption){return MessageBox.Show(this,text,caption,MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes;}
  bool RestoreConsent(InstallRecord record){return record!=null&&record.DebugChanged&&Confirm("此安装器曾修改共享 CEP 的 PlayerDebugMode。\n是否恢复安装前的值和类型？其他未签名扩展可能因此无法加载。\n选择“否”保留当前设置；如果设置后来发生变化，安装器也会保留新设置。","是否恢复共享 CEP 设置？");}
  void Execute(string description,Action action){working=true;foreach(var b in new[]{install,uninstall,rollback,refresh,close})b.Enabled=false;Cursor=Cursors.WaitCursor;Write(description);try{action();foreach(string note in engine.Notes)Write(note);}catch(Exception e){Write("操作未完成："+e.Message);MessageBox.Show(this,e.Message,"操作未完成",MessageBoxButtons.OK,MessageBoxIcon.Error);}finally{working=false;Cursor=Cursors.Default;RefreshInfo();}}
  void Install(){RefreshInfo();if(!install.Enabled)return;bool consent=false;var debug=platform.ReadDebug();if(!debug.DebugReady){consent=Confirm("未签名 CEP 插件需要开启调试加载。\n将修改当前用户 HKCU\\"+platform.DebugKey+"\\PlayerDebugMode 为 REG_SZ 字符串 1。\n这是此 CEP 版本的共享设置，会影响其他未签名扩展。安装器会记录原值与类型；不会更改 PowerShell 策略。\n是否同意这项修改并安装？","开启共享 CEP 调试并安装？");if(!consent){Write("未同意修改共享设置，安装已取消。");return;}}
   Execute("正在校验文件、备份旧版并安装…",()=>{var r=engine.Install(Assembly.GetExecutingAssembly().Location,consent);Write("安装完成。文件及卸载入口校验通过。\n打开 Premiere：窗口 → 扩展 → Premiere ClipOut · 剪辑批量导出。\n卸载入口已加入 Windows“已安装的应用”。\n旧版备份："+(r.PreviousBackup==""?"无旧版":r.PreviousBackup));});
  }
  void Remove(){if(!Confirm("卸载仅移出此安装器管理且校验一致的插件文件。\n其他插件不受影响，备份与设置会保留，供恢复上一版本使用。\n是否继续？","卸载Premiere ClipOut · 剪辑批量导出？"))return;var r=engine.ReadState();bool restore=RestoreConsent(r);Execute("正在卸载…",()=>{var done=engine.Uninstall(restore);Write("插件已卸载，Windows 卸载入口已移除。\n卸载文件保留在："+done.RemovalBackup);});}
  void Rollback(){if(!Confirm("恢复安装前的同名插件。当前版本会移入备份目录。\n请确认 PR / AME 已保存并关闭。是否继续？","恢复上一版本？"))return;var r=engine.ReadState();bool restore=RestoreConsent(r);Execute("正在核对备份并恢复…",()=>{engine.Rollback(restore);Write("已恢复安装前版本及相应卸载记录。");});}
 }
}
