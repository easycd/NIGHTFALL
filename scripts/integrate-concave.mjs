import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const source=path.resolve(process.cwd()),target=path.resolve(process.argv[2]||'C:/Project/Concave');
if(target.toLowerCase()!=='c:\\project\\concave')throw new Error('Expected explicitly authorized Concave directory.');
const dest=path.join(target,'nightfall');await mkdir(dest,{recursive:true});
for(const item of ['config.js','game.js','server.js','server.d.ts','public'])await cp(path.join(source,item),path.join(dest,item),{recursive:true});
const entry=path.join(target,'server/index.ts');let content=await readFile(entry,'utf8');
if(!content.includes('createNightfall')){
  content=content.replace("import { fileURLToPath } from 'node:url';","import { fileURLToPath, pathToFileURL } from 'node:url';");
  content=content.replace('export function createGameServer() {',"const { createNightfall, handleNightfallRequest } = await import(pathToFileURL(path.resolve(process.cwd(), 'nightfall/server.js')).href);\n\nexport function createGameServer() {");
  content=content.replace("const io = new Server(http, { maxHttpBufferSize: 16_384 });","const io = new Server(http, { maxHttpBufferSize: 16_384 });\n  const nightfall = createNightfall(io);");
  content=content.replace("  app.get('/api/health'", "  app.use((req, res, next) => {\n    void handleNightfallRequest(req, res).then((handled: boolean) => { if (!handled) next(); }).catch(next);\n  });\n  app.get('/api/health'");
  content=content.replace('close: () => { clearInterval(interval);','close: () => { clearInterval(interval); nightfall.close();');
  await writeFile(entry,content);
}
await writeFile(path.join(dest,'README.md'),'# NIGHTFALL\n\nGame source copied from C:/Project/DeadByDayLight_2D.\nMounted at /dbd/ on the existing Gomoku HTTP server. Socket.IO namespace: /nightfall.\nRun the source project scripts/integrate-concave.mjs after changes to synchronize these files.\n');
console.log(`Integrated NIGHTFALL into ${target}; existing Gomoku routes remain at /.`);
