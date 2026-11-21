using System;
using System.IO;
using System.Diagnostics;
using System.Threading.Tasks;
public class Launcher {
 static async Task Pump(Stream input, Stream output) {
  byte[] bytes=new byte[8192];int count;
  while((count=await input.ReadAsync(bytes,0,bytes.Length))>0){await output.WriteAsync(bytes,0,count);await output.FlushAsync();}
 }
 public static void Main(string[] args) {
  string dir=AppDomain.CurrentDomain.BaseDirectory;
  string origin=File.ReadAllText(Path.Combine(dir,"allowed-origin.txt")).Trim();
  if(!System.Text.RegularExpressions.Regex.IsMatch(origin,"^chrome-extension://[a-p]{32}/$"))return;
  if(args.Length==0 || args[0]!=origin)return;
  string node=File.ReadAllText(Path.Combine(dir,"node-path.txt")).Trim();
  var info=new ProcessStartInfo(node,"\""+Path.Combine(dir,"native.cjs")+"\" \""+args[0]+"\"");
  info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
  using(var child=Process.Start(info)) {
   var input=Console.OpenStandardInput();var output=Console.OpenStandardOutput();
   Task a=Task.Run(async()=>{try{await Pump(input,child.StandardInput.BaseStream);}catch{}finally{try{child.StandardInput.Close();}catch{}}});
   Task b=Pump(child.StandardOutput.BaseStream,output);
   Task c=child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
   child.WaitForExit();b.Wait();c.Wait();
  }
 }
}
